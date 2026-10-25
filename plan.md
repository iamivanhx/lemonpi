# My Pi Setup — Implementation Plan

## Goal

Turn this public repository into a configuration-only, one-command installer for Ivan's preferred [Pi](https://pi.dev) setup.

The installer must configure an existing Pi installation consistently across macOS and Debian/Linux without managing Pi itself. It should be inspired by LazyPi's declarative catalog, idempotent installation, status reporting, and health checks, while remaining specific to this setup.

Initial invocation should work directly from GitHub:

```bash
npx --yes github:iamivanhx/my-pi-setup
```

The default invocation should be equivalent to `install`.

## Agreed decisions

- This repository is public.
- Support macOS and Debian/Linux.
- Manage Pi configuration and packages only; do not install or upgrade Pi itself.
- Track unversioned package sources and update managed packages to the latest available release/ref.
- Preserve unknown packages and settings. Report drift; never prune unknown packages implicitly.
- Install Ivan's skills from the separate private repository by default.
- Allow `--skip-skills` for machines that should not install the private skills.
- Use `npm:@tintinweb/pi-subagents`, replacing `npm:pi-subagents`.
- Install the Earendil Claude Code provider so Pi can use an existing Claude Code subscription.
- Configure `openai/gpt-6` as the default Pi model.
- Add a permission system.
- Allow ordinary writes inside the current repository.
- Allow ordinary, non-destructive `git push` without prompting; destructive push variants remain ask/deny.
- Ask for destructive or external-directory operations.
- Run initially from GitHub rather than publishing an npm package.

## Operational contracts

Resolve implementation details against current upstream documentation without weakening these contracts:

### Scope and effective state

- Install, update, and migration manage only declarations in the resolved global agent directory. Project-only packages do not satisfy global requirements and must never be removed or updated as a substitute for global packages.
- Inspect global settings as the authoritative declaration source. Treat `pi list` as supplementary unless its scope and output format are verified for the installed version.
- Preserve object-form package declarations and their resource filters. Report globally configured, physically installed, and effectively enabled state separately where detectable.
- Run management and diagnostic subprocesses from a controlled working directory with project-local configuration disabled using documented options where supported. Do not trust the invoking checkout merely to inspect it.
- Report project overrides separately when inspected; do not silently rewrite them. A global installation is not proof that its extension is enabled in a particular project.

### Compatibility and latest tracking

- Latest tracking provides consistent desired configuration, not reproducible installed versions. Record resolved package versions or Git commits in the final summary where available.
- Before changing packages, check current package metadata for Pi/Node compatibility where available. A fixed Pi minimum is a baseline, not a promise that all future latest releases remain compatible.
- If a required latest release is incompatible, fail that operation with an actionable Pi upgrade requirement; do not upgrade Pi or remove the working legacy package. Never silently substitute an older release.

### Mutation and interaction

- `install` and `update` share the same reconciliation engine, including missing-package installation and safe legacy migration; neither prunes unmanaged resources.
- `--yes` suppresses only this installer's nonessential prompts. It never bypasses authentication, project trust, permission approvals, or a required confirmation to replace a divergent user policy.
- Without a TTY, operations requiring interaction must fail or be skipped with an actionable reason rather than hang. Apply documented noninteractive behavior and bounded timeouts; do not invent upstream flags.
- `--skip-skills` suppresses skills installation, updates, and private-repository network probes during install/update and their final doctor pass. Report skills as intentionally skipped, not failed. An explicit standalone `doctor` may inspect local state but must not require private access without an explicit network-check option.

### Read-only and dry-run behavior

- `status` and default `doctor` perform local inspection only: no package execution/install/update, credential refresh, configuration writes, backups, or network probes. Avoid invoking commands that load arbitrary extensions merely to inspect state.
- Add `doctor --network` for explicit bounded repository/authentication probes. Use non-refreshing status checks where supported; never print resolved credentials. Report unavailable safe checks as unknown rather than guessing.
- `--dry-run` is local-only and performs no managed-state changes, skills CLI execution, credential refresh, or backups. Show planned actions and prerequisites that cannot be verified locally. Initial `npx` bootstrapping may itself download/cache this installer; this is outside the managed-state guarantee.

### Exit codes

