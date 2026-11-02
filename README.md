# lemonpi

## What lemonpi does

lemonpi configures an existing Pi with Ivan's packages, settings, subagent definitions, extension configs, and private skills. It is configuration-only: it acts on an existing Pi rather than setting up Pi itself.

**Current scope — Areas 1–3:** Area 1 provides the CLI shell and prerequisite checks. Area 2 manages the eight packages in the catalog below through `install`, `update`, and `status`. Area 3 manages owned config through `install`, `update`, and `status`. Private skills and Readiness are not implemented yet; Areas 4–5 will add them. This README documents Managed packages, Unmanaged packages, Drift, Notice, and Skipped; Area 5 will document Readiness, including Unknown results.

## What lemonpi doesn't do

- Install or upgrade Pi or Claude Code.
- Store credentials.
- Prune Unmanaged packages.
- Run on Windows.
- Prompt for input.

## Requirements

- macOS or Debian/Linux.
- Node.js 22.19 or newer.
- An existing Pi CLI (`pi`) version 1.5.0 or newer on `PATH`.

## Quick start

```sh
npx github:iamivanhx/lemonpi
```

## Commands and flags

`install` is the default command when no command is specified.

| Command | Accepted command-specific flags |
| --- | --- |
| `install` | `--dry-run`, `--skip <id,…>`, `--skip-skills` |
| `update` | `--dry-run`, `--skip <id,…>`, `--skip-skills` |
| `status` | `--skip <id,…>` |
| `doctor` | `--skip <id,…>`, `--skip-skills` |
| `skills` | `--dry-run` |

`--help` or `-h` and `--version` are available with any command or without a command.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Ok. Warnings and Skipped parts are allowed. |
| 1 | Partial result: only optional packages failed; or Drift was found by `status` or `doctor`. |
| 2 | Failed: a required failure, a settings write failed, Pi is missing or older than 1.5.0, or usage is invalid. |

With `--dry-run`, the exit code is only 0 or 2.

Interrupted runs use 130 for Ctrl-C (SIGINT) and 143 for SIGTERM. These signal exit codes are outside the table above.

## Packages

### Catalog

A **Managed package** is listed in lemonpi's catalog. Managed packages track the latest release; lemonpi removes pins rather than holding a package to a version.

| ID | Source | Requiredness |
| --- | --- | --- |
| `subagents` | `npm:@tintinweb/pi-subagents` | Required |
| `review` | `git:github.com/earendil-works/pi-review` | Required |
| `tasks` | `npm:@tintinweb/pi-tasks` | Required |
| `claude-code` | `git:github.com/earendil-works/pi-claude-code` | Required |
| `ask-user` | `npm:@juicesharp/rpiv-ask-user-question` | Optional |
| `web-access` | `npm:pi-web-access` | Optional |
| `footer` | `npm:pi-footer` | Optional |
| `pretty` | `npm:@heyhuynhgiabuu/pi-pretty` | Optional |

### What package commands do

- `install` installs missing Managed packages, unpins pinned declarations, and migrates each **Replaced package** to its replacement: `npm:pi-subagents` to `npm:@tintinweb/pi-subagents`, and `npm:@juicesharp/rpiv-todo` to `npm:@tintinweb/pi-tasks`. Migration installs the replacement if needed, verifies its declaration, then removes the Replaced package. An already-declared replacement is kept, and other already-present unpinned Managed packages are left alone; lemonpi does not transfer fields from the different-identity Replaced package to its replacement.
- Object-form package filters and `autoload` are preserved when lemonpi unpins or updates a package. During migration, filters and `autoload` already on the replacement are preserved.
- `update` does the same reconciliation as `install`, then asks Pi to pull the latest for each eligible package, one package at a time in catalog order. A failed update is reported; lemonpi never tests package releases and never downgrades to an older release.
- `--skip <id,…>` leaves the named package completely alone for that run. Valid IDs are `subagents`, `review`, `tasks`, `claude-code`, `ask-user`, `web-access`, `footer`, and `pretty`. A **Skipped** package is never a failure. An unknown ID is a usage error and exits 2.
- `status` lists each Managed package once. **Drift** means a package is missing, pinned, duplicated, or has a pending migration; status exits 1 when it finds Drift. **Notices** are listed separately and do not change the exit code. A failed Required package fails the run (exit 2); a failed Optional package makes it partial (exit 1).

### Scope, notices, and removal

lemonpi manages global Pi settings only. A declaration in project settings is reported as a **Notice** and is never managed. An **Unmanaged package** is any other declared package: it is preserved, reported as a Notice, and never installed, updated, unpinned, or removed. A Managed package declared through a different source type is also reported as a Notice, not acted on.

The `claude-code` package is required, but the `claude` CLI and its login are Readiness concerns; lemonpi never installs the `claude` CLI or Claude Code. `web-access` is optional and comes with no provider configuration or credentials.

lemonpi has no package-removal command. To remove a Managed package, run `pi remove <source>` yourself. Migration cleanup of a Replaced package after its replacement is verified is the only automatic removal.

## Owned config

lemonpi owns these settings and files under your Pi agent directory:

