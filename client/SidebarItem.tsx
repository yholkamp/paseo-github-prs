import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { Text, View } from "react-native";
import { attentionCount, useMentions, useOverview } from "./data";

export function PullRequestsSidebarItem({ theme, currentScreen, openScreen }: PluginSidebarItemProps) {
  const overview = useOverview();
  const mentions = useMentions();
  const count = attentionCount(overview.data, mentions.data);
  return (
    <SidebarRow
      icon="GitPullRequest"
      label="Pull requests"
      active={currentScreen?.screenId === "pull-requests"}
      onPress={() => openScreen({ screenId: "pull-requests" })}
      trailing={
        count > 0 ? (
          <View
            accessibilityLabel={`${count} pull requests need you`}
            style={{ minWidth: 20, paddingHorizontal: 6, borderRadius: 999, backgroundColor: theme.colors.accent, alignItems: "center" }}
          >
            <Text style={{ color: theme.colors.accentForeground, fontSize: 12, fontWeight: "600" }}>{count}</Text>
          </View>
        ) : null
      }
    />
  );
}
