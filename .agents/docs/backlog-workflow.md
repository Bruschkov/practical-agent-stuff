# Backlog Workflow Package

## Read when
- Changing `pi-extensions/backlog-workflow/` or its contract tests.

## Package boundary
- The package manifest loads `index.ts` as a Pi extension.
- `backlog.md` is a package-local runtime dependency with the compatible range `^1.4.0`; use its locally installed CLI, not a Homebrew or other global installation.
- The lockfile records the resolved CLI and peer-dependency graph required by `npm ci`. Do not change the supported range without validating the CLI contract.
- For source-local development, run `npm ci --prefix pi-extensions/backlog-workflow` before loading it. Use `npm install --prefix pi-extensions/backlog-workflow` only to resynchronize the lockfile after a manifest change, then verify with `npm ci`.
- Future workflow code must consume the Backlog.md CLI's JSON interface, not its internal TypeScript API.

## CLI contract
- Source-local test setup: `npm ci --prefix pi-extensions/backlog-workflow`.
- The contract test runs that local binary in a temporary Git repository.
- It verifies initialization/config lookup; task and draft create, read, update, archive; task parent/dependency data; task comments/assignees; and repeatable JSON for `task list` and `task view`.
- Backlog.md provides `--json` for task reads; draft reads use `--plain`.

## Workflow configuration
- The required types, statuses, priorities, refinement approval boundary, HITL handling, and Definition of Done are defined by [Adopt a Backlog.md workflow contract](decisions/2026-09-03-adopt-backlog-workflow-contract.md).
- `/workflow-init` is interactive and requires Git. It operates at the Git top level, initializes an absent Backlog.md project only after confirmation, and reconfirms before changing an existing configuration.
- It reconciles `default_status` (`Open`), the required status/type/priority lists, and `definition_of_done` in the discovered project YAML. It supports `backlog.config.yml`, `backlog/config.yml`, and `.backlog/config.yml`; other locations fail clearly rather than being changed blindly.
- `backlog config set` cannot write list-valued `statuses`, `types`, or `priorities`; `/workflow-init` validates its YAML changes through package-local `backlog config get`. Backlog.md exposes `definition_of_done` as `definitionOfDone` in that command. It has no configurable default priority, so workflow ticket creation must pass `Medium` explicitly when none is selected.

## Verification
- `npm ci --prefix pi-extensions/backlog-workflow && node --test tests/pi-extensions/backlog-workflow/contract.test.mjs`
- The contract test covers initialization, idempotent reruns, required configuration validation, Git refusal, and declined reconciliation.

## Related
- [Decision: Use package-local Backlog.md CLI](decisions/2026-09-03-use-package-local-backlog-cli.md)
- [Decision: Adopt a Backlog.md workflow contract](decisions/2026-09-03-adopt-backlog-workflow-contract.md)
- [`pi-extensions/backlog-workflow/package.json`](../../pi-extensions/backlog-workflow/package.json)
