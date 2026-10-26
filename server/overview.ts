import type { PluginSettings } from "@getpaseo/plugin/server";
import type { AuthStatus, Overview, PullRequest } from "../shared/rpc";
import { DEFAULT_READY_PATTERN, isValidPattern, preferences } from "../shared/settings";
import { describe, mySection, normalizeLogin, reviewSection } from "./classify";
import { fetchViewer, searchPullRequests } from "./github";
import { resolveToken } from "./token";

type Preferences = PluginSettings<typeof preferences.schema>;

const BASE_QUERY = "is:pr is:open archived:false";

function byUpdated(a: PullRequest, b: PullRequest): number {
  return b.updatedAt.localeCompare(a.updatedAt);
}

function byReadyAt(a: PullRequest, b: PullRequest): number {
  return (a.readyAt ?? "").localeCompare(b.readyAt ?? "");
}

export async function authStatus(): Promise<AuthStatus> {
  const resolved = await resolveToken();
  if (!resolved) return { source: "none", login: null, error: null };
  try {
    return { source: resolved.source, login: await fetchViewer(resolved.token), error: null };
  } catch (error) {
    return { source: resolved.source, login: null, error: String((error as Error).message ?? error) };
  }
}

export async function loadOverview(settings: Preferences): Promise<Overview> {
  const resolved = await resolveToken();
  if (!resolved) {
    throw new Error("No GitHub token configured. Add one under Settings → Plugins → GitHub PRs.");
  }
  const stored = await settings.read();
  const prefs = stored.status === "ready" ? stored.values : preferences.schema.parse({});

  const reviewQueries = [...new Set(prefs.reviewQueries.map((query) => query.trim()).filter(Boolean))];
  const { login, results, warnings } = await searchPullRequests(resolved.token, [
    `${BASE_QUERY} author:@me`,
    ...reviewQueries.map((query) => `${BASE_QUERY} ${query}`),
  ]);

  const rules = {
    viewer: login,
    readyPattern: new RegExp(
      isValidPattern(prefs.readyPattern) ? prefs.readyPattern : DEFAULT_READY_PATTERN,
      "i",
    ),
    botLogins: new Set(prefs.reviewBotLogins.map(normalizeLogin).filter(Boolean)),
    botActivityResetsReady: prefs.botActivityResetsReady,
  };

  const [authored = [], ...requested] = results;
  const mine = authored.map((raw) => {
    const pr = describe(raw, rules);
    return { ...pr, section: mySection(pr) };
  });

  const seen = new Set<string>();
  const reviews: PullRequest[] = [];
  for (const raw of requested.flat()) {
    if (seen.has(raw.id) || normalizeLogin(raw.author?.login ?? "") === normalizeLogin(login)) continue;
    seen.add(raw.id);
    const pr = describe(raw, rules);
    reviews.push({ ...pr, section: reviewSection(pr) });
  }

  const sort = (prs: PullRequest[]) =>
    prs.sort((a, b) => {
      if (a.section !== b.section) return a.section.localeCompare(b.section);
      return a.section === "ready" || a.section === "review" ? byReadyAt(a, b) : byUpdated(a, b);
    });

  return {
    login,
    mine: sort(mine),
    reviews: sort(reviews),
    warnings,
    fetchedAt: new Date().toISOString(),
  };
}
