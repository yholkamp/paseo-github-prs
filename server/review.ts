import type { PluginSettings } from "@getpaseo/plugin/server";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
  PR_METADATA_KEY,
  type PrMetadata,
  type ReviewJob,
  reviewKey,
  type ReviewRecord,
  reviewRecord,
  type ReviewTarget,
} from "../shared/rpc";
import { preferences } from "../shared/settings";
import { type GitHubRemote, git, githubRemotes, gitOk, parseGitHubRepo } from "./git";
import { readConfigFile, writeConfigFile } from "./storage";
import { listGitWorkspaces, type Paseo, type Workspace } from "./workspaces";

type Preferences = PluginSettings<typeof preferences.schema>;

interface Job extends ReviewJob {
  finishedAt: number | null;
}

interface Checkout {
  root: string;
  remotes: GitHubRemote[];
}

interface Located {
  root: string;
  remote: string;
}

const JOB_RETENTION_MS = 10 * 60 * 1000;
const RECORDS_FILE = "reviews.json";
const RECORD_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const jobs = new Map<string, Job>();
let records: Map<string, ReviewRecord> | null = null;
let writes: Promise<unknown> = Promise.resolve();

async function loadRecords(): Promise<Map<string, ReviewRecord>> {
  if (!records) {
    const text = await readConfigFile(RECORDS_FILE);
    let stored: ReviewRecord[] = [];
    try {
      stored = z.array(reviewRecord).parse(JSON.parse(text ?? ""));
    } catch {}
    records ??= new Map(stored.map((record) => [record.key, record]));
  }
  return records;
}

async function saveRecord(record: ReviewRecord): Promise<void> {
  const map = await loadRecords();
  map.set(record.key, record);
  const cutoff = new Date(Date.now() - RECORD_RETENTION_MS).toISOString();
  for (const [key, entry] of map) {
    if (entry.reviewedAt < cutoff) map.delete(key);
  }
  const next = writes.then(() => writeConfigFile(RECORDS_FILE, JSON.stringify([...map.values()])));
  writes = next.catch(() => undefined);
  await next;
}

function sameRepo(a: string | null | undefined, b: string): boolean {
  return !!a && a.toLowerCase() === b.toLowerCase();
}

function expandHome(path: string): string {
  return path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : path;
}

function renderPrompt(
  template: string,
  target: ReviewTarget,
  branch: string,
  extra: Record<string, string> = {},
): string {
  const values: Record<string, string> = {
    ...extra,
    number: String(target.number),
    branch,
    base: target.baseRefName,
    repo: target.repo,
    url: target.url,
    title: target.title,
  };
  return template.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}

async function listCheckouts(paseo: Paseo): Promise<Checkout[]> {
  const { projects } = await paseo.projects.list();
  return Promise.all(
    projects
      .filter((project) => project.projectKind === "git")
      .map(async (project) => ({
        root: project.projectRootPath,
        remotes: await githubRemotes(project.projectRootPath),
      })),
  );
}

function locate(checkouts: Checkout[], repo: string): Located | null {
  for (const checkout of checkouts) {
    const remote = checkout.remotes.find((candidate) => sameRepo(candidate.repo, repo));
    if (remote) return { root: checkout.root, remote: remote.name };
  }
  return null;
}

async function cloneRepository(checkouts: Checkout[], repo: string, cloneDirectory: string): Promise<Located> {
  const [owner = "", name = ""] = repo.split("/");
  const sibling = checkouts
    .flatMap((checkout) => checkout.remotes.map((remote) => ({ root: checkout.root, remote })))
    .find(({ remote }) => sameRepo(remote.repo.split("/")[0], owner));
  const parent = cloneDirectory.trim() ? expandHome(cloneDirectory.trim()) : sibling ? dirname(sibling.root) : null;
  if (!parent) {
    throw new Error(
      `No local checkout of ${repo} and no other ${owner} repository to clone next to. Set a clone folder under Settings → Plugins → GitHub PRs.`,
    );
  }
  const target = join(parent, name);
  if (existsSync(target)) {
    const remote = (await githubRemotes(target)).find((candidate) => sameRepo(candidate.repo, repo));
    if (remote) return { root: target, remote: remote.name };
    throw new Error(`${target} already exists and is not a checkout of ${repo}.`);
  }
  const url = sibling?.remote.url.startsWith("http")
    ? `https://github.com/${repo}.git`
    : `git@github.com:${repo}.git`;
  await mkdir(parent, { recursive: true });
  await git(null, ["clone", url, target], 30 * 60_000);
  return { root: target, remote: "origin" };
}

