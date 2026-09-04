# Backlog Workflow Package

## Read when
- Changing `pi-extensions/backlog-workflow/` or its contract tests.

## Package boundary
- The package manifest loads `index.ts` as a Pi extension.
- `backlog.md` is a package-local runtime dependency with the compatible range `^1.4.0`; use its locally installed CLI, not a Homebrew or other global installation.
- The lockfile records the resolved CLI and peer-dependency graph required by `npm ci`. Do not change the supported range without validating the CLI contract.
- For source-local development, run `npm ci --prefix pi-extensions/backlog-workflow` before loading it. Use `npm install --prefix pi-extensions/backlog-workflow` only to resynchronize the lockfile after a manifest change, then verify with `npm ci`.
- Controller commands use the package-local CLI; main-session refinement uses the `backlog` Pi tool rather than shell commands or Backlog.md internals. The tool has structured task/draft operations; task reads use the CLI JSON interface and draft reads use plain text.

## CLI contract
- Source-local test setup: `npm ci --prefix pi-extensions/backlog-workflow`.
- The contract test runs that local binary in a temporary Git repository.
- It verifies initialization/config lookup; task and draft create, read, update, archive; task parent/dependency data; task comments/assignees; and repeatable JSON for `task list` and `task view`.
- Backlog.md provides `--json` for task reads; draft reads use `--plain`.

## Backlog tool
- The extension registers one `backlog` tool. Its `operation` is one of `task_list`, `task_view`, `task_create`, `task_edit`, `task_archive`, `draft_list`, `draft_view`, `draft_create`, `draft_edit`, `draft_archive`, `draft_promote`, or `refinement_publish`.
- Use named fields, never raw CLI arguments: `id`, `title`, `description`, `status`, `priority`, `type`, `parent`, `dependsOn`, `assignees`, `labels`, `acceptanceCriteria`, `comment`, `commentAuthor`, `ready`, `limit`, and `proposedTasks` as applicable.
- Task reads request CLI JSON; drafts use `--plain`. Tool output is capped at 2,000 lines or 50 KB. Write operations are queued on the project's `backlog/` directory; do not bypass the tool for Backlog.md mutations.
- `task_create` supplies `Medium` when `priority` is absent. An edit must provide a changed field, and `commentAuthor` requires `comment`.

## Refinement
- `/refine` requires interactive mode. `/refine <idea-or-draft-id>` creates a draft or resumes a `DRAFT-<number>`; no-argument `/refine` selects an active draft or valid incoming backlog-handoff and reports handoff integration status and inbox count.
- Handoff integration is optional and has no package dependency. When `.backlog-handoff/config.json` and its registry are available, the workflow reads the current project's configured inbox (including `handoffDir`); unavailable or invalid setup leaves ordinary idea/draft refinement available.
- Selecting a handoff creates a draft containing its source path and complete original content. Preserve the generated `backlog-handoff` marker and handoff metadata while refining.
- The main session reads a resumed draft, persists accepted decisions, and proposes intent, concrete acceptance criteria, and a feature/sub-feature/task hierarchy with priorities and dependencies. It must not create or promote tasks while approval remains pending.
- After the user explicitly approves the displayed proposal, use `refinement_publish` with the draft ID and matching `proposedTasks`. It requires final interactive confirmation, validates proposal-local hierarchy/dependencies, creates tickets with explicit or `Medium` priority, records approval and published IDs in the draft, then archives it. Only then does it move a linked handoff to `.backlog-handoff/processed/`; a move failure leaves the source in the inbox and reports it. Declining confirmation leaves the draft and handoff pending and creates no tickets.

## Implementation workers
- Core child-Pi runner and `/implement-run` behavior must work without `backlog-handoff`.
- As a bonus after the runner exists, inherit an installed `backlog-handoff` extension into workers so they can route discovered cross-project work. Do not add a dependency, detection, adapter, or dedicated test for it.

## Workflow configuration
- The required types, statuses, priorities, refinement approval boundary, HITL handling, and Definition of Done are defined by [Adopt a Backlog.md workflow contract](decisions/2026-09-03-adopt-backlog-workflow-contract.md).
- `/workflow-init` is interactive and requires Git. It operates at the Git top level, initializes an absent Backlog.md project only after confirmation, and reconfirms before changing an existing configuration.
- It reconciles `default_status` (`Open`), the required status/type/priority lists, and `definition_of_done` in the discovered project YAML. It supports `backlog.config.yml`, `backlog/config.yml`, and `.backlog/config.yml`; other locations fail clearly rather than being changed blindly.
- `backlog config set` cannot write list-valued `statuses`, `types`, or `priorities`; `/workflow-init` validates its YAML changes through package-local `backlog config get`. Backlog.md exposes `definition_of_done` as `definitionOfDone` in that command. It has no configurable default priority, so workflow ticket creation must pass `Medium` explicitly when none is selected.

## Verification
- `npm ci --prefix pi-extensions/backlog-workflow && node --test tests/pi-extensions/backlog-workflow/contract.test.mjs`
- The contract test covers the package-local CLI; the structured `backlog` tool (including bounded output and serialized writes); `/refine` draft creation/resume; valid handoff discovery, source-format preservation, and post-publication move to `processed/`; approval/refusal; hierarchy/dependency publication and archival; initialization; idempotent reruns; required configuration validation; Git refusal; and declined reconciliation.

## Related
- [Decision: Use package-local Backlog.md CLI](decisions/2026-09-03-use-package-local-backlog-cli.md)
- [Decision: Adopt a Backlog.md workflow contract](decisions/2026-09-03-adopt-backlog-workflow-contract.md)
- [`pi-extensions/backlog-workflow/package.json`](../../pi-extensions/backlog-workflow/package.json)
