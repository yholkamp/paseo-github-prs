import type { PluginWorkspaceRowBadgeItemProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { WorkspaceRowBadge, type WorkspaceRowBadgeTone } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import {
  listWorkspacePullRequests,
  type MySection,
  type PullRequest,
  type ReviewSection,
  type WorkspacePullRequest,
} from "../shared/rpc";
import { MY_SECTIONS, REVIEW_SECTIONS, useOverview } from "./data";

export const WORKSPACES_KEY = ["github-prs", "workspaces"] as const;

interface Badge {
  label: string;
  tone: WorkspaceRowBadgeTone;
}

function myBadge(pr: PullRequest): Badge {
  switch (pr.section as MySection) {
    case "action":
      if (pr.conflicting) return { label: "Conflict", tone: "danger" };
      if (pr.ci === "failure") return { label: "Failing", tone: "danger" };
      return { label: "Changes", tone: "danger" };
    case "comments":
      return { label: `${pr.newComments} new`, tone: "info" };
    case "merge":
      return { label: "Mergeable", tone: "success" };
    case "checks":
      return { label: "Checks", tone: "muted" };
    case "review":
      return { label: "In review", tone: "muted" };
    default:
      return { label: "Not ready", tone: "muted" };
  }
}

function reviewBadge(pr: PullRequest): Badge {
  switch (pr.section as ReviewSection) {
    case "ready":
      return { label: "Review", tone: "warning" };
    case "rereview":
      return { label: "Re-review", tone: "warning" };
    case "reviewed":
      return { label: "Waiting", tone: "muted" };
    case "others":
      return { label: "Others", tone: "muted" };
    case "approved":
      return { label: "Approved", tone: "success" };
    default:
      return { label: "Bot", tone: "muted" };
  }
}

function matches(pr: PullRequest, workspace: WorkspacePullRequest): boolean {
  if (pr.repo.toLowerCase() !== workspace.repo.toLowerCase()) return false;
  if (workspace.number !== null) return pr.number === workspace.number;
  if (!workspace.branch) return false;
  return workspace.branch === (pr.isCrossRepository ? `pr-${pr.number}` : pr.headRefName);
}

export function PullRequestBadge({ workspaceId }: PluginWorkspaceRowBadgeItemProps) {
  const list = useRpc(listWorkspacePullRequests);
  const workspaces = useQuery({
    queryKey: WORKSPACES_KEY,
    queryFn: () => list({}),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const overview = useOverview();
  const workspace = workspaces.data?.workspaces.find((entry) => entry.workspaceId === workspaceId);
  if (!workspace || !overview.data) return null;

  const mine = overview.data.mine.find((pr) => matches(pr, workspace));
  const review = mine ? undefined : overview.data.reviews.find((pr) => matches(pr, workspace));
  const pr = mine ?? review;
  if (!pr) return null;

  const badge = mine ? myBadge(pr) : reviewBadge(pr);
  const section = (mine ? MY_SECTIONS : REVIEW_SECTIONS).find((info) => info.id === pr.section);
  return (
    <WorkspaceRowBadge
      label={badge.label}
      tone={badge.tone}
      accessibilityLabel={`Pull request #${pr.number}: ${section?.title ?? badge.label}`}
    />
  );
}