async function findWorkspace(
  paseo: Paseo,
  located: Located,
  target: ReviewTarget,
  branch: string,
): Promise<Workspace | null> {
  const workspaces = await listGitWorkspaces(paseo);
  return (
    workspaces.find((workspace) => {
      const repoMatches =
        workspace.projectRootPath === located.root ||
        sameRepo(parseGitHubRepo(workspace.gitRuntime?.remoteUrl ?? ""), target.repo);
      if (!repoMatches) return false;
      return (
        workspace.gitRuntime?.currentBranch === branch ||
        workspace.githubRuntime?.pullRequest?.number === target.number
      );
    }) ?? null
  );
}

function prMetadata(target: ReviewTarget, headSha?: string): PrMetadata {
  return { repo: target.repo, number: target.number, url: target.url, ...(headSha ? { headSha } : {}) };
}

function logMetadataError(error: unknown): void {
  console.error(`Could not store pull request metadata: ${error instanceof Error ? error.message : String(error)}`);
}

async function liveWorkspace(paseo: Paseo, id: string): Promise<Workspace | null> {
  const workspace = await paseo.workspaces.ref(id).refresh().catch(() => null);
  return workspace && !workspace.archivingAt ? workspace : null;
}

async function liveAgent(paseo: Paseo, id: string) {
  const agent = paseo.agents.ref(id);
  const snapshot = await agent.refresh().catch(() => null);
  return snapshot && !snapshot.agent.archivedAt ? agent : null;
}

async function autoModeId(paseo: Paseo, provider: string): Promise<string | undefined> {
  const result = await paseo.providers.listModes(provider.split("/")[0] ?? provider).catch(() => null);
  return result?.modes?.find((mode) => /^auto\b/i.test(mode.label))?.id;
}

async function updateWorkspace(directory: string, trackingRef: string, warnings: string[]): Promise<void> {
  if (await git(directory, ["status", "--porcelain"]).catch(() => "")) {
    warnings.push("The existing workspace has uncommitted changes, so it was not updated to the latest PR commit.");
    return;
  }
  if (!(await gitOk(directory, ["merge", "--ff-only", trackingRef]))) {
    warnings.push("The existing workspace branch has diverged from the pull request, so it was not updated.");
  }
}

async function prepareBranch(root: string, branch: string, trackingRef: string, warnings: string[]): Promise<void> {
  const localRef = `refs/heads/${branch}`;
  if (!(await gitOk(root, ["show-ref", "--verify", "--quiet", localRef]))) {
    await git(root, ["branch", branch, trackingRef]);
    return;
  }
  if (await gitOk(root, ["merge-base", "--is-ancestor", localRef, trackingRef])) {
    if (!(await gitOk(root, ["branch", "-f", branch, trackingRef]))) {
      warnings.push(`Local branch ${branch} could not be updated to the latest PR commit.`);
    }
    return;
  }
  warnings.push(`Local branch ${branch} has commits that are not in the pull request; the review uses the local branch.`);
}

