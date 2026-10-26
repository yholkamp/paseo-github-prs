import { type PluginSurfaceProps, useRpc, useSettings } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  type SettingsInputHandle,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
  useToast,
} from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Text } from "react-native";
import { type AuthStatus, clearToken, getAuthStatus, saveToken } from "../shared/rpc";
import { DEFAULT_READY_PATTERN, DEFAULT_REVIEW_QUERIES, isValidPattern, preferences } from "../shared/settings";
import { AUTH_KEY, MENTIONS_KEY, OVERVIEW_KEY } from "./data";

type Preferences = ReturnType<typeof preferences.schema.parse>;

const SOURCE_LABELS: Record<AuthStatus["source"], string> = {
  saved: "saved token",
  env: "GITHUB_TOKEN / GH_TOKEN on the daemon",
  gh: "GitHub CLI (gh auth token)",
  none: "none",
};

const REFRESH_OPTIONS = [
  { label: "Manual only", value: "0" },
  { label: "Every 2 minutes", value: "2" },
  { label: "Every 5 minutes", value: "5" },
  { label: "Every 10 minutes", value: "10" },
  { label: "Every 15 minutes", value: "15" },
  { label: "Every 30 minutes", value: "30" },
];

const MENTION_DAY_OPTIONS = [
  { label: "7 days", value: "7" },
  { label: "14 days", value: "14" },
  { label: "30 days", value: "30" },
  { label: "90 days", value: "90" },
];

function describeAuth(status: AuthStatus | undefined): { text: string; error: string | null } {
  if (!status) return { text: "Checking…", error: null };
  if (status.source === "none") return { text: "No token found", error: null };
  if (status.login) return { text: `Signed in as @${status.login} via ${SOURCE_LABELS[status.source]}`, error: null };
  return { text: `Token from ${SOURCE_LABELS[status.source]} failed`, error: status.error };
}

function TokenSettings() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const tokenInput = useRef<SettingsInputHandle>(null);
  const [token, setToken] = useState("");
  const fetchStatus = useRpc(getAuthStatus);
  const saveTokenRpc = useRpc(saveToken);
  const clearTokenRpc = useRpc(clearToken);
  const status = useQuery({ queryKey: AUTH_KEY, queryFn: () => fetchStatus({}) });

  const onChanged = (next: AuthStatus) => {
    queryClient.setQueryData(AUTH_KEY, next);
    void queryClient.invalidateQueries({ queryKey: OVERVIEW_KEY });
    void queryClient.invalidateQueries({ queryKey: MENTIONS_KEY });
  };
  const save = useMutation({
    mutationFn: saveTokenRpc,
    onSuccess(next) {
      onChanged(next);
      tokenInput.current?.replaceText("");
      setToken("");
      toast.show(next.login ? `Connected as @${next.login}` : "Token saved", { variant: "success" });
    },
    onError(error) {
      toast.error(error.message);
    },
  });
  const clear = useMutation({
    mutationFn: clearTokenRpc,
    onSuccess(next) {
      onChanged(next);
      toast.show("Saved token removed");
    },
    onError(error) {
      toast.error(error.message);
    },
  });

  const auth = describeAuth(status.data);
  return (
    <SettingsSection title="GitHub account">
      <SettingsCard>
        <SettingsRow label="Status" hint={auth.text} error={auth.error ?? status.error?.message ?? null} />
        <SettingsInput
          ref={tokenInput}
          label="Personal access token"
          hint="Stored on the daemon machine in ~/.config/paseo-github-prs/token and never sent to clients. Needs read access to pull requests, commit statuses and checks; authorize it for SSO if your organization requires it."
          placeholder="ghp_… or github_pat_…"
          secureTextEntry
          onChangeText={setToken}
        />
        <SettingsAction
          label="Save token"
          actionLabel={save.isPending ? "Checking…" : "Save"}
          disabled={!token.trim() || save.isPending}
          onPress={() => save.mutate({ token: token.trim() })}
        />
        {status.data?.source === "saved" ? (
          <SettingsAction
            label="Remove saved token"
            hint="Falls back to GITHUB_TOKEN, GH_TOKEN or the GitHub CLI login on the daemon."
            actionLabel="Remove"
            disabled={clear.isPending}
            onPress={() => clear.mutate({})}
          />
        ) : null}
      </SettingsCard>
    </SettingsSection>
  );
}

