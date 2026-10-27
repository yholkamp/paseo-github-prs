export interface RawActor {
  __typename?: string;
  login: string;
}

export interface RawReview {
  state: "PENDING" | "COMMENTED" | "APPROVED" | "CHANGES_REQUESTED" | "DISMISSED";
  submittedAt: string | null;
  body: string;
  author: RawActor | null;
  commit: { oid: string } | null;
}

export interface RawComment {
  body: string;
  createdAt: string;
  author: RawActor | null;
}

export type RawCheck =
  | { __typename: "CheckRun"; name: string; status: string; conclusion: string | null }
  | { __typename: "StatusContext"; context: string; state: string };

export interface RawPullRequest {
  id: string;
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  updatedAt: string;
  headRefOid: string;
  headRefName: string;
  baseRefName: string;
  isCrossRepository: boolean;
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  repository: { nameWithOwner: string };
  author: RawActor | null;
  latestOpinionatedReviews: { nodes: Array<{ state: RawReview["state"] } | null> };
  reviews: { nodes: Array<RawReview | null> };
  comments: { nodes: Array<RawComment | null> };
  reviewRequests: { nodes: Array<{ createdAt?: string } | null> };
  reviewThreads: {
    nodes: Array<{ isResolved: boolean; comments: { nodes: Array<{ createdAt: string; author: RawActor | null } | null> } } | null>;
  };
  commits: {
    nodes: Array<{
      commit: {
        committedDate: string;
        statusCheckRollup: {
          state: "SUCCESS" | "FAILURE" | "ERROR" | "PENDING" | "EXPECTED";
          contexts: { nodes: Array<RawCheck | null> };
        } | null;
      };
    } | null>;
  };
}

const PR_FIELDS = `
fragment PrFields on PullRequest {
  id number title url isDraft updatedAt headRefOid headRefName baseRefName isCrossRepository mergeable reviewDecision
  repository { nameWithOwner }
  author { login }
  latestOpinionatedReviews(first: 30) { nodes { state } }
  reviews(last: 50) { nodes { state submittedAt body author { __typename login } commit { oid } } }
  comments(last: 100) { nodes { body createdAt author { __typename login } } }
  reviewRequests: timelineItems(last: 1, itemTypes: [REVIEW_REQUESTED_EVENT]) {
    nodes { ... on ReviewRequestedEvent { createdAt } }
  }
  reviewThreads(last: 50) {
    nodes { isResolved comments(last: 1) { nodes { createdAt author { __typename login } } } }
  }
  commits(last: 1) {
    nodes {
      commit {
        committedDate
        statusCheckRollup {
          state
          contexts(first: 100) {
            nodes {
              __typename
              ... on CheckRun { name status conclusion }
              ... on StatusContext { context state }
            }
          }
        }
      }
    }
  }
}`;

interface GraphQLError {
  message: string;
  path?: Array<string | number>;
}

interface GraphQLResponse<T> {
  data?: T | null;
  errors?: GraphQLError[];
}

const CHECKS_HINT =
  "Needs Commit statuses: read. Fine-grained tokens have no Checks permission, so check runs may need a classic token with the repo scope.";

const PERMISSION_HINTS: Record<string, string> = {
  statusCheckRollup: CHECKS_HINT,
  contexts: CHECKS_HINT,
  commits: "Needs Contents: read.",
  mergeable: "Needs Contents: read.",
  reviews: "Needs Pull requests: read.",
  reviewThreads: "Needs Pull requests: read.",
  reviewRequests: "Needs Pull requests: read.",
  latestOpinionatedReviews: "Needs Pull requests: read.",
};

function accessWarnings(headers: Headers): string[] {
  const warnings: string[] = [];
  const scopes = headers.get("x-oauth-scopes");
  if (scopes !== null && !scopes.split(",").some((scope) => scope.trim() === "repo")) {
    warnings.push(
      "The token does not have the repo scope, so pull requests in private repositories are not shown. Enable the top-level repo scope on the token.",
    );
  }
  const sso = headers.get("x-github-sso");
  if (sso?.includes("partial-results")) {
    const orgs = /organizations=([^;]+)/.exec(sso)?.[1];
    warnings.push(
      `Results from ${orgs ? `organizations ${orgs}` : "some organizations"} are hidden because the token is not authorized for their single sign-on. Use Configure SSO on the token's GitHub page.`,
    );
  }
  return warnings;
}

