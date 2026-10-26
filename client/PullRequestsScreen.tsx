import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, type PluginScreenProps } from "@getpaseo/plugin/client";
import { Icon, Loading } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { PullRequest } from "../shared/rpc";
import { Badge, CollapsibleSection, type Styles, type Tone, useStyles } from "./components";
import {
  mentionCount,
  MY_SECTIONS,
  REVIEW_SECTIONS,
  reviewCount,
  type SectionInfo,
  timeAgo,
  useMentions,
  useOverview,
} from "./data";
import { MentionsList } from "./Mentions";

type Tab = "reviews" | "mine" | "mentions";

interface Props extends PluginScreenProps {
  openSettings(): void;
}

interface BadgeSpec {
  label: string;
  tone: Tone;
  icon?: string;
}

function badgesFor(pr: PullRequest, tab: Tab): BadgeSpec[] {
  const badges: BadgeSpec[] = [];
  if (pr.ci === "failure") {
    const names = pr.failingChecks.slice(0, 2).join(", ");
    const more = pr.failingChecks.length > 2 ? ` +${pr.failingChecks.length - 2}` : "";
    badges.push({ label: names ? `Failing: ${names}${more}` : "Checks failing", tone: "danger", icon: "CircleX" });
  } else if (pr.ci === "pending") {
    badges.push({ label: pr.pendingChecks ? `${pr.pendingChecks} checks running` : "Checks running", tone: "warning", icon: "Clock" });
  } else if (pr.ci === "success") {
    badges.push({ label: "Checks passed", tone: "success", icon: "CircleCheck" });
  }
  if (pr.conflicting) badges.push({ label: "Merge conflict", tone: "danger", icon: "GitMerge" });
  if (pr.reviewDecision === "approved") badges.push({ label: "Approved", tone: "success", icon: "Check" });
  else if (pr.reviewDecision === "changes_requested") badges.push({ label: "Changes requested", tone: "danger", icon: "MessageSquareWarning" });
  else if (pr.approvals > 0) badges.push({ label: `${pr.approvals} approval${pr.approvals > 1 ? "s" : ""}`, tone: "success" });

  if (pr.stage === "ready" && pr.readyAt) badges.push({ label: `Ready ${timeAgo(pr.readyAt)}`, tone: "muted", icon: "Flag" });
  else if (pr.stage === "bot") badges.push({ label: "With review bot", tone: "muted", icon: "Bot" });

  if (tab === "reviews") {
    if (pr.myReview === "approved") badges.push({ label: "You approved", tone: "success" });
    else if (pr.myReview === "changes_requested") badges.push({ label: "You requested changes", tone: "warning" });
    else if (pr.myReview === "commented") badges.push({ label: "You commented", tone: "muted" });
    if (pr.changedSinceMyReview) badges.push({ label: "Updated since your review", tone: "warning", icon: "RefreshCw" });
  }
  return badges;
}

