import type { MySection, PullRequest, ReviewSection } from "../shared/rpc";
import type { RawCheck, RawPullRequest } from "./github";

export interface ReviewRules {
  viewer: string;
  readyPattern: RegExp;
  botLogins: ReadonlySet<string>;
  botActivityResetsReady: boolean;
}

type Base = Omit<PullRequest, "section">;

const FAILED_CONCLUSIONS = new Set([
  "FAILURE",
  "TIMED_OUT",
  "CANCELLED",
  "ACTION_REQUIRED",
  "STARTUP_FAILURE",
]);

export function normalizeLogin(login: string): string {
  return login.trim().toLowerCase().replace(/\[bot\]$/, "");
}

function latest(times: Array<string | null | undefined>): string | null {
  let result: string | null = null;
  for (const time of times) {
    if (time && (!result || time > result)) result = time;
  }
  return result;
}

function checkName(check: RawCheck): string {
  return check.__typename === "CheckRun" ? check.name : check.context;
}

function isFailed(check: RawCheck): boolean {
  return check.__typename === "CheckRun"
    ? FAILED_CONCLUSIONS.has(check.conclusion ?? "")
    : check.state === "FAILURE" || check.state === "ERROR";
}

function isPending(check: RawCheck): boolean {
  return check.__typename === "CheckRun"
    ? check.status !== "COMPLETED"
    : check.state === "PENDING" || check.state === "EXPECTED";
}

function ciSummary(pr: RawPullRequest): Pick<Base, "ci" | "failingChecks" | "pendingChecks"> {
  const rollup = pr.commits.nodes[0]?.commit.statusCheckRollup;
  if (!rollup) return { ci: "none", failingChecks: [], pendingChecks: 0 };
  const checks = rollup.contexts.nodes.filter((check): check is RawCheck => check !== null);
  const ci =
    rollup.state === "SUCCESS"
      ? "success"
      : rollup.state === "FAILURE" || rollup.state === "ERROR"
        ? "failure"
        : "pending";
  return {
    ci,
    failingChecks: [...new Set(checks.filter(isFailed).map(checkName))],
    pendingChecks: checks.filter(isPending).length,
  };
}

export function describe(pr: RawPullRequest, rules: ReviewRules): Base {
  const viewer = normalizeLogin(rules.viewer);
  const reviews = pr.reviews.nodes.filter(
    (review): review is NonNullable<typeof review> => !!review?.submittedAt && review.state !== "PENDING",
  );
  const comments = pr.comments.nodes.filter((comment): comment is NonNullable<typeof comment> => !!comment);
  const activity = [
    ...comments.map((comment) => ({ at: comment.createdAt, body: comment.body, author: comment.author?.login })),
    ...reviews.map((review) => ({ at: review.submittedAt!, body: review.body, author: review.author?.login })),
  ];

  const readyAt = latest(activity.filter((entry) => rules.readyPattern.test(entry.body)).map((entry) => entry.at));
  const botAt = latest(
    activity
      .filter((entry) => entry.author && rules.botLogins.has(normalizeLogin(entry.author)))
      .map((entry) => entry.at),
  );
  const stage = pr.isDraft
    ? "draft"
    : !readyAt || (rules.botActivityResetsReady && botAt && botAt > readyAt)
      ? "bot"
      : "ready";

  const mine = reviews.filter((review) => review.author && normalizeLogin(review.author.login) === viewer);
  const myLatest = mine[mine.length - 1];
  const myReview =
    !myLatest || myLatest.state === "DISMISSED"
      ? null
      : myLatest.state === "APPROVED"
        ? "approved"
        : myLatest.state === "CHANGES_REQUESTED"
          ? "changes_requested"
          : "commented";
  const changedSinceMyReview =
    myReview !== null &&
    (myLatest!.commit?.oid !== pr.headRefOid || (!!readyAt && readyAt > myLatest!.submittedAt!));

  return {
    id: pr.id,
    number: pr.number,
    title: pr.title,
    url: pr.url,
    repo: pr.repository.nameWithOwner,
    author: pr.author?.login ?? "ghost",
    isDraft: pr.isDraft,
    updatedAt: pr.updatedAt,
    headRefName: pr.headRefName,
    baseRefName: pr.baseRefName,
    isCrossRepository: pr.isCrossRepository,
    ...ciSummary(pr),
    reviewDecision:
      pr.reviewDecision === "APPROVED"
        ? "approved"
        : pr.reviewDecision === "CHANGES_REQUESTED"
          ? "changes_requested"
          : pr.reviewDecision === "REVIEW_REQUIRED"
            ? "review_required"
            : "none",
    conflicting: pr.mergeable === "CONFLICTING",
    approvals: pr.latestOpinionatedReviews.nodes.filter((review) => review?.state === "APPROVED").length,
    stage,
    readyAt,
    myReview,
    changedSinceMyReview,
  };
}

export function mySection(pr: Base): MySection {
  if (pr.isDraft) return "draft";
  if (pr.conflicting || pr.ci === "failure" || pr.reviewDecision === "changes_requested") return "action";
  const approved = pr.reviewDecision === "approved" || (pr.reviewDecision === "none" && pr.approvals > 0);
  if (approved) return pr.ci === "pending" ? "checks" : "merge";
  return pr.stage === "ready" ? "review" : "bot";
}

export function reviewSection(pr: Base): ReviewSection {
  if (pr.stage !== "ready") return "bot";
  if (!pr.myReview) return "ready";
  return pr.changedSinceMyReview ? "rereview" : "reviewed";
}
