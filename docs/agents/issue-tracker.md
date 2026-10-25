# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --json number,title,body,labels,comments`.
- **List issues**: `gh issue list --state open --limit 1000 --json number,title,body,author,createdAt,labels,comments --jq '[.[] | {number, title, body, author: .author.login, createdAt, labels: [.labels[].name], comments: [.comments[] | {author: .author.login, createdAt, body}]}]'` with appropriate `--label` and `--state` filters. Without `--limit`, `gh` returns only the 30 newest issues, so counts and oldest-first ordering would be wrong; raise `--limit 1000` if a repo has more open issues than that. Comment authors and dates are what tell a reporter's reply apart from the triager's own notes.
- **Make an issue a sub-issue of a parent**: `gh issue create --parent <parent> ...`, or `gh issue edit <parent> --add-sub-issue <child>` afterwards (`gh` 2.94+). Older `gh`: `gh api --method POST repos/<owner>/<repo>/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>` (database id, as in **Mark an issue as blocked** below). Without sub-issues, put `Part of #<parent>` at the top of the child body.
- **Mark an issue as blocked**: GitHub's **native issue dependencies** are the canonical, UI-visible representation. `gh issue create --blocked-by <n>,<n> ...`, or `gh issue edit <child> --add-blocked-by <blocker>` afterwards (`gh` 2.94+; issue numbers or URLs). Older `gh`: `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body.
- **Check whether an issue is blocked**: `gh issue view <n> --json blockedBy --jq '[.blockedBy.nodes[] | select(.state == "OPEN")] | length'`; `0` means unblocked. Always filter on state: `blockedBy` and its `totalCount` include closed blockers. REST equivalent: `gh api repos/<owner>/<repo>/issues/<n> --jq .issue_dependencies_summary.blocked_by` (open blockers only); `issue_dependencies_summary` is not a `gh issue view --json` field. With the body-line fallback, an issue is unblocked when every issue in its `Blocked by` line is closed.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: post the explanation first with `gh issue comment <number> --body "..."`, then `gh issue close <number>`. Don't use `gh issue close --comment`: on an already-closed issue (the usual case once a `Closes #<number>` commit lands), `gh` exits 0 without posting the comment.

Infer the repo from `git remote -v`; `gh` does this automatically when run inside a clone.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh api --paginate 'repos/{owner}/{repo}/pulls?state=open' --jq '.[] | select(.author_association | IN("OWNER","MEMBER","COLLABORATOR") | not) | {number, title, author: .user.login, author_association, labels: [.labels[].name]}'`.
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either: resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Read it as in **Read an issue** above.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Labels**: `wayfinder:map`, `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, `wayfinder:task`. `gh issue create --label` fails on a label the repo doesn't have, so before creating a map or child ticket, list what exists (`gh label list --search wayfinder --json name --jq '.[].name'`) and `gh label create <label>` each missing one.
- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (see **Make an issue a sub-issue of a parent**). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: see **Mark an issue as blocked** above. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's children with `gh api --paginate repos/<owner>/<repo>/issues/<map>/sub_issues` (the endpoint returns 30 per page, so without `--paginate` later tickets vanish and the map can look complete), or from the map's task list where sub-issues aren't enabled. Keep the open ones, drop any with an open blocker (see **Check whether an issue is blocked**) or an assignee; first in map order wins.
- **Claim**: pick a token once per session (`openssl rand -hex 4`). The session's first writes are `gh issue edit <n> --add-assignee @me` and `gh issue comment <n> --body "wayfinder-claim <token>"`. Then check who won: `gh issue view <n> --json comments --jq '[.comments[].body | select(startswith("wayfinder-"))] | ((map(startswith("wayfinder-release")) | rindex(true)) // -1) as $r | .[$r+1:] | map(select(startswith("wayfinder-claim ")))[0]'` prints the earliest claim since the last release; if its token isn't yours, the ticket is another session's. To free the claim of a session that died, comment `wayfinder-release` and remove the assignee.
- **Map edit**: `gh issue view <map> --json body,updatedAt`, then check `updatedAt` again right before `gh issue edit <map> --body-file <file>`. GitHub has no conditional write, so this narrows the race rather than closing it. GitHub cuts an issue body at 65,536 characters without an error (`gh issue edit` still exits 0), and a parent holds at most 100 sub-issues. Check the new body's length (`wc -m < <file>`) before writing, and the map's sub-issue count before adding a child; when either nears its cap, stop and tell the human that the destination is too big for one map, rather than write it.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.