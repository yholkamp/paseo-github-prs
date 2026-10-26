import { execCommand } from "@getpaseo/plugin/server";

const GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? "ssh -o BatchMode=yes",
};

export async function git(cwd: string | null, args: string[], timeout = 120_000): Promise<string> {
  try {
    const { stdout } = await execCommand("git", cwd ? ["-C", cwd, ...args] : args, {
      env: GIT_ENV,
      timeout,
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout.trim();
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new Error(`git ${args[0]} failed${stderr ? `: ${stderr.split("\n").slice(-3).join(" ")}` : ""}`);
  }
}

export async function gitOk(cwd: string, args: string[]): Promise<boolean> {
  return git(cwd, args).then(
    () => true,
    () => false,
  );
}

export interface GitHubRemote {
  name: string;
  url: string;
  repo: string;
}

export function parseGitHubRepo(url: string): string | null {
  const match = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(url.trim());
  return match ? `${match[1]}/${match[2]}` : null;
}

export async function githubRemotes(cwd: string): Promise<GitHubRemote[]> {
  const output = await git(cwd, ["config", "--get-regexp", "^remote\\..*\\.url$"], 10_000).catch(() => "");
  const remotes = new Map<string, GitHubRemote>();
  for (const line of output.split("\n")) {
    const match = /^remote\.(.+)\.url\s+(\S+)$/.exec(line.trim());
    const repo = match ? parseGitHubRepo(match[2]!) : null;
    if (match && repo && !remotes.has(match[1]!)) remotes.set(match[1]!, { name: match[1]!, url: match[2]!, repo });
  }
  return [...remotes.values()].sort((a, b) => (a.name === "origin" ? -1 : b.name === "origin" ? 1 : 0));
}
