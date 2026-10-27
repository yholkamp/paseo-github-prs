import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import {
  getMentions,
  getOverview,
  type MentionSection,
  type Mentions,
  type MySection,
  type Overview,
  type ReviewSection,
} from "../shared/rpc";
import { preferences } from "../shared/settings";

export const OVERVIEW_KEY = ["github-prs", "overview"] as const;
export const MENTIONS_KEY = ["github-prs", "mentions"] as const;
export const AUTH_KEY = ["github-prs", "auth"] as const;

function usePolling() {
  const settings = useSettings(preferences);
  const minutes = settings.status === "ready" ? settings.values.refreshMinutes : 5;
  return {
    revision: settings.status === "ready" || settings.status === "invalid" ? settings.revision : null,
    enabled: settings.status !== "loading",
    refetchInterval: minutes > 0 ? minutes * 60_000 : (false as const),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    retry: 1,
  };
}

function useCachedQuery<T extends { stale: boolean }>(
  key: readonly unknown[],
  fetch: (input: { allowStale?: boolean }) => Promise<T>,
) {
  const queryClient = useQueryClient();
  const { revision, ...options } = usePolling();
  const queryKey = [...key, revision];
  const query = useQuery({
    queryKey,
    queryFn: () => fetch({ allowStale: queryClient.getQueryData(queryKey) === undefined }),
    ...options,
  });
  const { data, isPlaceholderData, refetch } = query;
  useEffect(() => {
    if (data?.stale && !isPlaceholderData) void refetch();
  }, [data, isPlaceholderData, refetch]);
  return query;
}

export function useOverview() {
  return useCachedQuery(OVERVIEW_KEY, useRpc(getOverview));
}

export function useMentions() {
  return useCachedQuery(MENTIONS_KEY, useRpc(getMentions));
}

export function reviewCount(data: Overview | undefined): number {
  return data?.reviews.filter((pr) => pr.section === "ready" || pr.section === "rereview").length ?? 0;
}

export function mentionCount(data: Mentions | undefined): number {
  return data?.mentions.filter((mention) => mention.section === "unanswered").length ?? 0;
}

export function attentionCount(overview: Overview | undefined, mentions: Mentions | undefined): number {
  const mine = overview?.mine.filter((pr) => pr.section === "action" || pr.section === "comments" || pr.section === "merge").length ?? 0;
  return reviewCount(overview) + mine + mentionCount(mentions);
}

export interface SectionInfo<Id extends string> {
  id: Id;
  title: string;
  collapsed: boolean;
}

export const MY_SECTIONS: SectionInfo<MySection>[] = [
  { id: "action", title: "Needs your attention", collapsed: false },
  { id: "comments", title: "New comments", collapsed: false },
  { id: "merge", title: "Ready to merge", collapsed: false },
  { id: "checks", title: "Approved, checks running", collapsed: false },
  { id: "review", title: "Awaiting review", collapsed: false },
  { id: "bot", title: "Not marked ready for review yet", collapsed: false },
  { id: "draft", title: "Drafts", collapsed: true },
];

export const REVIEW_SECTIONS: SectionInfo<ReviewSection>[] = [
  { id: "ready", title: "Ready for your review", collapsed: false },
  { id: "rereview", title: "Changed since your review", collapsed: false },
  { id: "reviewed", title: "Waiting on author", collapsed: true },
  { id: "approved", title: "Approved by others", collapsed: true },
  { id: "bot", title: "Still with the review bot", collapsed: true },
  { id: "draft", title: "Drafts", collapsed: true },
];

export const MENTION_SECTIONS: SectionInfo<MentionSection>[] = [
  { id: "unanswered", title: "Needs your reply", collapsed: false },
  { id: "answered", title: "Replied, reacted or resolved", collapsed: true },
  { id: "done", title: "Marked done", collapsed: true },
];

export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 60) return `${days}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}
