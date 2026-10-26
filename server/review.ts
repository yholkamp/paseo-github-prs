import type { PluginHandlerContext, PluginSettings } from "@getpaseo/plugin/server";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { type ReviewJob, reviewKey, type ReviewTarget } from "../shared/rpc";
import { preferences } from "../shared/settings";
import { type GitHubRemote, git, githubRemotes, gitOk, parseGitHubRepo } from "./git";

type Paseo = PluginHandlerContext["paseo"];
type Preferences = PluginSettings<typeof preferences.schema>;
type Workspace = Awaited<ReturnType<Paseo["workspaces"]["list"]>>["entries"][number];

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
const jobs = new Map<string, Job>();

function sameRepo(a: string | null | undefined, b: string): boolean {
  return !!a && a.toLowerCase() === b.toLowerCase();
}

function expandHome(path: string): string {
  return path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : path;
}

function renderPrompt(template: string, target: ReviewTarget, branch: string): string {
  const values: Record<string, string> = {
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
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const result = await paseo.workspaces.list({ page: { limit: 200, ...(cursor ? { cursor } : {}) } });
    const match = result.entries.find((workspace) => {
      if (workspace.archivingAt || workspace.projectKind !== "git") return false;
      const repoMatches =
        workspace.projectRootPath === located.root ||
        sameRepo(parseGitHubRepo(workspace.gitRuntime?.remoteUrl ?? ""), target.repo);
      if (!repoMatches) return false;
      return (
        workspace.gitRuntime?.currentBranch === branch ||
        workspace.githubRuntime?.pullRequest?.number === target.number
      );
    });
    if (match) return match;
    if (!result.pageInfo.hasMore || !result.pageInfo.nextCursor) return null;
    cursor = result.pageInfo.nextCursor;
  }
  return null;
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
  const existing = await findWorkspace(paseo, located, target, branch);
  let workspace;
  if (existing) {
    job.reusedWorkspace = true;
    await updateWorkspace(existing.workspaceDirectory ?? existing.projectRootPath, trackingRef, job.warnings);
    workspace = paseo.workspaces.ref(existing.id);
  } else {
    await prepareBranch(located.root, branch, trackingRef, job.warnings);
    job.step = "Creating worktree";
    workspace = await paseo.workspaces.create({
      title: `Review #${target.number}: ${target.title}`.slice(0, 80),
      source: { kind: "worktree", cwd: located.root, action: "checkout", refName: branch },
    });
  }
  job.workspaceId = workspace.id;

  job.step = "Starting review agent";
  const agent = await workspace.agents.create({
    config: { provider: prefs.reviewProvider },
    title: `Code review #${target.number}`,
    prompt: renderPrompt(prefs.reviewPrompt, target, branch),
  });
  job.agentId = agent.id;
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
    reusedWorkspace: false,
    error: null,
    warnings: [],
    finishedAt: null,
  };
  jobs.set(job.id, job);
  runReview(job, target, paseo, settings).then(
    () => {
      job.state = "done";
      job.step = "Review started";
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
