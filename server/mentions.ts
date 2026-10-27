import type { PluginSettings } from "@getpaseo/plugin/server";
import type { Mention, Mentions } from "../shared/rpc";
import { preferences } from "../shared/settings";
import { cacheKey, SharedCache } from "./cache";
import { normalizeLogin } from "./classify";
import { type RawAuthor, type RawMentionTarget, searchMentions } from "./github";
import { readConfigFile, writeConfigFile } from "./storage";
import { resolveToken } from "./token";

type Preferences = PluginSettings<typeof preferences.schema>;

export interface MentionRules {
  viewer: string;
  since: string;
  hideBots: boolean;
}

const DONE_FILE = "done-mentions.json";
const DONE_RETENTION_MS = 120 * 24 * 60 * 60 * 1000;
const EXCERPT_LENGTH = 280;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripNoise(body: string): string {
  return body
    .replace(/<!--[\s\S]*?-->/g, "")
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n");
}

function excerpt(body: string, pattern: RegExp): string {
  const text = stripNoise(body).replace(/\s+/g, " ").trim();
  const start = Math.max(0, text.search(pattern) - 80);
  const end = start + EXCERPT_LENGTH;
  return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}

function isBot(author: RawAuthor | null): boolean {
  return !author || author.__typename === "Bot" || author.login.endsWith("[bot]");
}

function reacted(groups: Array<{ viewerHasReacted: boolean }> | null): boolean {
  return !!groups?.some((group) => group.viewerHasReacted);
}

type Found = Omit<Mention, "section">;
type Fetched = Omit<Mentions, "mentions" | "stale"> & { mentions: Found[] };

const cache = new SharedCache<Fetched>("cache-mentions.json");

export function findMentions(target: RawMentionTarget, rules: MentionRules): Found[] {
  const viewer = normalizeLogin(rules.viewer);
  const pattern = new RegExp(`(^|[^\\w/@.-])@${escapeRegExp(rules.viewer)}(?![\\w-])`, "i");
  const byViewer = (author: RawAuthor | null) => !!author && normalizeLogin(author.login) === viewer;

  const comments = target.comments.nodes.filter((node): node is NonNullable<typeof node> => !!node);
  const reviews = (target.reviews?.nodes ?? []).filter(
    (node): node is NonNullable<typeof node> => !!node?.submittedAt,
  );
  const threads = (target.reviewThreads?.nodes ?? []).flatMap((thread) =>
    thread ? [{ ...thread, comments: thread.comments.nodes.filter((node): node is NonNullable<typeof node> => !!node) }] : [],
  );

  const viewerTimes = [
    ...comments.filter((c) => byViewer(c.author)).map((c) => c.createdAt),
    ...reviews.filter((r) => byViewer(r.author)).map((r) => r.submittedAt!),
    ...threads.flatMap((t) => t.comments.filter((c) => byViewer(c.author)).map((c) => c.createdAt)),
  ];
  const repliedAfter = (time: string) => viewerTimes.some((at) => at > time);

  const state = target.prState === "MERGED" ? "merged" : (target.prState ?? target.issueState) === "OPEN" ? "open" : "closed";
  const context = {
    number: target.number,
    title: target.title,
    url: target.url,
    repo: target.repository.nameWithOwner,
    isPullRequest: target.__typename === "PullRequest",
    state,
  } as const;

  const found: Found[] = [];
  const consider = (
    entry: { id: string; url: string; body: string; createdAt: string; author: RawAuthor | null },
    kind: Found["kind"],
    answered: boolean,
    path: string | null = null,
  ) => {
    if (byViewer(entry.author) || entry.createdAt < rules.since) return;
    if (rules.hideBots && isBot(entry.author)) return;
    if (!pattern.test(stripNoise(entry.body))) return;
    found.push({
      id: entry.id,
      url: entry.url,
      kind,
      author: entry.author?.login ?? "ghost",
      excerpt: excerpt(entry.body, pattern),
      createdAt: entry.createdAt,
      path,
      target: context,
      answered,
    });
  };

  consider(target, "description", reacted(target.reactionGroups) || repliedAfter(target.createdAt));
  for (const comment of comments) {
    consider(comment, "comment", reacted(comment.reactionGroups) || repliedAfter(comment.createdAt));
  }
  for (const review of reviews) {
    const createdAt = review.submittedAt!;
    consider({ ...review, createdAt }, "review", reacted(review.reactionGroups) || repliedAfter(createdAt));
  }
  for (const thread of threads) {
    for (const comment of thread.comments) {
      const answered =
        thread.isResolved ||
        reacted(comment.reactionGroups) ||
        thread.comments.some((reply) => byViewer(reply.author) && reply.createdAt > comment.createdAt);
      consider(comment, "review_comment", answered, thread.path);
    }
  }
  return found;
}

async function readDone(): Promise<Record<string, string>> {
  const text = await readConfigFile(DONE_FILE);
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, string>;
  } catch {
    return {};
  }
}

let writes: Promise<unknown> = Promise.resolve();

export function markMentionsDone(ids: string[], done: boolean): Promise<{ ok: boolean }> {
  const next = writes.then(async () => {
    const current = await readDone();
    const cutoff = new Date(Date.now() - DONE_RETENTION_MS).toISOString();
    const now = new Date().toISOString();
    for (const id of ids) {
      if (done) current[id] = now;
      else delete current[id];
    }
    const kept = Object.fromEntries(Object.entries(current).filter(([, at]) => at >= cutoff));
    await writeConfigFile(DONE_FILE, JSON.stringify(kept));
    return { ok: true };
  });
  writes = next.catch(() => undefined);
  return next;
}

export async function loadMentions(settings: Preferences, allowStale: boolean): Promise<Mentions> {
  const resolved = await resolveToken();
  if (!resolved) {
    throw new Error("No GitHub token configured. Add one under Settings → Plugins → GitHub PRs.");
  }
  const stored = await settings.read();
  const prefs = stored.status === "ready" ? stored.values : preferences.schema.parse({});
  const [{ value, stale }, done] = await Promise.all([
    cache.get(cacheKey(resolved.token, prefs), () => fetchMentions(resolved.token, prefs), allowStale),
    readDone(),
  ]);
  const mentions: Mention[] = value.mentions.map((found) => ({
    ...found,
    section: done[found.id] ? "done" : found.answered ? "answered" : "unanswered",
  }));
  return { ...value, mentions, stale };
}

async function fetchMentions(token: string, prefs: ReturnType<typeof preferences.schema.parse>): Promise<Fetched> {
  const since = new Date(Date.now() - prefs.mentionDays * 24 * 60 * 60 * 1000);
  const day = since.toISOString().slice(0, 10);
  const query = `mentions:@me archived:false updated:>=${day}${prefs.mentionsIncludeClosed ? "" : " is:open"} sort:updated-desc`;

  const { login, targets, warnings } = await searchMentions(token, query);
  const rules = { viewer: login, since: since.toISOString(), hideBots: prefs.mentionsHideBots };
  const mentions = targets.flatMap((target) => findMentions(target, rules));
  mentions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return { login, mentions, warnings, fetchedAt: new Date().toISOString() };
}
