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
- An existing Pi CLI (`pi`) version 1.4.0 or newer on `PATH`.

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
| 2 | Failed: a required failure, a settings write failed, Pi is missing or older than 1.4.0, or usage is invalid. |

With `--dry-run`, the exit code is only 0 or 2.

Interrupted runs use 130 for Ctrl-C (SIGINT) and 143 for SIGTERM. These signal exit codes are outside the table above.

## Packages

### Catalog

A **Managed package** is listed in lemonpi's catalog. Managed packages track the latest release; lemonpi removes pins rather than holding a package to a version.

| ID | Source | Requiredness |
| --- | --- | --- |
| `subagents` | `npm:@tintinweb/pi-subagents` | Required |
| `review` | `git:github.com/earendil-works/pi-review` | Required |
| `todo` | `npm:@juicesharp/rpiv-todo` | Required |
| `claude-code` | `git:github.com/earendil-works/pi-claude-code` | Required |
| `ask-user` | `npm:@juicesharp/rpiv-ask-user-question` | Optional |
| `web-access` | `npm:pi-web-access` | Optional |
| `footer` | `npm:pi-footer` | Optional |
| `pretty` | `npm:@heyhuynhgiabuu/pi-pretty` | Optional |

### What package commands do

- `install` installs missing Managed packages, unpins pinned declarations, and migrates the **Replaced package** `npm:pi-subagents` to `npm:@tintinweb/pi-subagents`. Migration installs the replacement if needed, verifies its declaration, then removes the Replaced package. An already-declared replacement is kept, and other already-present unpinned Managed packages are left alone; lemonpi does not transfer fields from the different-identity Replaced package to its replacement.
- Object-form package filters and `autoload` are preserved when lemonpi unpins or updates a package. During migration, filters and `autoload` already on the replacement are preserved.
- `update` does the same reconciliation as `install`, then asks Pi to pull the latest for each eligible package, one package at a time in catalog order. A failed update is reported; lemonpi never tests package releases and never downgrades to an older release.
- `--skip <id,…>` leaves the named package completely alone for that run. Valid IDs are `subagents`, `review`, `todo`, `claude-code`, `ask-user`, `web-access`, `footer`, and `pretty`. A **Skipped** package is never a failure. An unknown ID is a usage error and exits 2.
- `status` lists each Managed package once. **Drift** means a package is missing, pinned, duplicated, or has a pending migration; status exits 1 when it finds Drift. **Notices** are listed separately and do not change the exit code. A failed Required package fails the run (exit 2); a failed Optional package makes it partial (exit 1).

### Scope, notices, and removal

lemonpi manages global Pi settings only. A declaration in project settings is reported as a **Notice** and is never managed. An **Unmanaged package** is any other declared package: it is preserved, reported as a Notice, and never installed, updated, unpinned, or removed. A Managed package declared through a different source type is also reported as a Notice, not acted on.

The `claude-code` package is required, but the `claude` CLI and its login are Readiness concerns; lemonpi never installs the `claude` CLI or Claude Code. `web-access` is optional and comes with no provider configuration or credentials.

lemonpi has no package-removal command. To remove a Managed package, run `pi remove <source>` yourself. Migration cleanup of the Replaced package after its replacement is verified is the only automatic removal.

## Owned config

lemonpi owns these settings and files under your Pi agent directory:

- The default model `claude-code/claude-opus-5-5`: only `defaultProvider` and `defaultModel` in `settings.json`.
- The five subagent definitions: `agents/explorer.md`, `agents/implementer.md`, `agents/merger.md`, `agents/researcher.md`, and `agents/reviewer.md`.
- The pi-footer config: `extensions/pi-footer.json`.

Every other setting and file is never touched or reported. `install` and `update` restore owned items without asking; `status` reports them as **Drift** when missing or different from what lemonpi ships, without showing a diff.

Changes made through pi-footer's `/footer` UI, or by editing the agent files, are reverted by the next `install` or `update`. Make those changes in the lemonpi repo instead.

Before rewriting an existing file that differs, lemonpi backs it up under `<agentDir>/lemonpi-backups/<timestamp>/`, with one folder per run. For `settings.json`, lemonpi backs it up only if it existed when the command began; settings created by Pi earlier in the same run are not backed up. Backups are never pruned or printed. Symlinked files are written through and the link is kept. Files lemonpi stops shipping stay as your files.

`--skip footer` holds back only the package, not its config.

## Private skills

> **Placeholder — Area 4:** this section will be completed by the Private skills area.

## Troubleshooting

> **Placeholder — Area 5:** this section will be completed by the Readiness area.