- `0`: requested operation succeeded; informational warnings or explicitly skipped optional components may remain.
- `1`: `status` or `doctor` found actionable drift/readiness problems, or an otherwise successful mutating command completed partially because an optional component failed.
- `2`: invalid invocation, unsupported host, unmet required prerequisite, or invalid input/configuration.
- `3`: required operation failed, including required package reconciliation, settings writes, or permission-policy installation.
- When multiple outcomes occur, use precedence `3`, then `2`, then `1`, then `0`. Document signal handling separately: forward termination to children, stop further mutations, and preserve conventional signal termination behavior rather than converting it to success.
- Unknown/unverifiable checks must be labeled distinctly from confirmed failures. They do not cause failure unless that check is a required prerequisite or required readiness condition.

## Current repository state

At planning time, the repository contains only:

```text
README.md
plan.md
```

The active machine's Pi setup currently includes:

- `npm:pi-subagents`
- `git:github.com/earendil-works/pi-review`
- `npm:@juicesharp/rpiv-todo`

The installer must migrate the old subagents package to `npm:@tintinweb/pi-subagents`.

## External repositories and packages

### Managed Pi packages

Use these unversioned sources so updates follow the latest available release/default branch:

1. `npm:@tintinweb/pi-subagents`
   - Claude Code-style subagents and workflows.
   - Replaces `npm:pi-subagents`.
   - Requires Pi 1.1.0 or newer.

2. `git:github.com/earendil-works/pi-review`
   - Primary code-review workflow.

3. `npm:@juicesharp/rpiv-todo`
   - Durable task tracking.

4. `npm:@juicesharp/rpiv-ask-user-question`
   - Structured clarification questions.

5. `git:github.com/earendil-works/pi-claude-code`
   - Experimental provider that routes Claude requests through the official Claude Code CLI and the user's Claude Pro/Max subscription.
   - The installer should configure the extension but must not install Claude Code.

6. `npm:pi-web-access`
   - Web search and fetching.
   - Keep default automatic provider routing.
   - Do not commit provider credentials.
   - Zero-config Exa MCP should work by default; compatible OpenAI/Codex authentication may also be reused automatically.

7. `npm:@gotgenes/pi-permission-system`
   - Host-level allow/ask/deny enforcement.

### Skills repository

Skills stay in the separate private repository:

```text
https://github.com/ivanhxlabs/skills
```

Install them for both Claude Code and Pi with:

```bash
npx skills@latest add ivanhxlabs/skills -g -a claude-code pi
```

The upstream global update command is:

```bash
npx skills@latest update -g
```

Do not invoke it automatically until its scope is verified: it may update unrelated globally installed skills. Prefer a documented repository-scoped update/reconciliation operation. If none exists, report that limitation and require an explicit `skills --update-all` opt-in for a broad global update.

The repository is private. The installer must not handle or persist GitHub credentials. It should use the machine's existing GitHub/SSH authentication.

## Proposed repository structure

```text
my-pi-setup/
├── README.md
├── LICENSE
├── plan.md
├── package.json
├── bin/
│   └── my-pi-setup.mjs
├── catalog/
│   └── packages.json
├── config/
│   ├── settings.json
│   └── permission-system.json
├── src/
│   ├── cli.mjs
│   ├── commands/
│   │   ├── install.mjs
│   │   ├── update.mjs
│   │   ├── status.mjs
│   │   ├── doctor.mjs
│   │   └── skills.mjs
│   └── lib/
│       ├── command.mjs
│       ├── platform.mjs
│       ├── pi.mjs
│       ├── settings.mjs
│       ├── packages.mjs
│       ├── skills.mjs
│       └── output.mjs
└── test/
    ├── fixtures/
    ├── cli.test.mjs
    ├── packages.test.mjs
    ├── settings.test.mjs
    └── doctor.test.mjs
```

Do not add local `skills/`, `extensions/`, `prompts/`, or `themes/` directories until this repository actually owns resources of those types.

## Package metadata and GitHub execution

Create a private package with a bin entry. It is not private in the GitHub visibility sense; `"private": true` only prevents accidental npm publication.

Suggested `package.json` shape:

```json
{
  "name": "my-pi-setup",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "my-pi-setup": "./bin/my-pi-setup.mjs"
  },
  "engines": {
    "node": ">=22.19.0"
  },
  "scripts": {
    "test": "node --test",
    "check": "node --check bin/my-pi-setup.mjs && node --test"
  }
}
```

Keep runtime dependencies at zero initially if practical. Use Node's built-in APIs for argument parsing, process execution, filesystem access, and JSON handling. Add a dependency only when it substantially improves correctness or portability.

