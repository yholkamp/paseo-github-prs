import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pressable, Text, View } from "react-native";
import { type Mention, type Mentions, setMentionsDone } from "../shared/rpc";
import { Badge, CollapsibleSection, type Styles, useOpenUrl } from "./components";
import { MENTION_SECTIONS, MENTIONS_KEY, timeAgo } from "./data";

const ACTIONS: Record<Mention["kind"], string> = {
  comment: "commented",
  review: "reviewed",
  review_comment: "commented on",
  description: "mentioned you in the description",
};

function useMarkDone() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const markDone = useRpc(setMentionsDone);
  return useMutation({
    mutationFn: markDone,
    onMutate({ ids, done }) {
      queryClient.setQueriesData<Mentions>({ queryKey: MENTIONS_KEY }, (data) =>
        data
          ? {
              ...data,
              mentions: data.mentions.map((mention) =>
                ids.includes(mention.id)
                  ? { ...mention, section: done ? "done" : mention.answered ? "answered" : "unanswered" }
                  : mention,
              ),
            }
          : data,
      );
    },
    onError(error) {
      toast.error(error.message);
      void queryClient.invalidateQueries({ queryKey: MENTIONS_KEY });
    },
  });
}

function MentionCard({
  mention,
  theme,
  styles,
  onToggleDone,
}: {
  mention: Mention;
  theme: PluginTheme;
  styles: Styles;
  onToggleDone(): void;
}) {
  const openUrl = useOpenUrl();
  const { target } = mention;
  const done = mention.section === "done";
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`@${mention.author} ${ACTIONS[mention.kind]} on ${target.repo} ${target.number}`}
      onPress={() => openUrl(mention.url)}
      style={({ pressed }) => [styles.card, pressed ? styles.cardPressed : null]}
    >
      <View style={styles.meta}>
        <Icon
          name={target.isPullRequest ? "GitPullRequest" : "CircleDot"}
          size={14}
          color={theme.colors.foregroundMuted}
        />
        <Text style={styles.metaText} numberOfLines={1}>
          {target.repo} #{target.number}
        </Text>
        <View style={styles.metaSpacer} />
        <Text style={styles.metaText}>{timeAgo(mention.createdAt)}</Text>
      </View>
      <Text style={styles.title} numberOfLines={1}>
        {target.title}
      </Text>
      <Text style={styles.metaText} numberOfLines={1}>
        @{mention.author} {ACTIONS[mention.kind]}
        {mention.path ? ` ${mention.path}` : ""}
      </Text>
      {mention.excerpt ? (
        <Text style={styles.body} numberOfLines={4}>
          {mention.excerpt}
        </Text>
      ) : null}
      <View style={styles.meta}>
        <View style={styles.badges}>
          {target.state !== "open" ? (
            <Badge label={target.state === "merged" ? "Merged" : "Closed"} tone="muted" theme={theme} styles={styles} />
          ) : null}
          {mention.answered ? <Badge label="Answered" tone="success" icon="Check" theme={theme} styles={styles} /> : null}
        </View>
        <View style={styles.metaSpacer} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={done ? "Move back to the mention list" : "Mark mention as done"}
          onPress={onToggleDone}
          style={styles.smallButton}
        >
          <Icon name={done ? "Undo2" : "Check"} size={12} color={theme.colors.foreground} />
          <Text style={styles.smallButtonText}>{done ? "Undo" : "Done"}</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

export function MentionsList({
  data,
  filtered,
  theme,
  styles,
}: {
  data: Mentions;
  filtered: boolean;
  theme: PluginTheme;
  styles: Styles;
}) {
  const markDone = useMarkDone();
  if (data.mentions.length === 0) {
    return (
      <Text style={styles.empty}>
        {filtered ? "No mentions for the selected organizations." : "No mentions in the selected period."}
      </Text>
    );
  }
  return (
    <>
      {MENTION_SECTIONS.map((info) => {
        const items = data.mentions.filter((mention) => mention.section === info.id);
        return (
          <CollapsibleSection
            key={info.id}
            title={info.title}
            count={items.length}
            collapsed={info.collapsed}
            theme={theme}
            styles={styles}
          >
            {items.map((mention) => (
              <MentionCard
                key={mention.id}
                mention={mention}
                theme={theme}
                styles={styles}
                onToggleDone={() => markDone.mutate({ ids: [mention.id], done: mention.section !== "done" })}
              />
            ))}
          </CollapsibleSection>
        );
      })}
    </>
  );
}
