import type { PluginTheme } from "@getpaseo/plugin";
import { Pressable, Text, View } from "react-native";
import type { Merged, MergedPullRequest } from "../shared/rpc";
import { Badge, CollapsibleSection, type Styles, type Tone, useOpenUrl } from "./components";
import { MERGED_SECTIONS, timeAgo } from "./data";

function environmentBadge(environment: MergedPullRequest["staging"]): { label: string; tone: Tone; icon: string } | null {
  if (!environment) return null;
  if (environment.contains === null) return { label: `${environment.branch} unknown`, tone: "muted", icon: "CircleHelp" };
  return environment.contains
    ? { label: `On ${environment.branch}`, tone: "success", icon: "CircleCheck" }
    : { label: `Not on ${environment.branch}`, tone: "warning", icon: "Clock" };
}

function MergedCard({ pr, theme, styles }: { pr: MergedPullRequest; theme: PluginTheme; styles: Styles }) {
  const openUrl = useOpenUrl();
  const badges = [
    { label: `Merged into ${pr.baseRefName}`, tone: "muted" as const, icon: "GitMerge" },
    environmentBadge(pr.staging),
    environmentBadge(pr.production),
  ].filter((badge) => badge !== null);
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${pr.repo} pull request ${pr.number}: ${pr.title}`}
      onPress={() => openUrl(pr.url)}
      style={({ pressed }) => [styles.card, pressed ? styles.cardPressed : null]}
    >
      <View style={styles.meta}>
        <Text style={styles.metaText} numberOfLines={1}>
          {pr.repo} #{pr.number}
        </Text>
        <View style={styles.metaSpacer} />
        <Text style={styles.metaText}>merged {timeAgo(pr.mergedAt)}</Text>
      </View>
      <Text style={styles.title} numberOfLines={2}>
        {pr.title}
      </Text>
      <View style={styles.badges}>
        {badges.map((badge) => (
          <Badge key={badge.label} {...badge} theme={theme} styles={styles} />
        ))}
      </View>
    </Pressable>
  );
}

export function MergedList({
  data,
  filtered,
  theme,
  styles,
}: {
  data: Merged;
  filtered: boolean;
  theme: PluginTheme;
  styles: Styles;
}) {
  if (data.prs.length === 0) {
    return (
      <Text style={styles.empty}>
        {filtered ? "No merged pull requests for the selected organizations." : "You merged no pull requests in the selected period."}
      </Text>
    );
  }
  return (
    <>
      {MERGED_SECTIONS.map((info) => {
        const items = data.prs.filter((pr) => pr.section === info.id);
        return (
          <CollapsibleSection
            key={info.id}
            title={info.title}
            count={items.length}
            collapsed={info.collapsed}
            theme={theme}
            styles={styles}
          >
            {items.map((pr) => (
              <MergedCard key={pr.id} pr={pr} theme={theme} styles={styles} />
            ))}
          </CollapsibleSection>
        );
      })}
    </>
  );
}