Ensure `bin/my-pi-setup.mjs` is executable and starts with:

```js
#!/usr/bin/env node
```

Verify the direct GitHub invocation on a clean temporary npm cache:

```bash
npx --yes github:iamivanhx/my-pi-setup --help
```

## CLI design

### Default command

These should be equivalent:

```bash
npx --yes github:iamivanhx/my-pi-setup
npx --yes github:iamivanhx/my-pi-setup install
```

### Commands

#### `install`

Bring the current machine toward the declared configuration.

Options:

```text
--dry-run       Print intended changes without modifying anything
--skip-skills   Do not install/update ivanhxlabs/skills
--yes           Suppress nonessential confirmation prompts
--verbose       Print redacted subprocess commands and detailed diagnostics
--replace-policy  Explicitly authorize replacement of a divergent permission policy
```

Behavior:

1. Validate the host platform.
2. Validate Node version.
3. Validate that `pi` exists.
4. Validate Pi is at least 1.1.0 because the selected subagents package requires it.
5. Read the package catalog.
6. Read configured packages with `pi list` or, if necessary, carefully parse `~/.pi/agent/settings.json`.
7. Install missing managed packages.
8. Migrate explicitly declared legacy/replaced packages.
9. Update managed packages to latest after compatibility preflight, converting managed pinned declarations to the desired unversioned sources without losing resource filters.
10. Merge managed settings into Pi's settings file without replacing unrelated data.
11. Install the permission policy in the package's expected global configuration location.
12. Attempt private skills installation unless `--skip-skills` is set.
13. Check Claude Code availability and authentication; do not install it.
14. Run doctor checks and print a final summary.

#### `update`

Update the setup without pruning unmanaged packages.

Behavior:

1. Use the install reconciliation engine to install missing managed packages, safely migrate legacy packages, and update every compatible managed Pi package, preferably one source at a time so failures are attributable.
2. Reapply managed settings and permission policy.
3. Reconcile only skills from `ivanhxlabs/skills` unless `--skip-skills` is set. Never run a broad global skills update implicitly; use the scoped behavior described below.
4. Run doctor checks.

Do not run bare `pi update` because Pi itself is out of scope. Use package-specific updates or `pi update --extensions` only if it cannot unintentionally violate the managed/unmanaged distinction. Prefer package-specific updates from the catalog.

#### `status`

Report without modifying anything:

- Managed and installed
- Managed but missing
- Legacy/replaced
- Unmanaged
- Skills installed/accessible status
- Claude Code availability/authentication status
- Managed settings drift
- Permission policy drift

Use the exact exit codes in Operational contracts. Preserved unmanaged packages are informational, not actionable drift by themselves. Distinguish globally configured state from installed/enabled state and report project overrides separately.

#### `doctor`

Check:

- Supported OS
- Node version
- `pi` availability and version
- `git` availability
- Managed package state
- Legacy `npm:pi-subagents` presence
- Claude CLI availability
- Claude authentication status
- GitHub access to `ivanhxlabs/skills` only with explicit network checks enabled
- Skills installation state where detectable
- Permission policy presence and validity
- Pi settings validity
- Accidental credential filenames in an explicitly selected checkout
- Default model catalog availability and OpenAI authentication, independently from Claude readiness

Default doctor is local-only. `doctor --network` opts into bounded network/authentication probes. An install/update final doctor pass must retain the invocation's dry-run and skip-skills constraints. Unknown checks are not confirmed successes.

Doctor must never print tokens, API keys, auth files, private environment variable values, or complete credential-bearing command output.

#### `skills`

Explicitly install or update the separate skills repository:

```bash
my-pi-setup skills
```

This should install/reconcile only `ivanhxlabs/skills` using documented `skills@latest` behavior and provide actionable guidance if access fails. Verify whether repeating `add` updates the intended repository safely; do not assume it does. If repository-scoped updates are unavailable, explain the limitation. Reserve `skills --update-all` for an explicit, clearly described update of all global skills, with confirmation unless the user explicitly supplies `--yes`.

### Help and version

Support:

```bash
my-pi-setup --help
my-pi-setup --version
```

Unknown commands and options should fail with a concise usage message.

## Package catalog design

Create `catalog/packages.json` as the declarative source of truth.

Suggested initial shape:

