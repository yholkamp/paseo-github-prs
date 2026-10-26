import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const configDir = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "paseo-github-prs");

export async function readConfigFile(name: string): Promise<string | null> {
  return readFile(join(configDir, name), "utf8").catch(() => null);
}

export async function writeConfigFile(name: string, content: string): Promise<void> {
  await mkdir(configDir, { recursive: true, mode: 0o700 });
  await writeFile(join(configDir, name), content, { mode: 0o600 });
}
