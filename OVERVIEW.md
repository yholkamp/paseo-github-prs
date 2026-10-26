GitHub PRs adds a Pull requests screen to the Paseo sidebar with three lists: your own open pull requests, the pull requests waiting for your review, and recent comments that mention you. The sidebar row shows how many need you.

It is built for teams where a code review bot iterates on a pull request first, and someone then comments that it is ready for review. Pull requests only count as ready for you once that comment exists.

## My PRs

Your open pull requests are grouped into needs your attention (failing checks, merge conflicts, changes requested), ready to merge, approved with checks running, awaiting review, not marked ready yet, and drafts. Each row shows check status with the names of failing checks, the review decision, and when it was marked ready.

## To review

Pull requests from your review searches are grouped into ready for your review, changed since your review (new commits or a new ready comment after your last review), waiting on author, and still with the review bot.

Each pull request in the To review list has a Review button. It finds your local checkout of the repository by its GitHub remote, cloning it first if there is none, fetches the pull request branch, and starts a code review agent in a Paseo worktree for that branch. When a workspace for the branch already exists, it is fast-forwarded to the latest commit if it has no local changes, and a new review agent starts there. Paseo then opens the agent. Pull requests from forks are checked out as a local `pr-<number>` branch.

## Mentions

Comments, reviews, inline review comments and descriptions on issues and pull requests that @-mention you are listed one by one, newest first, with an excerpt and a link to the comment. A mention counts as answered when you replied after it (in the same review thread for inline comments), reacted to it, or its review thread was resolved. You can mark any mention as done; done markers are kept on the daemon machine in `~/.config/paseo-github-prs/done-mentions.json`. Quoted text and team mentions are not counted.

## Setup

The plugin needs a GitHub token with read access to pull requests, commit statuses and checks. Paste one under Settings, Plugins, GitHub PRs. It is stored on the daemon machine in `~/.config/paseo-github-prs/token` with owner-only permissions and is never sent to Paseo clients. Without a saved token the plugin uses `GITHUB_TOKEN` or `GH_TOKEN` from the daemon environment, then `gh auth token`. Organizations with SAML SSO require the token to be authorized for them.

## Settings

- Ready for review marker: a case-insensitive regular expression matched against comments and review bodies. The default matches phrases such as "ready for review" and "ready for human review".
- Review bot logins: the bot accounts that review first. When new bot activity resets readiness is on, a bot comment or review after the latest marker moves the pull request back to the bot stage.
- Review queue searches: GitHub search qualifiers for the To review list, each run as `is:pr is:open archived:false <search>`. The defaults are `review-requested:@me` and `reviewed-by:@me`. Add for example `team-review-requested:acme/backend` or `org:acme` when reviews are not requested directly.
- Mentions: how far back to look (7 to 90 days), whether to include closed issues and pull requests, and whether to hide mentions by bots.
- Code review: the agent model (default `claude/claude-opus-5-5`), the first message sent to it (default `/code-review high {branch}`, with placeholders for the number, branch, base branch, repository, URL and title), and the folder for new clones. Without a clone folder, repositories are cloned next to another checkout from the same GitHub owner, over SSH unless that checkout uses HTTPS. Cloning and fetching use the daemon user's git credentials, not the plugin token.
- Refresh automatically: how often the lists refresh, or manual only.

The daemon calls the GitHub GraphQL API at api.github.com. Each search returns at most 50 issues or pull requests, and only the latest 100 comments, 50 reviews and 50 review threads per item are inspected.