```json
{
  "$schema": "./packages.schema.json",
  "packages": [
    {
      "id": "subagents",
      "source": "npm:@tintinweb/pi-subagents",
      "description": "Claude Code-style subagents and workflows",
      "required": true,
      "replaces": ["npm:pi-subagents"]
    },
    {
      "id": "review",
      "source": "git:github.com/earendil-works/pi-review",
      "description": "Code review workflow",
      "required": true
    },
    {
      "id": "todo",
      "source": "npm:@juicesharp/rpiv-todo",
      "description": "Durable task tracking",
      "required": true
    },
    {
      "id": "ask-user",
      "source": "npm:@juicesharp/rpiv-ask-user-question",
      "description": "Structured user questions",
      "required": true
    },
    {
      "id": "claude-code",
      "source": "git:github.com/earendil-works/pi-claude-code",
      "description": "Claude subscription provider through Claude Code",
      "required": true,
      "executables": ["claude"]
    },
    {
      "id": "web-access",
      "source": "npm:pi-web-access",
      "description": "Web search and content fetching",
      "required": true
    },
    {
      "id": "permissions",
      "source": "npm:@gotgenes/pi-permission-system",
      "description": "Deterministic tool and shell permission gates",
      "required": true
    }
  ]
}
```

Ship `catalog/packages.schema.json` alongside the catalog when using the suggested `$schema` reference. If deferring the schema, omit the reference until the file exists.

Package identity comparison must account for Pi's source forms. At minimum, normalize:

- `https://github.com/owner/repo`
- `git:github.com/owner/repo`
- Optional trailing `.git`
- npm specs with or without versions

Never treat similarly named npm packages as interchangeable unless declared under `replaces`.

Normalization establishes identity only; do not discard version/ref information when comparing desired declarations. Track package identity, configured source/version/ref, installed state, and resource filters separately. A pinned package is identity-matched but has declaration drift against an unversioned catalog entry. Pi updates preserve configured pins, so explicitly reconcile that declaration before claiming latest tracking.

Define and test safe handling for npm versions/ranges/tags, Git tags/commits/non-default branches, equivalent HTTPS/SSH Git URLs, duplicate declarations, and object-form entries. Preserve filters when changing a source. Reject ambiguous identities rather than guessing, and verify the resulting global declaration before removing any replacement source.

## Pi settings management

Track only intentionally managed keys in `config/settings.json`:

```json
{
  "$schema": "https://pi.dev/schemas/settings.schema.json",
  "defaultProvider": "openai",
  "defaultModel": "gpt-6",
  "defaultThinkingLevel": "medium",
  "theme": "dark",
  "defaultProjectTrust": "ask"
}
```

Confirm during implementation that `openai/gpt-6` appears in the installed Pi model catalog. If it does not, still preserve the agreed desired value but make doctor report that the configured model is currently unavailable rather than silently substituting another model.

Check default-model readiness separately from Claude readiness: catalog presence does not establish OpenAI authentication, and a Claude Code subscription does not provide OpenAI credentials. Report model catalog availability, safely detectable authentication, model exclusions, and project overrides as distinct states. Never make a paid inference request as a readiness probe or claim the default is ready solely because Claude is authenticated.

Do not track or overwrite:

- `deviceId`
- `lastChangelogVersion`
- `auth.json`
- Sessions
- Package installation directories
- Machine-specific provider credentials
- Unknown settings keys
- Unknown package declarations

### Merge algorithm

1. Locate the agent directory from `PI_CODING_AGENT_DIR`, defaulting to `~/.pi/agent`.
2. Read existing `settings.json`, or start from `{}` if absent.
3. Validate it is a JSON object.
4. Shallow-merge the explicitly managed top-level settings.
5. Do not directly replace the `packages` array; manage packages through Pi commands.
6. Before the first mutating operation in a run, including Pi package commands, back up existing settings and any permission policy that will be changed. Keep backups local with restrictive permissions; never print their contents.
7. Re-read settings after package commands. Before writing, detect changes since the latest read; retry a bounded merge or abort with a concurrent-modification error rather than overwrite another writer. Serialize this installer's own runs; atomic rename alone is not concurrency control.
8. Write atomically using a sibling temporary file followed by rename. Preserve existing file permissions, use restrictive permissions for new files/backups, clean temporary files on failure, and define/test symlink handling (refuse unexpected symlinks rather than silently replacing or following them).
9. Preserve readable indentation and a final newline. Skip the write and backup when no mutation is planned; repeated installation must not rewrite unchanged content.
10. In `--dry-run`, show keys that would change without exposing unrelated values; create no files or backups.

