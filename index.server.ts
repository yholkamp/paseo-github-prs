import type { PluginServerContext } from "@getpaseo/plugin/server";
import { fetchViewer } from "./server/github";
import { loadMentions, markMentionsDone } from "./server/mentions";
import { authStatus, loadOverview } from "./server/overview";
import { deleteStoredToken, storeToken } from "./server/token";
import { clearToken, getAuthStatus, getMentions, getOverview, saveToken, setMentionsDone } from "./shared/rpc";
import { preferences } from "./shared/settings";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(preferences);

  server.handle(getOverview, () => loadOverview(settings));
  server.handle(getMentions, () => loadMentions(settings));
  server.handle(setMentionsDone, ({ ids, done }) => markMentionsDone(ids, done));
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

  return () => {};
}
