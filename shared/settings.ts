import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const DEFAULT_READY_PATTERN = "ready for (a |human |another )?review";

export const DEFAULT_REVIEW_QUERIES = ["review-requested:@me", "reviewed-by:@me"];

export const preferences = defineSettings({
  id: "preferences",
  scope: "host",
  version: 1,
  schema: z.object({
    readyPattern: z.string().default(DEFAULT_READY_PATTERN),
    reviewBotLogins: z.array(z.string()).default([]),
    botActivityResetsReady: z.boolean().default(true),
    reviewQueries: z.array(z.string()).default(DEFAULT_REVIEW_QUERIES),
    refreshMinutes: z.number().int().min(0).max(60).default(5),
    mentionDays: z.number().int().min(1).max(90).default(14),
    mentionsIncludeClosed: z.boolean().default(false),
    mentionsHideBots: z.boolean().default(true),
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
