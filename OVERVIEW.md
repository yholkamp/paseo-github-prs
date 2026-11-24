GitHub PRs adds a Pull requests screen to the Paseo sidebar with four lists: your own open pull requests, the pull requests waiting for your review, the pull requests you merged recently with whether they reached staging and production, and recent comments that mention you. The sidebar row shows how many need you.

It is built for teams where a code review bot iterates on a pull request first, and the author then requests a review or comments that it is ready for review. Pull requests only count as ready once a review has been requested or that comment exists.

When your pull requests and mentions span more than one GitHub organization or user, a row of filters at the top of the screen limits all lists and the sidebar count to the owners you pick, so side projects stay out of your day-to-day view. Pick several to combine them, or All to see everything. The selection is kept on the daemon machine in `~/.config/paseo-github-prs/owner-filter.json` and shared between clients.

The search field above the tabs narrows every list to pull requests whose title or repository contains each word you type, in any order and ignoring case. The search is not saved and does not change the sidebar count.

## My PRs

Your open pull requests are grouped into needs your attention (failing checks, merge conflicts, changes requested), new comments, ready to merge, approved with checks running, awaiting review, and not marked ready yet. Draft pull requests are not shown. New comments holds pull requests where a reviewer or review bot left an unresolved review thread you have not replied to, or a comment or review after your latest commit or reply. Comments from other bots are ignored. Each row shows check status with the names of failing checks, the review decision, the number of new comments, and when it was marked ready.

## To review

Pull requests from your review searches are grouped into ready for your review, changed since your review (new commits or a new ready comment after your last review), waiting on author, others reviewing, approved by others, and still with the review bot. Draft pull requests are not shown. Pull requests you have not reviewed yet that already have the approvals they need go under approved by others. Pull requests you have not reviewed yet where another person (not the author or a bot) already left a review, or where a comment or review body from a person mentions someone else and nobody mentions you, go under others reviewing and are not counted, so you only hear about them when someone mentions you. Mentions of the author, of bots, of teams and in quoted text or code do not count, nor do your own comments. Turn off Skip pull requests others are reviewing to keep them in ready for your review.

Each pull request in the To review list has a Review button. It finds your local checkout of the repository by its GitHub remote, cloning it first if there is none, fetches the pull request branch, and starts a code review agent in a Paseo worktree for that branch. When a workspace for the branch already exists, it is fast-forwarded to the latest commit if it has no local changes, and a new review agent starts there. Review agents start in the provider's auto mode (Auto mode for Claude, Auto-review for Codex) so permission prompts are handled automatically. Paseo then opens the agent.

The plugin remembers which workspace, agent and commit each review used, in `~/.config/paseo-github-prs/reviews.json` on the daemon machine, for 90 days. A reviewed pull request shows Open review while its head commit is the one that was reviewed. Once new commits are pushed it shows Re-review, which fast-forwards the same workspace and asks the same agent to review the new commits, so it can check whether the issues it raised were addressed. When that workspace or agent was archived, a fresh review starts instead. Pull requests from forks are checked out as a local `pr-<number>` branch.

## Merged

Pull requests you authored and merged in the last 14 days (7 to 90 days in settings) are grouped into not on staging or production yet, on staging but not on production, on production, and repositories without a staging or production branch. For each repository the plugin looks for the first existing staging branch (default `stage`, then `staging`) and production branch (default `prod`, then `production`) and checks whether that branch contains the pull request's merge commit. This works when the environment branches are fast-forwarded or merged from the main branch; when promotions are squash merged, the original commits are never contained and pull requests stay in the earlier group. Pull requests whose head branch is one of the environment branches, such as promotion pull requests from stage to prod, are left out. The tab count is the number not yet on production. At most 50 merged pull requests are listed.

## Nightly reviews

A Paseo schedule can review the queue overnight so the findings are ready in the morning. Create a schedule whose prompt starts with the line `GitHub PRs nightly review`, for example `paseo schedule create $'GitHub PRs nightly review\nThe GitHub PRs plugin starts the reviews. Reply with OK and do nothing else.' --cron "0 3 * * *" --timezone Europe/Amsterdam --provider claude/claude-haiku-5-5`. When it fires, the plugin recognizes the scheduled agent by that title and starts a review for each pull request in ready for your review and changed since your review, one at a time, 10 minutes apart by default, respecting the owner filter. Pull requests whose latest commit was already reviewed by a review agent are skipped, and changed ones go to their previous review agent as a re-review. The scheduled agent itself only answers the prompt and its workspace is archived when it finishes, so a small model is enough. Pending reviews in a run are dropped if the plugin or daemon restarts before they start. Pause, resume or run the schedule once from Paseo's schedules.

## Mentions

Comments, reviews, inline review comments and descriptions on issues and pull requests that @-mention you are listed one by one, newest first, with an excerpt and a link to the comment. A mention counts as answered when you replied after it (in the same review thread for inline comments), reacted to it, or its review thread was resolved. You can mark any mention as done; done markers are kept on the daemon machine in `~/.config/paseo-github-prs/done-mentions.json`. Quoted text and team mentions are not counted.

## Setup

The plugin needs a GitHub token with read access to pull requests, commit statuses and checks. Paste one under Settings, Plugins, GitHub PRs. It is stored on the daemon machine in `~/.config/paseo-github-prs/token` with owner-only permissions and is never sent to Paseo clients. Without a saved token the plugin uses `GITHUB_TOKEN` or `GH_TOKEN` from the daemon environment, then `gh auth token`. Organizations with SAML SSO require the token to be authorized for them.

The daemon caches the last results in the same folder and shares them between all connected clients. A client opening the screen sees the cached lists right away while they refresh in the background, and clients refreshing within 30 seconds of each other share one GitHub request.

## Settings

- Ready for review marker: a case-insensitive regular expression matched against comments and review bodies. The default matches phrases such as "ready for review" and "ready for human review".
- Review bot logins: the bot accounts that review first. When new bot activity resets readiness is on, a bot comment or review after the latest marker moves the pull request back to the bot stage, unless a review has been requested.
- Review queue searches: GitHub search qualifiers for the To review list, each run as `is:pr is:open archived:false <search>`. The defaults are `review-requested:@me` and `reviewed-by:@me`. Add for example `team-review-requested:acme/backend` or `org:acme` when reviews are not requested directly. Only pull requests updated in the last 2 weeks are listed by default (Recent activity: 1, 2, 4 or 8 weeks, or any time), and Dependabot pull requests are left out unless you turn off Hide Dependabot pull requests.
- Mentions: how far back to look (7 to 90 days), whether to include closed issues and pull requests, and whether to hide mentions by bots.
- Merged pull requests: how far back to look, and the staging and production branch names to check, in order of preference.
- Code review: the agent model (default `claude/claude-opus-5-5`), the first message sent to it (default `/code-review high {branch}` followed by a request to end with the findings grouped as required before merging, not blocking, and minor nits, with placeholders for the number, branch, base branch, repository, URL and title), the message sent to the previous review agent on re-review (with `{previous}` and `{head}` for the reviewed and new commits as well, and the same grouping request), the folder for new clones, and the spacing between review agents in a nightly run. Without a clone folder, repositories are cloned next to another checkout from the same GitHub owner, over SSH unless that checkout uses HTTPS. Cloning and fetching use the daemon user's git credentials, not the plugin token.
- Refresh automatically: how often the lists refresh, or manual only.

The daemon calls the GitHub GraphQL API at api.github.com. Each search returns at most 50 issues or pull requests, and only the latest 100 comments, 50 reviews and 50 review threads per item are inspected.
