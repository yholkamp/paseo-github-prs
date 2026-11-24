import { useRpc } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getOwnerFilter, type Mentions, type Merged, type OwnerFilter, type Overview, repoOwner, setOwnerFilter } from "../shared/rpc";

const FILTER_KEY = ["github-prs", "owner-filter"] as const;

export interface Filter {
  owners: string[];
  active: boolean;
  includes(owner: string): boolean;
  matches(repo: string): boolean;
  toggle(owner: string): void;
  clear(): void;
}

export function useOwnerFilter(): Filter {
  const queryClient = useQueryClient();
  const toast = useToast();
  const fetchFilter = useRpc(getOwnerFilter);
  const saveFilter = useRpc(setOwnerFilter);
  const query = useQuery({ queryKey: FILTER_KEY, queryFn: () => fetchFilter({}) });
  const save = useMutation({
    mutationFn: saveFilter,
    onMutate(next) {
      queryClient.setQueryData<OwnerFilter>(FILTER_KEY, next);
    },
    onError(error) {
      toast.error(error.message);
      void queryClient.invalidateQueries({ queryKey: FILTER_KEY });
    },
  });

  const owners = query.data?.owners ?? [];
  const selected = new Set(owners.map((owner) => owner.toLowerCase()));
  const includes = (owner: string) => selected.has(owner.toLowerCase());
  return {
    owners,
    active: selected.size > 0,
    includes,
    matches: (repo) => selected.size === 0 || includes(repoOwner(repo)),
    toggle: (owner) =>
      save.mutate({
        owners: includes(owner) ? owners.filter((item) => item.toLowerCase() !== owner.toLowerCase()) : [...owners, owner],
      }),
    clear: () => save.mutate({ owners: [] }),
  };
}

export function searchWords(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

function matchesSearch(words: string[], title: string, repo: string): boolean {
  if (words.length === 0) return true;
  const haystack = `${repo}\n${title}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
}

export function filterOverview(data: Overview | undefined, filter: Filter, words: string[] = []): Overview | undefined {
  if (!data || (!filter.active && words.length === 0)) return data;
  const keep = (pr: Overview["mine"][number]) => filter.matches(pr.repo) && matchesSearch(words, pr.title, pr.repo);
  return { ...data, mine: data.mine.filter(keep), reviews: data.reviews.filter(keep) };
}

export function filterMentions(data: Mentions | undefined, filter: Filter, words: string[] = []): Mentions | undefined {
  if (!data || (!filter.active && words.length === 0)) return data;
  return {
    ...data,
    mentions: data.mentions.filter(
      ({ target }) => filter.matches(target.repo) && matchesSearch(words, target.title, target.repo),
    ),
  };
}

export function filterMerged(data: Merged | undefined, filter: Filter, words: string[] = []): Merged | undefined {
  if (!data || (!filter.active && words.length === 0)) return data;
  return { ...data, prs: data.prs.filter((pr) => filter.matches(pr.repo) && matchesSearch(words, pr.title, pr.repo)) };
}

export function ownersIn(
  overview: Overview | undefined,
  mentions: Mentions | undefined,
  merged: Merged | undefined,
  filter: Filter,
): string[] {
  const repos = [
    ...(overview?.mine ?? []).map((pr) => pr.repo),
    ...(overview?.reviews ?? []).map((pr) => pr.repo),
    ...(mentions?.mentions ?? []).map((mention) => mention.target.repo),
    ...(merged?.prs ?? []).map((pr) => pr.repo),
  ];
  const byKey = new Map<string, string>();
  for (const owner of [...filter.owners, ...repos.map(repoOwner)]) {
    if (!byKey.has(owner.toLowerCase())) byKey.set(owner.toLowerCase(), owner);
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}