function PullRequestCard({ pr, tab, theme, styles }: { pr: PullRequest; tab: Tab; theme: PluginTheme; styles: Styles }) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${pr.repo} pull request ${pr.number}: ${pr.title}`}
      onPress={() => void openExternalUrl(pr.url)}
      style={({ pressed }) => [styles.card, pressed ? styles.cardPressed : null]}
    >
      <View style={styles.meta}>
        <Text style={styles.metaText} numberOfLines={1}>
          {pr.repo} #{pr.number}
          {tab === "reviews" ? ` · @${pr.author}` : ""}
        </Text>
        <View style={styles.metaSpacer} />
        <Text style={styles.metaText}>{timeAgo(pr.updatedAt)}</Text>
      </View>
      <Text style={styles.title} numberOfLines={2}>
        {pr.title}
      </Text>
      <View style={styles.badges}>
        {badgesFor(pr, tab).map((badge) => (
          <Badge key={badge.label} {...badge} theme={theme} styles={styles} />
        ))}
      </View>
    </Pressable>
  );
}

function PullRequestList({
  prs,
  sections,
  tab,
  theme,
  styles,
}: {
  prs: PullRequest[];
  sections: SectionInfo<string>[];
  tab: Tab;
  theme: PluginTheme;
  styles: Styles;
}) {
  if (prs.length === 0) {
    return (
      <Text style={styles.empty}>{tab === "mine" ? "You have no open pull requests." : "Nothing in your review queue."}</Text>
    );
  }
  return (
    <>
      {sections.map((info) => {
        const items = prs.filter((pr) => pr.section === info.id);
        return (
          <CollapsibleSection
            key={`${tab}-${info.id}`}
            title={info.title}
            count={items.length}
            collapsed={info.collapsed}
            theme={theme}
            styles={styles}
          >
            {items.map((pr) => (
              <PullRequestCard key={pr.id} pr={pr} tab={tab} theme={theme} styles={styles} />
            ))}
          </CollapsibleSection>
        );
      })}
    </>
  );
}

function initialTab(value: string | undefined): Tab {
  return value === "mine" || value === "mentions" ? value : "reviews";
}

export function PullRequestsScreen({ theme, layout, params, openSettings }: Props) {
  const styles = useStyles(theme, layout.compact);
  const [tab, setTab] = useState<Tab>(initialTab(params.tab));
  const overview = useOverview();
  const mentions = useMentions();
  const active = tab === "mentions" ? mentions : overview;

  if (overview.isPending && mentions.isPending) {
    return <Loading />;
  }

  const tabs: Array<[Tab, string]> = [
    ["reviews", `To review · ${reviewCount(overview.data)}`],
    ["mine", `My PRs · ${overview.data?.mine.length ?? 0}`],
    ["mentions", `Mentions · ${mentionCount(mentions.data)}`],
  ];
  const warnings = [...new Set([...(overview.data?.warnings ?? []), ...(mentions.data?.warnings ?? [])])];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.toolbar}>
        <Text style={styles.toolbarText} numberOfLines={1}>
          {active.data ? `@${active.data.login} · updated ${timeAgo(active.data.fetchedAt)}` : "GitHub"}
          {overview.isFetching || mentions.isFetching ? " · refreshing…" : ""}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh"
          onPress={() => {
            void overview.refetch();
            void mentions.refetch();
          }}
          style={styles.iconButton}
        >
          <Icon name="RefreshCw" size={16} color={theme.colors.foreground} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="GitHub PR settings" onPress={openSettings} style={styles.iconButton}>
          <Icon name="Settings" size={16} color={theme.colors.foreground} />
        </Pressable>
      </View>

      {warnings.length ? (
        <View style={[styles.notice, { borderColor: theme.colors.statusWarning }]}>
          {warnings.map((warning) => (
            <Text key={warning} style={styles.noticeText}>
              {warning}
            </Text>
          ))}
        </View>
      ) : null}

      <View style={styles.tabs} accessibilityRole="tablist">
        {tabs.map(([id, label]) => (
          <Pressable
            key={id}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === id }}
            onPress={() => setTab(id)}
            style={[styles.tab, tab === id ? styles.tabActive : null]}
          >
            <Text style={tab === id ? styles.tabTextActive : styles.tabText} numberOfLines={1}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      {active.error ? (
        <View style={[styles.notice, { borderColor: theme.colors.statusDanger }]}>
          <Text style={styles.noticeText}>{active.error.message}</Text>
          <Pressable accessibilityRole="button" onPress={openSettings} style={styles.button}>
            <Text style={styles.buttonText}>Open settings</Text>
          </Pressable>
        </View>
      ) : null}

      {active.isPending ? (
        <Loading />
      ) : tab === "mentions" ? (
        mentions.data ? <MentionsList data={mentions.data} theme={theme} styles={styles} /> : null
      ) : overview.data ? (
        <PullRequestList
          prs={tab === "mine" ? overview.data.mine : overview.data.reviews}
          sections={tab === "mine" ? MY_SECTIONS : REVIEW_SECTIONS}
          tab={tab}
          theme={theme}
          styles={styles}
        />
      ) : null}
    </ScrollView>
  );
}