## Permission policy

The permission package expects its global configuration at:

```text
~/.pi/agent/extensions/pi-permission-system/config.json
```

Respect `PI_CODING_AGENT_DIR` when resolving this location.

Track the canonical policy in:

```text
config/permission-system.json
```

Install it atomically into the expected global location during install/update, using the same backup, permissions, concurrency, symlink, and no-op rules as settings writes.

If a divergent policy already exists, show a redacted semantic diff and require explicit confirmation before replacing it. `--yes` alone must not overwrite a divergent policy; add a documented explicit policy-replacement option for unattended use. If replacement is declined, preserve the existing policy and report required policy drift without claiming completion.

### Threat model and policy precedence

This is a permission decision layer, not a sandbox. It reduces accidental dangerous tool calls but cannot contain malicious repository scripts or installed extensions. Test/build execution trusts the code being executed; package managers and extensions may run arbitrary code with the user's privileges. Strong filesystem/network isolation requires a separate sandbox and is outside this installer's scope.

Do not claim that allowing arbitrary repository writes and test/build commands guarantees secret protection or external-path containment. Scripts, Git hooks, aliases, and subprocesses can have effects that command-pattern gates cannot fully prove.

Read the package's current precedence documentation and test effective policy. Currently documented project and agent overrides may change global policy; report this limitation and never describe global installation as an unoverrideable security boundary. Deny agent-tool writes to the global permission policy and relevant project/agent policy definitions where supported, and test self-modification attempts. If this cannot be enforced, document it prominently.

### Policy goals

Allow silently:

- Reads inside the current working tree
- Normal writes and edits inside the current working tree
- Search and inspection commands
- Test, lint, build, and typecheck commands
- Non-destructive Git operations
- Ordinary, non-destructive `git push`, subject to the Git rules below

Ask:

- Access outside the current working tree, except explicitly safe read-only caches added later
- Destructive Git operations
- Dependency installation
- Publishing packages
- Deployments and infrastructure mutation
- Database migrations
- Privileged commands
- Commands that cannot be parsed confidently

Deny:

- Reading secret material such as `.env`, `.env.*`, private keys, and credential stores
- Exceptions such as `.env.example` must be explicitly allowed
- Recursive deletion outside the working tree
- Destructive operations against `/`, `$HOME`, Pi credentials, Claude credentials, SSH keys, and GPG keys
- Force pushes unless later explicitly approved by policy

### Git rules

Allow ordinary inspection, staging, commits, and non-destructive pushes only when the parser can identify the operation confidently. Examples of intended operations are `git status`, ordinary `git diff/log/show`, branch listing, `git add`, `git commit`, and an ordinary `git push`.

Do not implement blanket `git branch *` or `git push *` grants without tested restrictive overrides: these include branch deletion, forced refspecs, and mirroring. Define ordinary push as excluding forced updates, remote deletion, mirroring, and unknown destructive options.

Ask or deny as appropriate for:

- `git reset`, `git clean`, `git checkout`, `git restore`, and `git rebase` variants.
- Branch deletion, including `git branch -D`.
- Push force variants, including `--force`, `-f`, `--force-with-lease`, equivalent option spellings, and `+`-prefixed refspecs.
- Remote deletion via `--delete`, `-d`, or empty-source refspecs, and `--mirror`.
- Global options such as `git -C`, `--git-dir`, `--work-tree`, and `-c`; aliases and option reordering must not evade gating.

Test bare commands, arguments, compound commands, redirections, wrappers, aliases, and parser failures. Git commits and pushes may execute hooks: allowing them trusts those hooks and is not a guarantee of read-only or repository-contained behavior. If supported patterns cannot reliably express the intended distinction, fail closed with an ask rather than silently allow destructive variants.

Before finalizing the policy, read the installed package's current configuration documentation and test patterns against real command parsing. Do not invent unsupported fields.

### Subagent compatibility caveat

`@gotgenes/pi-permission-system` documents native integration with a different subagent package. The chosen package is `@tintinweb/pi-subagents`.

Test at least:

1. Main-session tool gating.
2. Whether Tintinweb child agents load the permission extension.
3. Whether an `ask` decision from a foreground child can be answered safely.
4. Whether background children fail closed or hang while waiting for UI.
5. Whether custom agent definitions should disable risky tools instead of relying only on forwarded permission prompts.

