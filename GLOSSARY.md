# lemonpi

lemonpi is a configuration-only installer that customizes an existing Pi with Ivan's packages, settings, subagent definitions, extension configs, and private skills.

## Language

**Managed package**:
A Pi package listed in lemonpi's catalog, which lemonpi installs when missing and keeps on its latest release, never pinned.
_Avoid_: catalog package, owned package

**Unmanaged package**:
Any other package declared in Pi's settings, which lemonpi preserves and reports but never installs, updates, unpins, or removes.
_Avoid_: unknown package, foreign package

**Replaced package**:
A package that a managed package supersedes (today `npm:pi-subagents`, superseded by tintinweb subagents), which lemonpi removes only after the replacement is declared.
_Avoid_: legacy package, old package

**Drift**:
A difference between the machine and lemonpi's declared setup that running `install` would change or fail on (a managed package missing, pinned, duplicated, or stuck mid-migration; an owned setting or shipped file differing from what lemonpi ships).
_Avoid_: mismatch, divergence

**Notice**:
A reported condition lemonpi never acts on (an unmanaged package, a project-scope declaration of a managed package, a managed package declared from a different source type); it never changes the exit code.
_Avoid_: info, warning

**Readiness**:
Whether a component lemonpi configures can actually be used on this machine, judged from local facts only, without changing anything, refreshing credentials, or contacting the network.
_Avoid_: health, availability

**Unknown**:
An outcome meaning a readiness check could not be verified safely, or a settings-dependent inventory item cannot be determined because of unreadable Pi settings. An unknown readiness check is never counted as ready or as failed.
_Avoid_: skipped, indeterminate

**Skipped**:
The outcome of a part a run deliberately left alone (a managed package named in `--skip`, or private skills under `--skip-skills`); it is reported but never counted as a failure.
_Avoid_: ignored, excluded
