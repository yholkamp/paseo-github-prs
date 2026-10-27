import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const tokenSource = z.enum(["saved", "env", "gh", "none"]);

export const authStatus = z.object({
  source: tokenSource,
  login: z.string().nullable(),
  error: z.string().nullable(),
});

export type AuthStatus = z.infer<typeof authStatus>;

export const ciState = z.enum(["success", "failure", "pending", "none"]);

const cachedInput = z.object({ allowStale: z.boolean().optional() });

export const pullRequest = z.object({
  id: z.string(),
  number: z.number(),
  title: z.string(),
  url: z.string(),
  repo: z.string(),
  author: z.string(),
  isDraft: z.boolean(),
  updatedAt: z.string(),
  headRefName: z.string(),
  baseRefName: z.string(),
  isCrossRepository: z.boolean(),
  ci: ciState,
  failingChecks: z.array(z.string()),
  pendingChecks: z.number(),
  reviewDecision: z.enum(["approved", "changes_requested", "review_required", "none"]),
  conflicting: z.boolean(),
  approvals: z.number(),
  stage: z.enum(["draft", "bot", "ready"]),
  readyAt: z.string().nullable(),
  myReview: z.enum(["approved", "changes_requested", "commented"]).nullable(),
  changedSinceMyReview: z.boolean(),
  newComments: z.number(),
  section: z.string(),
});

export type PullRequest = z.infer<typeof pullRequest>;

export const mySections = ["action", "comments", "merge", "checks", "review", "bot", "draft"] as const;
export const reviewSections = ["ready", "rereview", "reviewed", "approved", "bot", "draft"] as const;

export type MySection = (typeof mySections)[number];
export type ReviewSection = (typeof reviewSections)[number];

export const overview = z.object({
  login: z.string(),
  mine: z.array(pullRequest),
  reviews: z.array(pullRequest),
  warnings: z.array(z.string()),
  fetchedAt: z.string(),
  stale: z.boolean(),
});

export type Overview = z.infer<typeof overview>;

export const getOverview = defineRpc({
  name: "github.overview",
  input: cachedInput,
  output: overview,
});

export const mentionSections = ["unanswered", "answered", "done"] as const;
export type MentionSection = (typeof mentionSections)[number];

export const mention = z.object({
  id: z.string(),
  url: z.string(),
  kind: z.enum(["comment", "review", "review_comment", "description"]),
  author: z.string(),
  excerpt: z.string(),
  createdAt: z.string(),
  path: z.string().nullable(),
  target: z.object({
    number: z.number(),
    title: z.string(),
    url: z.string(),
    repo: z.string(),
    isPullRequest: z.boolean(),
    state: z.enum(["open", "closed", "merged"]),
  }),
  answered: z.boolean(),
  section: z.enum(mentionSections),
});

export type Mention = z.infer<typeof mention>;

export const mentions = z.object({
  login: z.string(),
  mentions: z.array(mention),
  warnings: z.array(z.string()),
  fetchedAt: z.string(),
  stale: z.boolean(),
});

export type Mentions = z.infer<typeof mentions>;

export const getMentions = defineRpc({
  name: "github.mentions",
  input: cachedInput,
  output: mentions,
});

export const setMentionsDone = defineRpc({
  name: "github.mentions.done",
  input: z.object({ ids: z.array(z.string()).min(1), done: z.boolean() }),
  output: z.object({ ok: z.boolean() }),
});

export const ownerFilter = z.object({ owners: z.array(z.string()) });

export type OwnerFilter = z.infer<typeof ownerFilter>;

export function repoOwner(repo: string): string {
  return repo.slice(0, repo.indexOf("/"));
}

export const getOwnerFilter = defineRpc({
  name: "github.filter",
  input: z.object({}),
  output: ownerFilter,
});

export const setOwnerFilter = defineRpc({
  name: "github.filter.set",
  input: ownerFilter,
  output: ownerFilter,
});

export const reviewTarget = z.object({
  repo: z.string(),
  number: z.number(),
  title: z.string(),
  url: z.string(),
  headRefName: z.string(),
  baseRefName: z.string(),
  isCrossRepository: z.boolean(),
});

export type ReviewTarget = z.infer<typeof reviewTarget>;

export const reviewJob = z.object({
  id: z.string(),
  key: z.string(),
  state: z.enum(["running", "done", "failed"]),
  step: z.string(),
  workspaceId: z.string().nullable(),
  agentId: z.string().nullable(),
  reusedWorkspace: z.boolean(),
  error: z.string().nullable(),
  warnings: z.array(z.string()),
});

export type ReviewJob = z.infer<typeof reviewJob>;

export function reviewKey(repo: string, number: number): string {
  return `${repo.toLowerCase()}#${number}`;
}

export const startReview = defineRpc({
  name: "github.review.start",
  input: reviewTarget,
  output: z.object({ jobId: z.string() }),
});

export const listReviewJobs = defineRpc({
  name: "github.review.jobs",
  input: z.object({}),
  output: z.object({ jobs: z.array(reviewJob) }),
});

export const getAuthStatus = defineRpc({
  name: "github.auth.status",
  input: z.object({}),
  output: authStatus,
});

export const saveToken = defineRpc({
  name: "github.auth.save",
  input: z.object({ token: z.string().min(1) }),
  output: authStatus,
});

export const clearToken = defineRpc({
  name: "github.auth.clear",
  input: z.object({}),
  output: authStatus,
});
