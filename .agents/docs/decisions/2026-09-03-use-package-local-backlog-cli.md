---
status: accepted
date: 2026-09-03
decision-makers: Bruschkov
---

# Use a package-local Backlog.md CLI

## Context and Problem Statement

Devflow is distributed as a Pi package. A system-wide Backlog.md install (for example, through Homebrew) can differ from the version the extension was developed and tested against. The workflow needs a stable JSON command boundary without coupling to Backlog.md's internal TypeScript API.

## Decision

`pi-extensions/devflow/package.json` declares `backlog.md` as a runtime dependency at `^1.4.0`. The extension must invoke the package-local `backlog` CLI and consume its JSON output. It must not use a global Backlog.md executable or import Backlog.md internals.

The `^1.4.0` range accepts compatible 1.x releases and excludes 2.x. `package-lock.json` records the resolved release used for the package. Pi installs runtime dependencies for npm and git packages; source-local development runs `npm install` in the package directory.

Non-goals: supporting Backlog.md 2.x, managing a system-wide Backlog.md installation, or wrapping an internal Backlog.md TypeScript API.

## Consequences

- The extension has a reproducible package-local CLI dependency and is unaffected by a user's global Backlog.md version.
- New Backlog.md 1.x releases remain eligible; CLI JSON behavior must be verified before changing the compatibility range or lockfile.
- The workflow wrapper must resolve and execute the package-local binary rather than relying on `PATH`.

## Implementation Plan

- **Affected paths**: `pi-extensions/devflow/package.json`, `pi-extensions/devflow/package-lock.json`, `pi-extensions/devflow/index.ts`, and `tests/pi-extensions/devflow/contract.test.mjs`.
- **Dependencies**: `backlog.md` `^1.4.0`; `@earendil-works/pi-coding-agent` and `typebox` are `*` peer dependencies.
- **Patterns to follow**: Pi package manifest declares `index.ts`; future wrapper code calls the CLI with `--json` and parses the command result.
- **Patterns to avoid**: global executable lookup, direct Backlog.md API imports, and a strict exact dependency range.

### Verification

- [x] Package manifest declares `backlog.md` `^1.4.0` and `index.ts` as its Pi extension.
- [x] `node --test tests/pi-extensions/devflow/contract.test.mjs` passes.
- [x] The contract test invokes the package-local CLI in a temporary Git repository and verifies config lookup, task/draft CRUD, parent/dependency data, comments, assignments, and repeatable task JSON.
- [x] One structured `backlog` Pi tool invokes the package-local binary, limits output, and serializes writes; its contract test passes.

## Alternatives Considered

- System-wide/Homebrew Backlog.md: rejected because its version is outside the extension's control.
- Direct TypeScript API import: rejected because the CLI JSON contract is a narrower, more stable boundary.
- Exact dependency version: rejected because compatible Backlog.md 1.x releases are acceptable.

## More Information

2026-09-03: Backlog.md exposes versioned JSON for `task list` and `task view`; draft reads use plain text. The contract covers the supported JSON boundary rather than parsing human-readable output.

2026-09-04: The package exposes one structured `backlog` Pi tool rather than arbitrary CLI arguments. It uses the package-local binary, caps tool output at Pi's 2,000-line/50 KB limit, and serializes writes through the project's `backlog/` directory. `typebox` is a Pi peer dependency for its parameter schema.

See [Devflow Package](../devflow.md).