Document any limitation prominently. Do not claim complete subagent permission forwarding without a passing integration test.

## Skills installation and private repository access

Default install behavior should attempt:

```bash
npx --yes skills@latest add ivanhxlabs/skills -g -a claude-code pi
```

Use `--yes` only for npm package execution; do not bypass authentication or trust prompts emitted by the skills installer unless its documented behavior is understood.

For explicit network diagnostics, prefer a bounded repository-access probe using the same transport/authentication mechanism the skills CLI actually uses. `gh auth status` establishes authentication, not authorization to this repository; an SSH `git ls-remote` does not prove that HTTPS/shorthand installation will work.

Treat the actual install result as authoritative. Distinguish missing authentication, authenticated-but-unauthorized access, network failure, missing tooling, and SSH host-key interaction. Do not require both GitHub CLI and SSH. Do not alter credential helpers, persist credentials, or accept host keys automatically. A bounded noninteractive diagnostic must report interaction-required or unknown rather than mislabel every timeout as an authentication failure.

Verify the skills CLI's actual global paths and agent discovery rules, including behavior with `PI_CODING_AGENT_DIR`. Do not assume that variable redirects Claude Code or skills CLI storage. Automated tests must use an isolated home and any documented tool-specific directory overrides, or a fake runner, so no real global skills or credentials are touched.

If skills installation fails because the repository is private:

- Do not roll back successfully installed Pi packages.
- Mark the overall run as partially successful.
- Print concise remediation steps.
- Suggest rerunning `my-pi-setup skills` after authentication.

Do not log SSH agent details, credential helpers, GitHub tokens, or full environment dumps.

## Claude Code provider checks

Install the Pi package regardless of whether `claude` is currently present, then report readiness.

Check:

```bash
command -v claude
claude auth status
```

If `claude auth status` is unsupported by the installed Claude Code version, fall back to a noninteractive, documented status check or report that authentication could not be verified.

Do not run `claude auth login` automatically. Authentication is interactive and remains the user's responsibility.

Doctor should explain:

- The provider is experimental.
- It uses Claude Code's existing authentication.
- Billing/subscription behavior may change if Anthropic changes noninteractive Claude Code usage policies.

## Web access configuration

Install `npm:pi-web-access` but do not create `web-search.json` initially.

Rationale:

- Default automatic routing works without selecting a provider.
- Zero-config Exa MCP is available.
- Provider choice affects privacy, cost, rate limits, and reliability.
- Public configuration must not contain API keys.

README should document that advanced users can create:

```text
~/.pi/agent/web-search.json
```

and should prefer environment-variable references or local secret resolvers over committed literal credentials.

## Cross-platform constraints

Support:

- macOS
- Linux, with Debian as the primary tested distribution

Implementation rules:

- Use Node APIs instead of shell-specific scripts wherever possible.
- Avoid GNU-only or BSD-only command flags.
- Do not assume Homebrew.
- Do not assume `sudo`.
- Do not assume `bash` is the user's login shell.
- Resolve home directories with `os.homedir()`.
- Use `path.join()` and `path.resolve()`.
- Spawn commands with argument arrays and `shell: false` by default.
- Preserve exit codes and signals.
- Add timeouts to network/authentication probes.
- Make colored output conditional on TTY support and `NO_COLOR`.

Windows support is out of scope for the first release, but errors should say that clearly.

## Safety and public-repository rules

Add `.gitignore` entries for at least:

```text
node_modules/
*.log
.DS_Store
.env
.env.*
!.env.example
coverage/
.tmp/
```

Never commit:

- `~/.pi/agent/auth.json`
- Claude Code auth files
- GitHub tokens
- SSH keys
- Provider API keys
- Session files
- Generated package checkouts
- Private skill contents copied from `ivanhxlabs/skills`

Doctor should scan for obvious forbidden filenames only in an explicitly selected public checkout, using a documented option such as `--repo <path>`. Do not automatically scan the caller's unrelated working directory or mistake the npm/GitHub package cache for the public checkout. Do not follow symlinks, bound traversal, and skip dependency/generated directories. Avoid reading or printing file contents. Explain that filename checks do not detect all secrets and are not a replacement for secret scanning.

## Output and error-handling conventions

Each operation should end in one of:

