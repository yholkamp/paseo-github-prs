import { type OwnerFilter, ownerFilter } from "../shared/rpc";
import { readConfigFile, writeConfigFile } from "./storage";

const FILTER_FILE = "owner-filter.json";

export async function readOwnerFilter(): Promise<OwnerFilter> {
  const text = await readConfigFile(FILTER_FILE);
  try {
    return ownerFilter.parse(JSON.parse(text ?? ""));
  } catch {
    return { owners: [] };
  }
}

let writes: Promise<unknown> = Promise.resolve();

export function saveOwnerFilter(filter: OwnerFilter): Promise<OwnerFilter> {
  const next = writes.then(async () => {
    await writeConfigFile(FILTER_FILE, JSON.stringify(filter));
    return filter;
  });
  writes = next.catch(() => undefined);
  return next;
}
