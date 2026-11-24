import type { PluginSettings } from "@getpaseo/plugin/server";
import type { Merged, MergedPullRequest, MergedSection } from "../shared/rpc";
import { preferences } from "../shared/settings";
import { cacheKey, SharedCache } from "./cache";
import { branchesContaining, GitHubError, type RawMergedPullRequest, searchMergedPullRequests } from "./github";
import { resolveToken } from "./token";

type Preferences = PluginSettings<typeof preferences.schema>;
type Values = ReturnType<typeof preferences.schema.parse>;
type Environment = MergedPullRequest["staging"];

const cache = new SharedCache<Omit<Merged, "stale">>("cache-merged.json");

const REPO_CONCURRENCY = 4;
const DAY_MS = 24 * 60 * 60 * 1000;

function branchList(branches: string[]): string[] {
  return [...new Set(branches.map((branch) => branch.trim()).filter(Boolean))];
}

function environment(
  candidates: string[],
  contains: Map<string, Map<string, boolean | null>>,
  oid: string | undefined,
): Environment {
  const branch = candidates.find((candidate) => contains.has(candidate));
  if (!branch) return null;
  return { branch, contains: oid ? (contains.get(branch)!.get(oid) ?? null) : null };
}

function sectionFor(staging: Environment, production: Environment, failed: boolean): MergedSection {
  if (production?.contains) return "production";
  if (staging?.contains) return "staging";
  if (!staging && !production) return failed ? "unchecked" : "untracked";
  if (staging?.contains === null || production?.contains === null) return "unchecked";
  return "merged";
}

export async function loadMerged(settings: Preferences, allowStale: boolean): Promise<Merged> {
  const resolved = await resolveToken();
  if (!resolved) {
    throw new Error("No GitHub token configured. Add one under Settings → Plugins → GitHub PRs.");
  }
  const stored = await settings.read();
  const prefs = stored.status === "ready" ? stored.values : preferences.schema.parse({});
  const { value, stale } = await cache.get(
    cacheKey(resolved.token, prefs),
    () => fetchMerged(resolved.token, prefs),
    allowStale,
  );
  return { ...value, stale };
}

async function fetchMerged(token: string, prefs: Values): Promise<Omit<Merged, "stale">> {
  const stagingBranches = branchList(prefs.stagingBranches);
  const productionBranches = branchList(prefs.productionBranches);
  const environmentBranches = new Set([...stagingBranches, ...productionBranches].map((branch) => branch.toLowerCase()));
  const day = new Date(Date.now() - prefs.mergedDays * DAY_MS).toISOString().slice(0, 10);

  const search = await searchMergedPullRequests(
    token,
    `is:pr is:merged author:@me archived:false merged:>=${day} sort:updated-desc`,
  );
  const warnings = [...search.warnings];
  const prs = search.prs.filter((pr) => !environmentBranches.has(pr.headRefName.toLowerCase()));

  const byRepo = new Map<string, RawMergedPullRequest[]>();
  for (const pr of prs) {
    const repo = pr.repository.nameWithOwner;
    byRepo.set(repo, [...(byRepo.get(repo) ?? []), pr]);
  }

  const branches = [...stagingBranches, ...productionBranches];
  const results: MergedPullRequest[] = [];
  const check = async ([repo, repoPrs]: [string, RawMergedPullRequest[]]) => {
    const oids = [...new Set(repoPrs.flatMap((pr) => (pr.mergeCommit ? [pr.mergeCommit.oid] : [])))];
    let contains = new Map<string, Map<string, boolean | null>>();
    let failed = false;
    if (branches.length > 0 && oids.length > 0) {
      try {
        const result = await branchesContaining(token, repo, branches, oids);
        contains = result.contains;
        warnings.push(...result.warnings);
      } catch (error) {
        if (error instanceof GitHubError && error.status === 401) throw error;
        failed = true;
        warnings.push(`Could not check the branches of ${repo}: ${(error as Error).message}`);
      }
    }
    for (const pr of repoPrs) {
      const staging = environment(stagingBranches, contains, pr.mergeCommit?.oid);
      const production = environment(productionBranches, contains, pr.mergeCommit?.oid);
      results.push({
        id: pr.id,
        number: pr.number,
        title: pr.title,
        url: pr.url,
        repo,
        baseRefName: pr.baseRefName,
        headRefName: pr.headRefName,
        mergedAt: pr.mergedAt,
        staging,
        production,
        section: sectionFor(staging, production, failed || !pr.mergeCommit),
      });
    }
  };

  const repos = [...byRepo.entries()];
  for (let index = 0; index < repos.length; index += REPO_CONCURRENCY) {
    await Promise.all(repos.slice(index, index + REPO_CONCURRENCY).map(check));
  }

  results.sort((a, b) => b.mergedAt.localeCompare(a.mergedAt));
  return { login: search.login, prs: results, warnings: [...new Set(warnings)], fetchedAt: new Date().toISOString() };
}
