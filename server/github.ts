export interface RawActor {
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
  commits: {
    nodes: Array<{
      commit: {
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
  reviews(last: 50) { nodes { state submittedAt body author { login } commit { oid } } }
  comments(last: 100) { nodes { body createdAt author { login } } }
  commits(last: 1) {
    nodes {
      commit {
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
  latestOpinionatedReviews: "Needs Pull requests: read.",
};

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

export class GitHubError extends Error {}

async function graphql<T>(
  token: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<{ data: T; warnings: string[] }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "paseo-github-prs",
    },
    body: JSON.stringify({ query, variables }),
    signal: controller.signal,
  }).finally(() => clearTimeout(timer));
  if (response.status === 401) {
    throw new GitHubError("GitHub rejected the token (401). Check that it is valid and not expired.");
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new GitHubError(`GitHub returned ${response.status}: ${detail.slice(0, 300)}`);
  }
  const payload = (await response.json()) as GraphQLResponse<T>;
  const warnings = describeErrors(payload.errors ?? [], payload.data);
  if (!payload.data) {
    throw new GitHubError(warnings.join("\n") || "GitHub returned no data.");
  }
  return { data: payload.data, warnings };
}

export async function fetchViewer(token: string): Promise<string> {
  const { data } = await graphql<{ viewer: { login: string } }>(token, "query { viewer { login } }");
  return data.viewer.login;
}

export async function searchPullRequests(
  token: string,
  queries: string[],
): Promise<{ login: string; results: RawPullRequest[][]; warnings: string[] }> {
  const params = queries.map((_, index) => `$q${index}: String!`).join(", ");
  const searches = queries
    .map(
      (_, index) =>
        `q${index}: search(query: $q${index}, type: ISSUE, first: 50) { nodes { ...PrFields } }`,
    )
    .join("\n");
  const query = `query(${params}) {\n viewer { login }\n${searches}\n}\n${PR_FIELDS}`;
  const variables = Object.fromEntries(queries.map((value, index) => [`q${index}`, value]));

  type Search = { nodes: Array<Partial<RawPullRequest> | null> } | null;
  const { data, warnings } = await graphql<{ viewer: { login: string } } & Record<string, Search>>(
    token,
    query,
    variables,
  );
  const results = queries.map((_, index) =>
    (data[`q${index}`]?.nodes ?? []).filter(
      (node): node is RawPullRequest => typeof node?.id === "string",
    ),
  );
  return { login: data.viewer.login, results, warnings };
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

const MENTION_QUERY = `
query($q: String!) {
  viewer { login }
  search(query: $q, type: ISSUE, first: 50) {
    nodes {
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
      }
    }
  }
}
fragment MentionComment on IssueComment {
  id url body createdAt
  author { __typename login }
  reactionGroups { viewerHasReacted }
}`;

export async function searchMentions(
  token: string,
  query: string,
): Promise<{ login: string; targets: RawMentionTarget[]; warnings: string[] }> {
  type Result = { viewer: { login: string }; search: { nodes: Array<Partial<RawMentionTarget> | null> } | null };
  const { data, warnings } = await graphql<Result>(token, MENTION_QUERY, { q: query });
  const targets = (data.search?.nodes ?? []).filter(
    (node): node is RawMentionTarget => typeof node?.id === "string",
  );
  return { login: data.viewer.login, targets, warnings };
}
