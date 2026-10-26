import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl } from "@getpaseo/plugin/client";
import { copyText, Icon, useToast } from "@getpaseo/plugin/client/ui";
import { type ReactNode, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

export type Tone = "success" | "danger" | "warning" | "muted";

export function useStyles(theme: PluginTheme, compact: boolean) {
  return useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      content: {
        padding: compact ? 12 : 24,
        gap: compact ? 12 : 16,
        maxWidth: 960,
        width: "100%" as const,
        alignSelf: "center" as const,
      },
      toolbar: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      toolbarText: { flex: 1, color: theme.colors.foregroundMuted, fontSize: 13 },
      iconButton: { padding: 8, borderRadius: 8, backgroundColor: theme.colors.surface2 },
      tabs: {
        flexDirection: "row" as const,
        gap: 4,
        padding: 4,
        borderRadius: 10,
        backgroundColor: theme.colors.surface1,
      },
      tab: { flex: 1, paddingVertical: 8, paddingHorizontal: 4, borderRadius: 8, alignItems: "center" as const },
      tabActive: { backgroundColor: theme.colors.accent },
      tabText: { color: theme.colors.foregroundMuted, fontWeight: "600" as const, fontSize: compact ? 13 : 14 },
      tabTextActive: { color: theme.colors.accentForeground, fontWeight: "600" as const, fontSize: compact ? 13 : 14 },
      section: { gap: 8 },
      sectionHeader: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, paddingVertical: 4 },
      sectionTitle: { color: theme.colors.foreground, fontWeight: "600" as const, fontSize: 15 },
      sectionCount: { color: theme.colors.foregroundMuted, fontSize: 13 },
      card: {
        padding: compact ? 12 : 14,
        gap: 6,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
      cardPressed: { backgroundColor: theme.colors.surface2 },
      meta: { flexDirection: "row" as const, gap: 6, alignItems: "center" as const },
      metaText: { color: theme.colors.foregroundMuted, fontSize: 12, flexShrink: 1 },
      metaSpacer: { flex: 1 },
      title: { color: theme.colors.foreground, fontSize: 14, fontWeight: "500" as const },
      body: { color: theme.colors.foreground, fontSize: 13, lineHeight: 19 },
      badges: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6 },
      badge: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 999,
        borderWidth: 1,
      },
      badgeText: { fontSize: 12 },
      smallButton: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 4,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 6,
        backgroundColor: theme.colors.surface2,
      },
      smallButtonText: { color: theme.colors.foreground, fontSize: 12 },
      empty: { color: theme.colors.foregroundMuted, paddingVertical: 24, textAlign: "center" as const },
      notice: {
        padding: 12,
        gap: 8,
        borderRadius: 10,
        borderWidth: 1,
        backgroundColor: theme.colors.surface1,
      },
      noticeText: { color: theme.colors.foreground },
      button: {
        alignSelf: "flex-start" as const,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 8,
        backgroundColor: theme.colors.accent,
      },
      buttonText: { color: theme.colors.accentForeground, fontWeight: "600" as const },
    }),
    [theme, compact],
  );
}

export type Styles = ReturnType<typeof useStyles>;

export function useOpenUrl(): (url: string) => void {
  const toast = useToast();
  return (url) => {
    const fail = (error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error);
      copyText(url).then(
        () => toast.error(`Could not open your browser (${reason}). Link copied to the clipboard.`),
        () => toast.error(`Could not open your browser (${reason}).`),
      );
    };
    try {
      openExternalUrl(url).catch(fail);
    } catch (error) {
      fail(error);
    }
  };
}

export function toneColor(theme: PluginTheme, tone: Tone): string {
  switch (tone) {
    case "success":
      return theme.colors.statusSuccess;
    case "danger":
      return theme.colors.statusDanger;
    case "warning":
      return theme.colors.statusWarning;
    default:
      return theme.colors.foregroundMuted;
  }
}

export function Badge({
  label,
  tone,
  icon,
  theme,
  styles,
}: {
  label: string;
  tone: Tone;
  icon?: string;
  theme: PluginTheme;
  styles: Styles;
}) {
  const color = toneColor(theme, tone);
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      {icon ? <Icon name={icon} size={12} color={color} /> : null}
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

export function CollapsibleSection({
  title,
  count,
  collapsed,
  theme,
  styles,
  children,
}: {
  title: string;
  count: number;
  collapsed: boolean;
  theme: PluginTheme;
  styles: Styles;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(!collapsed);
  if (count === 0) return null;
  return (
    <View style={styles.section}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${title}, ${count}`}
        onPress={() => setOpen((value) => !value)}
        style={styles.sectionHeader}
      >
        <Icon name={open ? "ChevronDown" : "ChevronRight"} size={16} color={theme.colors.foregroundMuted} />
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionCount}>{count}</Text>
      </Pressable>
      {open ? children : null}
    </View>
  );
}