- The default model `claude-code/claude-opus-5-5`: only `defaultProvider` and `defaultModel` in `settings.json`.
- The OpenAI model metadata declared in `src/owned-config/openai-models.js`, merged into `models.json` for both `openai` (API) and `openai-codex` (ChatGPT sign-in).
- The subagent definitions in `agents/`, listed in [Subagents](#subagents) below.
- The pi-subagents settings: `subagents.json`.
- The pi-tasks settings: `tasks-config.json`.
- The pi-footer config: `extensions/pi-footer.json`.

Every other setting and file is never touched or reported. Within `models.json`, unrelated providers, model IDs, credentials, provider endpoints, and undeclared fields are preserved. Model arrays merge by ID; the file is not replaced wholesale. Unreadable or structurally invalid managed sections are reported as failed and left unchanged. `install` and `update` restore owned items without asking; `status` reports them as **Drift** when missing or different from what lemonpi ships, without showing a diff.

Changes made through pi-footer's `/footer` UI, or by editing the agent files, are reverted by the next `install` or `update`. Make those changes in the lemonpi repo instead.

Before rewriting an existing file that differs, lemonpi backs it up under `<agentDir>/lemonpi-backups/<timestamp>/`, with one folder per run. For `settings.json`, lemonpi backs it up only if it existed when the command began; settings created by Pi earlier in the same run are not backed up. Backups are never pruned or printed. Symlinked files are written through and the link is kept. Files lemonpi stops shipping stay as your files.

`--skip footer` holds back only the package, not its config.

### Subagents

Each agent maps to a role in the workflow skills (`implement`, `implement-spec`, `two-axis-review`, `research`, `retro`, `idea`, `blast-radius`). Models are chosen so that writing, reviewing, and verifying each run on a different model.

| File | Role | Model / thinking |
| --- | --- | --- |
| `agents/implementer.md` | Builds one ticket test-first, with the `tdd` skill preloaded | `claude-code/claude-opus-5-5` / high |
| `agents/reviewer.md` | Read-only reviewer for `two-axis-review` | `openai-codex/gpt-6-astra` / high |
| `agents/verifier.md` | Drives criteria through the real interface; refuses a worktree, since it makes its own baseline | `openai-codex/gpt-6.1-sol` / high |
| `agents/researcher.md` | Background research with web tools and the `research` skill preloaded | `openai-codex/gpt-6.1-sol` / high |
| `agents/transcript-auditor.md` | Session evidence for `retro` | `claude-code/claude-opus-5-5` / medium |
| `agents/Explore.md` | Overrides the built-in `Explore` for read-only exploration | `openai-codex/gpt-6-luna` / low |
| `agents/skeptic.md` | Cold, read-only red-team or second independent read | caller's choice (inherits the session model when unset) |
| `agents/Plan.md` | Disables the built-in `Plan` agent | — |
| `agents/explorer.md`, `agents/merger.md` | Retired; shipped disabled so an earlier copy stops being advertised | — |

Agents that ship disabled stay in place, because removing a file lemonpi stops shipping would leave it as your file. A `tools` list narrows only built-in tools; extension tools (tasks, questions, web) still surface, and `ext:` selectors did not narrow them on Pi 1.4.0. So every agent except `researcher` sets `extensions: false`, and `researcher` excludes only the task and question extensions to keep its web tools.

`subagents.json` makes an unknown `subagent_type` fail instead of falling back to `general-purpose`; fails startup on a broken agent file; caps nesting at one level; shows each agent's model and cost; reports subagent spend to `/cost`; and gives agents 8 grace turns at their turn limit. `tasks-config.json` keeps task files under the agent directory instead of each repository, leaves auto-cascade off (`implement-spec` owns the ticket frontier), and collapses completed tasks.

### OpenAI models

lemonpi configures the current GPT-6 family from the [OpenAI model documentation](https://developers.openai.com/api/docs/models):

| Model | API context | Max output | Reasoning efforts |
| --- | ---: | ---: | --- |
| [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra) | 1,050,000 | 128,000 | low, medium, high, xhigh, max |
| [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol) | 1,050,000 | 128,000 | low, medium, high, xhigh, max |
| [GPT-6.1 Terra](https://developers.openai.com/api/docs/models/gpt-6.1-terra) | 1,050,000 | 128,000 | none, low, medium, high, xhigh, max |
| [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) | 1,050,000 | 128,000 | none, low, medium, high, xhigh, max |

All four accept text and images and produce text. Pi's `off` maps to `none` only where supported; `minimal` is disabled. Pi 1.5.0 bundles all four, so lemonpi only overrides their metadata; each model keeps Pi's built-in transport, compatibility flags, and image limits. lemonpi removes the Terra definition an earlier version added for Pi 1.4.0, because a full definition would replace Pi's built-in model; an entry carrying any field lemonpi did not write is left alone.

The API context budget comprises at most 922,000 input tokens plus 128,000 output tokens. Public API limits are **not** applied to ChatGPT subscriptions: Codex retains Pi's conservative 272,000 context for Astra and Luna, and uses 500,000 for Sol (documented by OpenAI) and Terra (Pi 1.5.0's catalog). Declaring a model does not establish that your subscription has access to it.

Cost estimates use Standard API pricing, including cached reads, 30-minute cache writes, and the request-wide price increase above 272,000 input tokens (2× input/cache and 1.5× output). Codex uses those rates only as estimates, not subscription billing. Fast, Ultrafast, Batch, Flex, regional processing, and longer cache-retention rates are not represented.

Existing subagent selections and the Claude Code default remain unchanged. lemonpi does not create credentials or log in. Authenticate the API provider using `OPENAI_API_KEY` or Pi's supported credential storage; sign in to the Codex provider using Pi's `/login`. Model access still depends on your account.

Apply or preview the configuration with:

```sh
node bin/lemonpi.js install --dry-run
node bin/lemonpi.js install
```

`status` and `doctor` inspect model configuration locally, without checking network access or authentication. Open `/model` in Pi to reload `models.json` after installing.

## Private skills

> **Placeholder — Area 4:** this section will be completed by the Private skills area.

## Troubleshooting

> **Placeholder — Area 5:** this section will be completed by the Readiness area.