- `ok`
- `changed`
- `skipped`
- `warning`
- `failed`

Installation should continue past independent optional failures, especially private skills and Claude readiness, then print a summary.

Suggested final summary:

```text
Pi setup complete

Changed:
  ✓ migrated npm:pi-subagents → npm:@tintinweb/pi-subagents
  ✓ installed 4 packages
  ✓ updated managed settings
  ✓ installed permission policy

Ready:
  ✓ Pi 1.x
  ✓ Claude Code authenticated
  ✓ private skills installed

Warnings:
  ! 2 unmanaged Pi packages were preserved
```

Use the exit codes and precedence in Operational contracts. Required package, settings, or permission-policy failures return `3`. Optional component failures yield partial success (`1`) without undoing successful public setup. An intentionally skipped optional component does not fail the run. Report missing Claude authentication separately from default OpenAI model readiness, and label unknown checks rather than claiming success.

## Testing strategy

Use Node's built-in test runner.

### Unit tests

Test:

- Package source normalization
- Managed/missing/unmanaged/replaced classification
- Settings merge behavior
- Preservation of unknown settings
- Preservation of unknown packages
- Atomic-write backup behavior
- CLI argument parsing
- Platform detection
- Redaction of sensitive output
- Dry-run behavior

### Fixture-based tests

Use temporary agent directories through `PI_CODING_AGENT_DIR`.

Fixtures should include:

1. Empty settings.
2. Current real-world shape with `npm:pi-subagents`.
3. Already configured machine.
4. Unknown packages before, between, and after managed packages.
5. Malformed settings JSON.
6. Settings with machine-generated fields.
7. Missing permission directory.
8. Existing divergent permission policy.

Never use the developer's real `~/.pi/agent` in automated tests. A temporary `PI_CODING_AGENT_DIR` alone is insufficient for skills/Claude/GitHub tooling: use fake subprocesses by default and an isolated home plus documented tool-specific overrides for real integration tests. Never read or refresh real credentials.

Add fixtures/tests for pinned npm and Git declarations, object-form resource filters, duplicate declarations, project-only packages and overrides, unavailable/incompatible latest releases, concurrent writes, settings/policy symlinks and permissions, interrupted migration, divergent-policy confirmation, non-TTY prompts, exact exit codes, and explicit skip-skills behavior.

Permission integration tests must include destructive Git variants, hooks/aliases/wrappers, compound commands, external-path symlinks, policy self-modification, project/agent policy overrides, and background-agent timeout/fail-closed behavior. Document which safety properties are not enforceable without sandboxing.

### Command integration tests

Inject a fake command runner rather than invoking real Pi for most tests. Record expected calls such as:

```text
pi install npm:@tintinweb/pi-subagents
pi remove npm:pi-subagents
pi update npm:@tintinweb/pi-subagents
```

Test migration ordering safely:

1. Install replacement first.
2. Verify replacement appears configured.
3. Remove legacy source.

This avoids leaving the machine without subagent support if installation fails.

### Manual smoke tests

Before declaring the first release complete:

#### macOS

- Existing configured machine
- Temporary clean `PI_CODING_AGENT_DIR`
- Dry run
- Repeated install proving idempotency

#### Debian/Linux

- Clean user account or container/VM with Node and Pi preinstalled
- Temporary clean `PI_CODING_AGENT_DIR`
- Missing `claude`
- Missing GitHub authentication
- Repeated install proving idempotency

#### GitHub execution

Test:

```bash
npx --yes github:iamivanhx/my-pi-setup --help
npx --yes github:iamivanhx/my-pi-setup --dry-run
npx --yes github:iamivanhx/my-pi-setup status
```

## Documentation plan

Rewrite `README.md` around the user workflow.

Recommended sections:

1. What this repository configures
2. Requirements
   - Node 22.19+
   - Existing Pi installation
   - Git
   - Optional Claude Code
   - GitHub access for private skills
3. Quick start
4. Commands and options
5. Managed packages
6. Skills installation
7. Permission policy
8. Web access and credentials
9. Updating
10. Unmanaged packages
11. Troubleshooting
12. Security model
13. Development and tests

Clearly state that the installer:

- Does not install Pi
- Does not install Claude Code
- Does not store credentials
- Preserves unmanaged Pi packages
- Attempts to access a private skills repository by default

## Implementation phases

### Phase 1 — CLI skeleton and manifest

Deliver:

