import type { PluginHandlerContext, PluginSettings } from "@getpaseo/plugin/server";
import { type PullRequest, repoOwner, reviewKey } from "../shared/rpc";
import { preferences } from "../shared/settings";
import { readOwnerFilter } from "./filter";
import { loadOverview } from "./overview";
import { currentReviewRecords, startReviewJob } from "./review";

type Paseo = PluginHandlerContext["paseo"];
type Preferences = PluginSettings<typeof preferences.schema>;

const NIGHTLY_SECTIONS = new Set(["ready", "rereview"]);
const timers = new Set<ReturnType<typeof setTimeout>>();
let running = false;

async function nightlyQueue(settings: Preferences): Promise<PullRequest[]> {
  const [overview, filter, records] = await Promise.all([
    loadOverview(settings, false),
    readOwnerFilter(),
    currentReviewRecords(),
  ]);
  const owners = new Set(filter.owners.map((owner) => owner.toLowerCase()));
  const reviewed = new Map(records.map((record) => [record.key, record.headSha]));
  return overview.reviews.filter(
    (pr) =>
      NIGHTLY_SECTIONS.has(pr.section) &&
      (owners.size === 0 || owners.has(repoOwner(pr.repo).toLowerCase())) &&
      reviewed.get(reviewKey(pr.repo, pr.number)) !== pr.headSha,
  );
}

export async function startNightlyReviews(paseo: Paseo, settings: Preferences): Promise<void> {
  if (running) {
    console.log("Nightly review skipped: the previous run is still in progress.");
    return;
  }
  running = true;
  try {
    const stored = await settings.read();
    const prefs = stored.status === "ready" ? stored.values : preferences.schema.parse({});
    const queue = await nightlyQueue(settings);
    console.log(`Nightly review: ${queue.length} pull requests, ${prefs.nightlyStaggerMinutes} minutes apart.`);
    if (queue.length === 0) {
      running = false;
      return;
    }
    queue.forEach((pr, index) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        startReviewJob(
          {
            repo: pr.repo,
            number: pr.number,
            title: pr.title,
            url: pr.url,
            headRefName: pr.headRefName,
            baseRefName: pr.baseRefName,
            isCrossRepository: pr.isCrossRepository,
          },
          paseo,
          settings,
        );
        if (timers.size === 0) running = false;
      }, index * prefs.nightlyStaggerMinutes * 60_000);
      timers.add(timer);
    });
  } catch (error) {
    running = false;
    console.error(`Nightly review failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function stopNightlyReviews(): void {
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
  running = false;
}