async function runReview(job: Job, target: ReviewTarget, paseo: Paseo, settings: Preferences): Promise<void> {
  const stored = await settings.read();
  const prefs = stored.status === "ready" ? stored.values : preferences.schema.parse({});

  job.step = "Finding local checkout";
  const checkouts = await listCheckouts(paseo);
  let located = locate(checkouts, target.repo);
  if (!located) {
    job.step = `Cloning ${target.repo}`;
    located = await cloneRepository(checkouts, target.repo, prefs.cloneDirectory);
  }

  const branch = target.isCrossRepository ? `pr-${target.number}` : target.headRefName;
  const sourceRef = target.isCrossRepository ? `refs/pull/${target.number}/head` : `refs/heads/${target.headRefName}`;
  const trackingRef = `refs/remotes/${located.remote}/${target.isCrossRepository ? `pr/${target.number}` : target.headRefName}`;

  job.step = "Fetching the pull request";
  await git(located.root, [
    "fetch",
    "--no-tags",
    located.remote,
    `+${sourceRef}:${trackingRef}`,
    `+refs/heads/${target.baseRefName}:refs/remotes/${located.remote}/${target.baseRefName}`,
  ]);

  job.step = "Looking for an existing workspace";
  const previous = (await loadRecords()).get(job.key);
  const previousWorkspace = previous ? await liveWorkspace(paseo, previous.workspaceId) : null;
  const existing = previousWorkspace ?? (await findWorkspace(paseo, located, target, branch));
  let workspace;
  let reviewedSha: string;
  if (existing) {
    const directory = existing.workspaceDirectory ?? existing.projectRootPath;
    await updateWorkspace(directory, trackingRef, job.warnings);
    workspace = paseo.workspaces.ref(existing.id);
    reviewedSha = await git(directory, ["rev-parse", "HEAD"]);
    await workspace.setMetadata({ [PR_METADATA_KEY]: prMetadata(target) }).catch(logMetadataError);
  } else {
    await prepareBranch(located.root, branch, trackingRef, job.warnings);
    job.step = "Creating worktree";
    workspace = await paseo.workspaces.create({
      title: `Review #${target.number}: ${target.title}`.slice(0, 80),
      source: { kind: "worktree", cwd: located.root, action: "checkout", refName: branch },
      metadata: { [PR_METADATA_KEY]: prMetadata(target) },
    });
    reviewedSha = await git(located.root, ["rev-parse", `refs/heads/${branch}`]);
  }
  job.workspaceId = workspace.id;

  const previousAgent = previous && previousWorkspace ? await liveAgent(paseo, previous.agentId) : null;
  if (previous && previousAgent) {
    job.agentId = previousAgent.id;
    if (reviewedSha === previous.headSha) {
      job.outcome = "unchanged";
      return;
    }
    job.step = "Asking the review agent to re-review";
    await previousAgent.send(
      renderPrompt(prefs.followUpPrompt, target, branch, {
        previous: previous.headSha.slice(0, 12),
        head: reviewedSha.slice(0, 12),
      }),
    );
    job.outcome = "follow_up";
    await previousAgent.setMetadata({ [PR_METADATA_KEY]: prMetadata(target, reviewedSha) }).catch(logMetadataError);
  } else {
    job.step = "Starting review agent";
    const modeId = await autoModeId(paseo, prefs.reviewProvider);
    const agent = await workspace.agents.create({
      config: { provider: prefs.reviewProvider, ...(modeId ? { modeId } : {}) },
      title: `Code review #${target.number}`,
      prompt: renderPrompt(prefs.reviewPrompt, target, branch),
      metadata: { [PR_METADATA_KEY]: prMetadata(target, reviewedSha) },
    });
    job.agentId = agent.id;
    job.outcome = existing ? "existing_workspace" : "new_workspace";
  }

  await saveRecord({
    key: job.key,
    workspaceId: workspace.id,
    agentId: job.agentId,
    headSha: reviewedSha,
    reviewedAt: new Date().toISOString(),
  });
}

export async function currentReviewRecords(): Promise<ReviewRecord[]> {
  return [...(await loadRecords()).values()];
}

export function currentReviewJobs(): ReviewJob[] {
  const cutoff = Date.now() - JOB_RETENTION_MS;
  for (const [id, job] of jobs) {
    if (job.finishedAt !== null && job.finishedAt < cutoff) jobs.delete(id);
  }
  return [...jobs.values()].map(({ finishedAt: _finishedAt, ...job }) => job);
}

export function startReviewJob(target: ReviewTarget, paseo: Paseo, settings: Preferences): { jobId: string } {
  const key = reviewKey(target.repo, target.number);
  const running = [...jobs.values()].find((job) => job.key === key && job.state === "running");
  if (running) return { jobId: running.id };

  const job: Job = {
    id: randomUUID(),
    key,
    state: "running",
    step: "Starting",
    workspaceId: null,
    agentId: null,
    outcome: null,
    error: null,
    warnings: [],
    finishedAt: null,
  };
  jobs.set(job.id, job);
  runReview(job, target, paseo, settings).then(
    () => {
      job.state = "done";
      job.step = job.outcome === "unchanged" ? "Already reviewed" : "Review started";
      job.finishedAt = Date.now();
    },
    (error: unknown) => {
      job.state = "failed";
      job.error = error instanceof Error ? error.message : String(error);
      job.finishedAt = Date.now();
      console.error(`Review of ${key} failed at "${job.step}": ${job.error}`);
    },
  );
  return { jobId: job.id };
}