export function describeErrors(errors: GraphQLError[], data: unknown): string[] {
  const groups = new Map<string, { message: string; field: string | null; item: boolean; repos: Set<string> }>();
  for (const error of errors) {
    const path = error.path ?? [];
    let node: unknown = data;
    let repo: string | null = null;
    for (const segment of path) {
      node = node && typeof node === "object" ? (node as Record<string | number, unknown>)[segment] : undefined;
      const name = (node as { repository?: { nameWithOwner?: string } } | undefined)?.repository?.nameWithOwner;
      if (name) repo = name;
    }
    const names = path.filter((segment): segment is string => typeof segment === "string" && segment !== "nodes");
    const last = names[names.length - 1];
    const field = last && !/^(q\d+|search|viewer)$/.test(last) ? last : null;
    const key = `${error.message}|${field}`;
    const group = groups.get(key) ?? { message: error.message, field, item: !field && path.length > 0, repos: new Set<string>() };
    if (repo) group.repos.add(repo);
    groups.set(key, group);
  }
  return [...groups.values()].map(({ message, field, item, repos }) => {
    const list = [...repos];
    const where = list.length
      ? ` in ${list.slice(0, 3).join(", ")}${list.length > 3 ? ` and ${list.length - 3} more` : ""}`
      : "";
    const hint = field
      ? PERMISSION_HINTS[field]
      : item
        ? "Some results are in repositories the token does not cover, such as another organization's."
        : undefined;
    return `${message}${field ? ` (field ${field}${where})` : where ? ` (${where.trim()})` : ""}${hint ? ` ${hint}` : ""}`;
  });
}

export class GitHubError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.status = status;
  }

  get retryable(): boolean {
    return this.status === 502 || this.status === 503 || this.status === 504;
  }
}

const DETAIL_CONCURRENCY = 8;

async function graphql<T>(
  token: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<{ data: T; warnings: string[] }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  let response: Response;
  try {
    response = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "user-agent": "paseo-github-prs",
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) throw new GitHubError("GitHub did not respond within 30 seconds.", 504);
    throw error;
  } finally {
    clearTimeout(timer);
  }
  if (response.status === 401) {
    throw new GitHubError("GitHub rejected the token (401). Check that it is valid and not expired.", 401);
  }
  if (!response.ok) {
    const detail = response.status >= 500 ? "" : await response.text().catch(() => "");
    const reason = response.status >= 502 && response.status <= 504 ? "GitHub timed out" : "GitHub returned an error";
    throw new GitHubError(`${reason} (${response.status})${detail ? `: ${detail.slice(0, 300)}` : "."}`, response.status);
  }
  const payload = (await response.json()) as GraphQLResponse<T>;
  const warnings = [...accessWarnings(response.headers), ...describeErrors(payload.errors ?? [], payload.data)];
  if (!payload.data) {
    throw new GitHubError(warnings.join("\n") || "GitHub returned no data.");
  }
  return { data: payload.data, warnings };
}

export async function fetchViewer(token: string): Promise<{ login: string; warnings: string[] }> {
  const { data, warnings } = await graphql<{ viewer: { login: string } }>(token, "query { viewer { login } }");
  return { login: data.viewer.login, warnings };
}

async function searchIds(
  token: string,
  queries: string[],
): Promise<{ login: string; ids: string[][]; warnings: string[] }> {
  const params = queries.map((_, index) => `$q${index}: String!`).join(", ");
  const searches = queries
    .map(
      (_, index) =>
        `q${index}: search(query: $q${index}, type: ISSUE, first: 50) { nodes { ... on PullRequest { id } ... on Issue { id } } }`,
    )
    .join("\n");
  const variables = Object.fromEntries(queries.map((value, index) => [`q${index}`, value]));
  type Search = { nodes: Array<{ id?: string } | null> } | null;
  const { data, warnings } = await graphql<{ viewer: { login: string } } & Record<string, Search>>(
    token,
    `query(${params}) {\n viewer { login }\n${searches}\n}`,
    variables,
  );
  const ids = queries.map((_, index) => (data[`q${index}`]?.nodes ?? []).flatMap((node) => (node?.id ? [node.id] : [])));
  return { login: data.viewer.login, ids, warnings };
}