- `package.json`
- Executable `bin/my-pi-setup.mjs`
- CLI parser
- `--help` and `--version`
- Package catalog
- Basic tests

Acceptance criteria:

- Direct local execution works.
- Unknown commands/options fail clearly.
- GitHub package shape is valid.

### Phase 2 — Package reconciliation

Deliver:

- Package source normalization
- Status classification
- Idempotent install
- Safe subagents migration
- Package-specific updates
- Dry-run support

Acceptance criteria:

- Existing `npm:pi-subagents` is replaced only after successful installation of `npm:@tintinweb/pi-subagents`.
- Missing managed packages install.
- Existing managed packages are not duplicated.
- Unknown packages remain untouched.
- A second install has no configuration changes beyond update checks.

### Phase 3 — Settings and permission policy

Deliver:

- Managed settings merge
- Atomic writes and backup
- `openai/gpt-6` desired default
- Permission policy installation
- Policy tests

Acceptance criteria:

- Unknown settings survive unchanged.
- Machine-generated fields survive unchanged.
- Permission policy allows ordinary repository writes and non-destructive `git push`, tests policy self-protection and overrides, and clearly documents that it is not a sandbox.
- Sensitive paths are denied.
- Destructive/external actions ask or deny as intended.

### Phase 4 — Skills and Claude readiness

Deliver:

- Skills installer/update command
- `--skip-skills`
- Private repository access diagnostics
- Claude CLI/authentication diagnostics

Acceptance criteria:

- Authenticated machines install skills for Pi and Claude Code.
- Unauthenticated machines complete public setup and show remediation.
- Missing Claude Code does not prevent Pi package configuration.

### Phase 5 — Status, doctor, and documentation

Deliver:

- Local-only `status`
- Local-only `doctor` and explicit `doctor --network` / `--repo <path>` diagnostics
- Exact exit-code documentation
- Full README
- Sensitive-file checks

Acceptance criteria:

- A fresh user can understand every warning.
- No diagnostic leaks credentials.
- Drift is visible without automatic pruning.

### Phase 6 — Cross-platform verification

Deliver:

- macOS smoke-test record
- Debian/Linux smoke-test record
- GitHub `npx` smoke test
- Fixes for path, shell, and executable differences

Acceptance criteria:

- One GitHub command configures both supported platforms when prerequisites are present.
- Re-running is safe.
- Tests pass on both operating systems.

## Definition of done for the first usable release

The first usable release is complete when:

- `npx --yes github:iamivanhx/my-pi-setup` works.
- It refuses unsupported systems with a clear message.
- It requires an existing compatible Pi installation.
- It installs or updates all declared Pi packages.
- It safely replaces `npm:pi-subagents` with `npm:@tintinweb/pi-subagents`.
- It configures `openai/gpt-6` as the desired default.
- It installs a tested permission policy that allows normal repository work and non-destructive `git push`, with explicit limitations for script execution, hooks, policy overrides, and lack of sandbox isolation.
- It preserves all unmanaged packages and unknown settings.
- It attempts to install the private skills by default.
- It handles missing private-repository access without undoing public setup.
- It reports Claude Code readiness without managing Claude Code installation or login.
- `install`, `update`, `status`, `doctor`, and `skills` are documented and tested.
- Automated tests do not touch the real Pi agent directory.
- Manual smoke tests pass on macOS and Debian/Linux.

## Fresh-session starting instructions

In a new implementation session:

1. Read this file completely.
2. Read the current `README.md` and inspect the repository state.
3. Re-read Pi's package and settings documentation from the installed Pi version before coding:
   - `docs/packages.md`
   - `docs/settings.md`
   - `docs/configuration.md`
   - `docs/cli.md`, especially package commands
4. Inspect the latest upstream READMEs/configuration formats for:
   - `@tintinweb/pi-subagents`
   - `earendil-works/pi-review`
   - `@juicesharp/rpiv-todo`
   - `@juicesharp/rpiv-ask-user-question`
   - `earendil-works/pi-claude-code`
   - `pi-web-access`
   - `@gotgenes/pi-permission-system`
   - `ivanhxlabs/skills`
5. Create implementation tasks matching the phases above.
6. Implement Phase 1 first; do not begin by editing the real Pi configuration.
7. Use temporary `PI_CODING_AGENT_DIR` fixtures for all early tests.
8. Do not install or remove real user packages until dry-run output and reconciliation tests are correct.
