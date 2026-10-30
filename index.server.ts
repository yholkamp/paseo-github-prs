import type { PluginServerContext } from "@getpaseo/plugin/server";
import { readOwnerFilter, saveOwnerFilter } from "./server/filter";
import { fetchViewer } from "./server/github";
import { loadMentions, markMentionsDone } from "./server/mentions";
import { startNightlyReviews, stopNightlyReviews } from "./server/nightly";
import { authStatus, loadOverview } from "./server/overview";
import { currentReviewJobs, currentReviewRecords, startReviewJob } from "./server/review";
import { deleteStoredToken, storeToken } from "./server/token";
import {
  clearToken,
  getAuthStatus,
  getMentions,
  getOverview,
  getOwnerFilter,
  listReviewJobs,
  saveToken,
  setMentionsDone,
  setOwnerFilter,
  startReview,
} from "./shared/rpc";
import { NIGHTLY_REVIEW_TITLE, preferences } from "./shared/settings";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(preferences);

  server.handle(getOverview, ({ allowStale }) => loadOverview(settings, !!allowStale));
  server.handle(getMentions, ({ allowStale }) => loadMentions(settings, !!allowStale));
  server.handle(setMentionsDone, ({ ids, done }) => markMentionsDone(ids, done));
  server.handle(getOwnerFilter, () => readOwnerFilter());
  server.handle(setOwnerFilter, (filter) => saveOwnerFilter(filter));
  server.handle(startReview, (target, { paseo }) => startReviewJob(target, paseo, settings));
  server.handle(listReviewJobs, async () => ({ jobs: currentReviewJobs(), reviews: await currentReviewRecords() }));
  server.handle(getAuthStatus, () => authStatus());
  server.handle(saveToken, async ({ token }) => {
    await fetchViewer(token.trim());
    await storeToken(token);
    return authStatus();
  });
  server.handle(clearToken, async () => {
    await deleteStoredToken();
    return authStatus();
  });

  server.on("agent.created", async ({ agent }, { paseo }) => {
    if (agent.title?.trim() !== NIGHTLY_REVIEW_TITLE) return;
    const snapshot = await paseo.agents.ref(agent.id).refresh().catch(() => null);
    if (!snapshot?.agent.labels?.["paseo.schedule-id"]) return;
    void startNightlyReviews(paseo, settings);
  });

  return () => stopNightlyReviews();
}
