# Backlog Workflow Package

## Read when
- Changing `pi-extensions/backlog-workflow/` or its contract tests.

## Package boundary
- The package manifest loads `index.ts` as a Pi extension.
- `backlog.md` is a package-local runtime dependency with the compatible range `^1.4.0`; use its locally installed CLI, not a Homebrew or other global installation.
- The lockfile records the currently resolved release. Do not change the supported range without validating the CLI contract.
- Pi npm/git package installs install runtime dependencies. For source-local development, run `npm install` in `pi-extensions/backlog-workflow/` before loading it.
- Future workflow code must consume the Backlog.md CLI's JSON interface, not its internal TypeScript API.

## CLI contract
- Source-local test setup: `npm install` in `pi-extensions/backlog-workflow/`.
- The contract test runs that local binary in a temporary Git repository.
- It verifies initialization/config lookup; task and draft create, read, update, archive; task parent/dependency data; task comments/assignees; and repeatable JSON for `task list` and `task view`.
- Backlog.md provides `--json` for task reads; draft reads use `--plain`.

## Verification
- `node --test tests/pi-extensions/backlog-workflow/contract.test.mjs`

## Related
- [Decision: Use package-local Backlog.md CLI](decisions/2026-09-03-use-package-local-backlog-cli.md)
- [`pi-extensions/backlog-workflow/package.json`](../../pi-extensions/backlog-workflow/package.json)
