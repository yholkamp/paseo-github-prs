import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const DEFAULT_READY_PATTERN = "ready for (a |human |another )?review";

export const DEFAULT_REVIEW_PROVIDER = "claude/claude-opus-5-5";
const REVIEW_GROUPING =
  "When the review is done, end your reply with the findings grouped under three headings: Required before merging, Not blocking, and Minor nits. Write None under a heading without findings.";

const V1_REVIEW_PROMPT = "/code-review high {branch}";
const V1_FOLLOW_UP_PROMPT =
  "The pull request has new commits since your last review ({previous}..{head}) and the workspace is updated to {head}. Review the changes since your last review the same way, and for each issue you raised before, say whether it was addressed.";

export const DEFAULT_REVIEW_PROMPT = `${V1_REVIEW_PROMPT} ${REVIEW_GROUPING}`;
export const DEFAULT_FOLLOW_UP_PROMPT = `${V1_FOLLOW_UP_PROMPT} ${REVIEW_GROUPING}`;

export const NIGHTLY_REVIEW_TITLE = "GitHub PRs nightly review";

export const DEFAULT_REVIEW_QUERIES = ["review-requested:@me", "reviewed-by:@me"];

export const preferences = defineSettings({
  id: "preferences",
  scope: "host",
  version: 2,
  migrate: (values) => {
    if (!values || typeof values !== "object") return values;
    const stored = values as Record<string, unknown>;
    return {
      ...stored,
      ...(stored.reviewPrompt === V1_REVIEW_PROMPT ? { reviewPrompt: DEFAULT_REVIEW_PROMPT } : {}),
      ...(stored.followUpPrompt === V1_FOLLOW_UP_PROMPT ? { followUpPrompt: DEFAULT_FOLLOW_UP_PROMPT } : {}),
    };
  },
  schema: z.object({
    readyPattern: z.string().default(DEFAULT_READY_PATTERN),
    reviewBotLogins: z.array(z.string()).default([]),
    botActivityResetsReady: z.boolean().default(true),
    reviewQueries: z.array(z.string()).default(DEFAULT_REVIEW_QUERIES),
    hideDependabot: z.boolean().default(true),
    skipOthersReviewing: z.boolean().default(true),
    reviewActivityWeeks: z.number().int().min(0).max(52).default(2),
    refreshMinutes: z.number().int().min(0).max(60).default(5),
    mentionDays: z.number().int().min(1).max(90).default(14),
    mentionsIncludeClosed: z.boolean().default(false),
    mentionsHideBots: z.boolean().default(true),
    reviewProvider: z.string().default(DEFAULT_REVIEW_PROVIDER),
    reviewPrompt: z.string().default(DEFAULT_REVIEW_PROMPT),
    followUpPrompt: z.string().default(DEFAULT_FOLLOW_UP_PROMPT),
    cloneDirectory: z.string().default(""),
    nightlyStaggerMinutes: z.number().int().min(1).max(60).default(10),
  }),
});

export function isValidPattern(pattern: string): boolean {
  try {
    new RegExp(pattern, "i");
    return pattern.trim().length > 0;
  } catch {
    return false;
  }
}
