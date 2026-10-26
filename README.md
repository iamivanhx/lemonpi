# lemonpi

## What lemonpi does

lemonpi configures an existing Pi with Ivan's packages, settings, subagent definitions, extension configs, and private skills. It is configuration-only: it acts on an existing Pi rather than setting up Pi itself.

**Current scope — Area 1:** the CLI shell checks prerequisites, including that a supported Pi is already available, and reports the prerequisite result. The package, owned configuration, private skills, and readiness capabilities are not implemented yet; Areas 2–5 will add them. The later area sections will explain Managed packages, Unmanaged packages, and how Drift, Notice, and Skipped are reported. Area 5 will document Readiness, including Unknown results.

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

> **Placeholder — Area 2:** this section will be completed by the Managed packages area.

## Owned config

> **Placeholder — Area 3:** this section will be completed by the Owned config area.

## Private skills

> **Placeholder — Area 4:** this section will be completed by the Private skills area.

## Troubleshooting

> **Placeholder — Area 5:** this section will be completed by the Readiness area.
