import { execCommand } from "@getpaseo/plugin/server";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { AuthStatus } from "../shared/rpc";
import { configDir, readConfigFile, writeConfigFile } from "./storage";

type Source = AuthStatus["source"];

export interface ResolvedToken {
  token: string;
  source: Exclude<Source, "none">;
}

const TOKEN_FILE = "token";

let cached: Promise<ResolvedToken | null> | null = null;

export function resolveToken(): Promise<ResolvedToken | null> {
  cached ??= lookupToken();
  return cached;
}

export function forgetToken(): void {
  cached = null;
}

export async function storeToken(token: string): Promise<void> {
  await writeConfigFile(TOKEN_FILE, token.trim() + "\n");
  forgetToken();
}

export async function deleteStoredToken(): Promise<void> {
  await rm(join(configDir, TOKEN_FILE), { force: true });
  forgetToken();
}

async function lookupToken(): Promise<ResolvedToken | null> {
  const saved = (await readConfigFile(TOKEN_FILE))?.trim();
  if (saved) return { token: saved, source: "saved" };

  const env = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim();
  if (env) return { token: env, source: "env" };

  try {
    const { stdout } = await execCommand("gh", ["auth", "token"], { timeout: 5000 });
    const token = stdout.trim();
    if (token) return { token, source: "gh" };
  } catch {
    // gh is missing or not logged in
  }
  return null;
}
