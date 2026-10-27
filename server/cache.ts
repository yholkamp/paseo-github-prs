import { createHash } from "node:crypto";
import { readConfigFile, writeConfigFile } from "./storage";

const FRESH_MS = 30_000;

interface Entry<T> {
  key: string;
  at: number;
  value: T;
}

export function cacheKey(...parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export class SharedCache<T> {
  private entry: Entry<T> | null | undefined;
  private readonly inflight = new Map<string, Promise<T>>();

  constructor(private readonly file: string) {}

  async get(key: string, load: () => Promise<T>, allowStale: boolean): Promise<{ value: T; stale: boolean }> {
    const entry = await this.stored();
    if (entry?.key === key) {
      if (Date.now() - entry.at < FRESH_MS) return { value: entry.value, stale: false };
      if (allowStale) {
        this.refresh(key, load).catch(() => undefined);
        return { value: entry.value, stale: true };
      }
    }
    return { value: await this.refresh(key, load), stale: false };
  }

  private async stored(): Promise<Entry<T> | null> {
    if (this.entry === undefined) {
      const text = await readConfigFile(this.file);
      try {
        this.entry ??= text ? (JSON.parse(text) as Entry<T>) : null;
      } catch {
        this.entry ??= null;
      }
    }
    return this.entry;
  }

  private refresh(key: string, load: () => Promise<T>): Promise<T> {
    const running = this.inflight.get(key);
    if (running) return running;
    const next = load()
      .then((value) => {
        this.entry = { key, at: Date.now(), value };
        writeConfigFile(this.file, JSON.stringify(this.entry)).catch(() => undefined);
        return value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, next);
    return next;
  }
}
