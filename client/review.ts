import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import {
  listReviewJobs,
  type PullRequest,
  type ReviewJob,
  type ReviewOutcome,
  type ReviewRecord,
  reviewKey,
  startReview,
} from "../shared/rpc";

const REVIEW_JOBS_KEY = ["github-prs", "review-jobs"] as const;

const STARTED: Record<ReviewOutcome, string> = {
  new_workspace: "Review started in a new worktree.",
  existing_workspace: "Review started in the existing workspace.",
  follow_up: "Re-review started in the previous review session.",
  unchanged: "No new commits since the last review.",
};

type ReviewSession = Pick<ReviewJob, "agentId" | "workspaceId">;

export interface Reviews {
  jobFor(pr: PullRequest): ReviewJob | undefined;
  recordFor(pr: PullRequest): ReviewRecord | undefined;
  start(pr: PullRequest): void;
  open(session: ReviewSession): void;
}

export function useReviews(navigation: PluginScreenProps["navigation"]): Reviews {
  const toast = useToast();
  const queryClient = useQueryClient();
  const fetchJobs = useRpc(listReviewJobs);
  const startJob = useRpc(startReview);
  const started = useRef(new Set<string>());

  const jobs = useQuery({
    queryKey: REVIEW_JOBS_KEY,
    queryFn: () => fetchJobs({}),
    refetchInterval: (query) => (query.state.data?.jobs.some((job) => job.state === "running") ? 1500 : false),
  });

  const start = useMutation({
    mutationFn: (pr: PullRequest) =>
      startJob({
        repo: pr.repo,
        number: pr.number,
        title: pr.title,
        url: pr.url,
        headRefName: pr.headRefName,
        baseRefName: pr.baseRefName,
        isCrossRepository: pr.isCrossRepository,
      }),
    onSuccess({ jobId }) {
      started.current.add(jobId);
      void queryClient.invalidateQueries({ queryKey: REVIEW_JOBS_KEY });
    },
    onError(error) {
      toast.error(error.message);
    },
  });

  const open = (session: ReviewSession) => {
    if (session.agentId && navigation) navigation.openAgent({ agentId: session.agentId });
    else if (session.workspaceId && navigation) navigation.openWorkspace({ workspaceId: session.workspaceId });
  };

  useEffect(() => {
    for (const job of jobs.data?.jobs ?? []) {
      if (job.state === "running" || !started.current.delete(job.id)) continue;
      if (job.state === "failed") {
        toast.error(`Review failed: ${job.error ?? "unknown error"}`);
        continue;
      }
      const warning = job.warnings.length ? ` ${job.warnings.join(" ")}` : "";
      toast.show(`${STARTED[job.outcome ?? "new_workspace"]}${warning}`, {
        variant: job.warnings.length ? "warning" : "success",
        durationMs: job.warnings.length ? 6000 : 2200,
      });
      open(job);
    }
  }, [jobs.data]);

  const byKey = useMemo(() => {
    const map = new Map<string, ReviewJob>();
    for (const job of jobs.data?.jobs ?? []) {
      const current = map.get(job.key);
      if (!current || current.state !== "running") map.set(job.key, job);
    }
    return map;
  }, [jobs.data]);

  const records = useMemo(
    () => new Map((jobs.data?.reviews ?? []).map((record) => [record.key, record])),
    [jobs.data],
  );

  return {
    jobFor: (pr) => byKey.get(reviewKey(pr.repo, pr.number)),
    recordFor: (pr) => records.get(reviewKey(pr.repo, pr.number)),
    start: (pr) => start.mutate(pr),
    open,
  };
}
