import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { PR_METADATA_KEY, prMetadata, type WorkspacePullRequest } from "../shared/rpc";
import { parseGitHubRepo } from "./git";

export type Paseo = PluginHandlerContext["paseo"];
export type Workspace = Awaited<ReturnType<Paseo["workspaces"]["list"]>>["entries"][number];

export async function listGitWorkspaces(paseo: Paseo): Promise<Workspace[]> {
  const workspaces: Workspace[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const result = await paseo.workspaces.list({ page: { limit: 200, ...(cursor ? { cursor } : {}) } });
    workspaces.push(...result.entries.filter((workspace) => !workspace.archivingAt && workspace.projectKind === "git"));
    if (!result.pageInfo.hasMore || !result.pageInfo.nextCursor) break;
    cursor = result.pageInfo.nextCursor;
  }
  return workspaces;
}

export function workspacePullRequest(workspace: Workspace): WorkspacePullRequest | null {
  const stored = prMetadata.safeParse(workspace.metadata?.[PR_METADATA_KEY]);
  if (stored.success) {
    return { workspaceId: workspace.id, repo: stored.data.repo, number: stored.data.number, branch: null };
  }
  const repo = parseGitHubRepo(workspace.gitRuntime?.remoteUrl ?? "");
  if (!repo) return null;
  return {
    workspaceId: workspace.id,
    repo,
    number: workspace.githubRuntime?.pullRequest?.number ?? null,
    branch: workspace.gitRuntime?.currentBranch ?? null,
  };
}

export async function listWorkspacePullRequests(paseo: Paseo): Promise<WorkspacePullRequest[]> {
  return (await listGitWorkspaces(paseo)).flatMap((workspace) => workspacePullRequest(workspace) ?? []);
}