async function fetchNodes<T extends { id: string }>(
  token: string,
  ids: string[],
  selection: string,
  fragments: string,
  batchSize: number,
): Promise<{ nodes: Map<string, T>; warnings: string[] }> {
  const query = `query($ids: [ID!]!) { nodes(ids: $ids) { ${selection} } }\n${fragments}`;
  const nodes = new Map<string, T>();
  const warnings: string[] = [];
  let skipped = 0;

  const load = async (batch: string[]): Promise<void> => {
    try {
      const result = await graphql<{ nodes: Array<Partial<T> | null> }>(token, query, { ids: batch });
      warnings.push(...result.warnings);
      for (const node of result.data.nodes) {
        if (typeof node?.id === "string") nodes.set(node.id, node as T);
      }
    } catch (error) {
      if (!(error instanceof GitHubError && error.retryable)) throw error;
      if (batch.length === 1) {
        skipped += 1;
        return;
      }
      const half = Math.ceil(batch.length / 2);
      await load(batch.slice(0, half));
      await load(batch.slice(half));
    }
  };

  const batches: string[][] = [];
  for (let index = 0; index < ids.length; index += batchSize) batches.push(ids.slice(index, index + batchSize));
  for (let index = 0; index < batches.length; index += DETAIL_CONCURRENCY) {
    await Promise.all(batches.slice(index, index + DETAIL_CONCURRENCY).map(load));
  }
  if (skipped > 0) warnings.push(`${skipped} item${skipped > 1 ? "s" : ""} could not be loaded because GitHub timed out.`);
  return { nodes, warnings };
}

export async function searchPullRequests(
  token: string,
  queries: string[],
): Promise<{ login: string; results: RawPullRequest[][]; warnings: string[] }> {
  const search = await searchIds(token, queries);
  const details = await fetchNodes<RawPullRequest>(token, [...new Set(search.ids.flat())], "...PrFields", PR_FIELDS, 5);
  const results = search.ids.map((ids) =>
    ids.flatMap((id) => {
      const pr = details.nodes.get(id);
      return pr ? [pr] : [];
    }),
  );
  return { login: search.login, results, warnings: [...new Set([...search.warnings, ...details.warnings])] };
}

export interface RawAuthor {
  __typename: string;
  login: string;
}

export interface RawMentionComment {
  id: string;
  url: string;
  body: string;
  createdAt: string;
  author: RawAuthor | null;
  reactionGroups: Array<{ viewerHasReacted: boolean }> | null;
}

export interface RawMentionReview {
  id: string;
  url: string;
  body: string;
  submittedAt: string | null;
  author: RawAuthor | null;
  reactionGroups: Array<{ viewerHasReacted: boolean }> | null;
}

export interface RawMentionThread {
  isResolved: boolean;
  path: string;
  comments: { nodes: Array<RawMentionComment | null> };
}

export interface RawMentionTarget {
  __typename: "Issue" | "PullRequest";
  id: string;
  number: number;
  title: string;
  url: string;
  issueState?: "OPEN" | "CLOSED";
  prState?: "OPEN" | "CLOSED" | "MERGED";
  body: string;
  createdAt: string;
  author: RawAuthor | null;
  reactionGroups: Array<{ viewerHasReacted: boolean }> | null;
  repository: { nameWithOwner: string };
  comments: { nodes: Array<RawMentionComment | null> };
  reviews?: { nodes: Array<RawMentionReview | null> };
  reviewThreads?: { nodes: Array<RawMentionThread | null> };
}

const MENTION_SELECTION = `
  __typename
  ... on Issue {
    id number title url issueState: state body createdAt
    author { __typename login }
    reactionGroups { viewerHasReacted }
    repository { nameWithOwner }
    comments(last: 100) { nodes { ...MentionComment } }
  }
  ... on PullRequest {
    id number title url prState: state body createdAt
    author { __typename login }
    reactionGroups { viewerHasReacted }
    repository { nameWithOwner }
    comments(last: 100) { nodes { ...MentionComment } }
    reviews(last: 50) {
      nodes { id url body submittedAt author { __typename login } reactionGroups { viewerHasReacted } }
    }
    reviewThreads(last: 50) {
      nodes {
        isResolved path
        comments(last: 30) {
          nodes { id url body createdAt author { __typename login } reactionGroups { viewerHasReacted } }
        }
      }
    }
  }`;

const MENTION_FRAGMENTS = `
fragment MentionComment on IssueComment {
  id url body createdAt
  author { __typename login }
  reactionGroups { viewerHasReacted }
}`;

export async function searchMentions(
  token: string,
  query: string,
): Promise<{ login: string; targets: RawMentionTarget[]; warnings: string[] }> {
  const search = await searchIds(token, [query]);
  const ids = search.ids[0] ?? [];
  const details = await fetchNodes<RawMentionTarget>(token, ids, MENTION_SELECTION, MENTION_FRAGMENTS, 5);
  const targets = ids.flatMap((id) => {
    const target = details.nodes.get(id);
    return target ? [target] : [];
  });
  return { login: search.login, targets, warnings: [...new Set([...search.warnings, ...details.warnings])] };
}