function PreferencesForm({
  values,
  saving,
  onSave,
  onReset,
}: {
  values: Preferences;
  saving: boolean;
  onSave(values: Preferences): void;
  onReset(): void;
}) {
  const [draft, setDraft] = useState(values);
  const queryInput = useRef<SettingsInputHandle>(null);
  const [newQuery, setNewQuery] = useState("");
  const patternValid = isValidPattern(draft.readyPattern);
  const dirty = JSON.stringify(draft) !== JSON.stringify(values);

  const addQuery = () => {
    const query = newQuery.trim();
    if (!query || draft.reviewQueries.includes(query)) return;
    setDraft({ ...draft, reviewQueries: [...draft.reviewQueries, query] });
    queryInput.current?.replaceText("");
    setNewQuery("");
  };

  return (
    <>
      <SettingsSection title="Review flow">
        <SettingsCard>
          <SettingsInput
            label="Ready for review marker"
            hint="Case-insensitive regular expression matched against PR comments and review bodies. A PR counts as ready once a matching comment exists."
            initialValue={values.readyPattern}
            placeholder={DEFAULT_READY_PATTERN}
            onChangeText={(readyPattern) => setDraft({ ...draft, readyPattern })}
          />
          {!patternValid ? <SettingsRow label="Marker" error="Not a valid regular expression." /> : null}
          <SettingsInput
            label="Review bot logins"
            hint="Comma-separated GitHub logins of the code review bot, for example coderabbitai. Used to detect new bot iterations."
            initialValue={values.reviewBotLogins.join(", ")}
            placeholder="coderabbitai, copilot-pull-request-reviewer"
            onChangeText={(text) =>
              setDraft({
                ...draft,
                reviewBotLogins: text
                  .split(",")
                  .map((login) => login.trim())
                  .filter(Boolean),
              })
            }
          />
          <SettingsSwitch
            label="New bot activity resets readiness"
            hint="When the bot comments or reviews after the latest ready marker, treat the PR as back with the bot until it is marked ready again."
            value={draft.botActivityResetsReady}
            onValueChange={(botActivityResetsReady) => setDraft({ ...draft, botActivityResetsReady })}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Review queue searches">
        <SettingsCard>
          {draft.reviewQueries.map((query) => (
            <SettingsAction
              key={query}
              label={query}
              actionLabel="Remove"
              onPress={() => setDraft({ ...draft, reviewQueries: draft.reviewQueries.filter((item) => item !== query) })}
            />
          ))}
          <SettingsInput
            ref={queryInput}
            label="Add search"
            hint="GitHub search qualifiers, run as “is:pr is:open archived:false <search>”. Your own PRs are excluded. Examples: team-review-requested:acme/backend, org:acme mentions:@me."
            placeholder="org:acme team-review-requested:acme/backend"
            onChangeText={setNewQuery}
          />
          <SettingsAction label="Add search" actionLabel="Add" disabled={!newQuery.trim()} onPress={addQuery} />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Mentions">
        <SettingsCard>
          <SettingsSelect
            label="Look back"
            hint="Comments older than this are not listed."
            value={String(draft.mentionDays)}
            options={MENTION_DAY_OPTIONS}
            onValueChange={(value) => setDraft({ ...draft, mentionDays: Number(value) })}
          />
          <SettingsSwitch
            label="Include closed issues and pull requests"
            value={draft.mentionsIncludeClosed}
            onValueChange={(mentionsIncludeClosed) => setDraft({ ...draft, mentionsIncludeClosed })}
          />
          <SettingsSwitch
            label="Hide mentions by bots"
            hint="Skips comments from bot accounts such as the review bot."
            value={draft.mentionsHideBots}
            onValueChange={(mentionsHideBots) => setDraft({ ...draft, mentionsHideBots })}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Refresh">
        <SettingsCard>
          <SettingsSelect
            label="Refresh automatically"
            value={String(draft.refreshMinutes)}
            options={REFRESH_OPTIONS}
            onValueChange={(value) => setDraft({ ...draft, refreshMinutes: Number(value) })}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsCard>
        <SettingsAction
          label="Save changes"
          actionLabel={saving ? "Saving…" : "Save"}
          disabled={!dirty || !patternValid || saving}
          onPress={() => onSave(draft)}
        />
        <SettingsAction
          label="Restore defaults"
          hint={`Searches: ${DEFAULT_REVIEW_QUERIES.join(", ")}`}
          actionLabel="Reset"
          disabled={saving}
          onPress={onReset}
        />
      </SettingsCard>
    </>
  );
}

export function SettingsScreen({ theme }: PluginSurfaceProps) {
  const settings = useSettings(preferences);
  const toast = useToast();

  return (
    <>
      <TokenSettings />
      {settings.status === "ready" ? (
        <PreferencesForm
          key={settings.revision}
          values={settings.values}
          saving={settings.saving}
          onSave={(values) =>
            void settings.save(values, settings.revision).then((ok) => {
              if (ok) toast.show("Settings saved", { variant: "success" });
              else toast.error("Could not save settings");
            })
          }
          onReset={() => void settings.reset()}
        />
      ) : settings.status === "loading" ? null : (
        <SettingsSection title="Preferences">
          <SettingsCard>
            <SettingsAction label="Settings could not be read" hint={settings.error} actionLabel="Reset" onPress={() => void settings.reset()} />
          </SettingsCard>
        </SettingsSection>
      )}
      {settings.saveError ? <Text style={{ color: theme.colors.statusDanger }}>{settings.saveError}</Text> : null}
    </>
  );
}
