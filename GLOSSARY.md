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
