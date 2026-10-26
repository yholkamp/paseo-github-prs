import type { PluginClientContext, PluginScreenProps } from "@getpaseo/plugin/client";
import { PullRequestsScreen } from "./client/PullRequestsScreen";
import { SettingsScreen } from "./client/SettingsScreen";
import { PullRequestsSidebarItem } from "./client/SidebarItem";

export default function contribute(client: PluginClientContext) {
  const openSettings = () => client.openSettings("github");

  client.addScreen({
    id: "pull-requests",
    title: "Pull requests",
    Component: (props: PluginScreenProps) => <PullRequestsScreen {...props} openSettings={openSettings} />,
  });
  client.addSidebarHeaderItem({ id: "pull-requests", title: "Pull requests", Component: PullRequestsSidebarItem });
  client.addSettingsScreen({ id: "github", title: "GitHub PRs", icon: "GitPullRequest", Component: SettingsScreen });
  client.addCommandCenterItem({
    id: "open-pull-requests",
    title: "Open pull request overview",
    icon: "GitPullRequest",
    keywords: ["github", "review", "pr"],
    context: "global",
    onSelect({ openScreen }) {
      openScreen({ screenId: "pull-requests" });
    },
  });

  return () => {};
}
