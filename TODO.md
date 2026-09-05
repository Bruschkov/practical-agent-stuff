# Devflow extension

## Phase 1 — Foundation

- [x] Create `pi-extensions/devflow/` as a locally installable Pi package, add `backlog.md`, register a minimal extension, and add a contract-test entry point.
- [x] Verify the package-local Backlog.md CLI in a temporary Git repository: initialization, config discovery, task/draft CRUD, parent/dependency data, comments, assignments, and stable `--json` output.
- [x] Define the required Backlog.md statuses, task types, priorities, and Definition of Done; record the accepted workflow contract in an ADR.
- [x] Synchronize `pi-extensions/devflow/package-lock.json` so `npm ci --prefix pi-extensions/devflow` installs, then rerun its contract test.
- [x] Implement idempotent `/devflow-init`: require Git, initialize Backlog.md when absent, install or reconcile the required config with confirmation, and fail clearly on incompatibility.

## Phase 2 — Interactive refinement

- [x] Add one package-local `backlog` tool wrapping the pinned CLI with structured arguments, bounded output, and serialized writes.
- [x] Implement `/refine <idea-or-draft-id>` as an interactive main-session workflow that creates or resumes a draft and keeps accepted decisions in Backlog.md.
- [x] Make refinement propose intent, acceptance criteria, feature/sub-feature/task decomposition, priorities, and dependencies; publish tasks only after explicit user approval.
- [x] Integrate optionally with `backlog-handoff`: include incoming handoffs in no-argument `/refine` selection, report inbox count/integration status, preserve handoff metadata, and move a handoff to `processed/` only after successful ticket publication.
- [x] Add refinement contract tests covering draft creation/resume, the approval boundary, handoff discovery/publication, and the handoff file-format contract.

## Phase 3 — One-ticket implementation

- [x] Add a worker-only terminating `complete_transition` tool with validated outcomes: `completed`, `needs_human`, `blocked`, and `failed`.
- [x] Add an isolated child-Pi runner based on Pi's subagent pattern: JSON event parsing, project cwd/context inheritance, cancellation, bounded output, usage capture, and failure reporting.
- [x] Bonus: inherit installed `backlog-handoff` into implementation workers so they can route discovered cross-project work.
- [x] Add the implementer worker prompt: read the ticket and project instructions, implement minimally, run required checks, assess documentation impact, and return structured evidence.
- [x] Implement `/implement-run <task-id>` for one ready, unblocked leaf task and persist its plan, notes, modified files, acceptance-criteria progress, and final summary through Backlog.md.
- [x] Add an end-to-end test with fake Pi output proving successful completion, malformed-result failure, and blocked-task refusal.

## Phase 4 — Review, rework, and HITL

- [x] Add a read-only reviewer worker and route successful implementation through review before task completion.
- [x] Persist review findings and rerun the implementer on required rework; cap repeated rework and pause with diagnostics.
- [x] On `needs_human`, persist the request and assign `@human` before opening Pi UI; persist answers or leave deferred requests resumable.
- [x] Add `/devflow-inbox` to list and resolve pending human requests.
- [x] Test approval, rejection, deferred input, cancellation, and restart behavior.

## Phase 5 — Feature burn-down

- [x] Extend `/implement-run <feature-id>` to discover descendant leaf tasks and select only tasks whose dependencies are complete and which are neither blocked nor human-owned.
- [x] Apply deterministic ordering: rework first, then configured priority, Backlog order, and task ID.
- [x] Add no-argument feature selection with command completion; never switch features silently.
- [x] Continue sequentially through implementation, review, rework, and HITL until the selected feature has no runnable tasks.
- [x] Test hierarchy, dependency, priority, and resume selection against real Backlog.md JSON fixtures.

## Phase 6 — Reconciliation and completion

- [x] Add a reconciler worker that checks parent acceptance criteria, affected project documentation, durable technical decisions, and related Backlog.md tickets after all implementation tasks finish.
- [x] Present a final feature summary, checks, review evidence, and scoped diff for explicit human approval.
- [x] Implement optional final commit using explicitly owned paths only; never use `git add -A`.
- [x] Commit published refinement backlog changes through controller-owned Git operations, preserve staged implementation files, and provide scoped commit recovery without republishing.
- [x] Document installation, `/devflow-init`, `/refine`, `/implement-run`, `/devflow-inbox`, configuration requirements, recovery, and current single-controller limitation.
- [x] Migrate backlog-handoff to the current Pi package namespace, then run existing repository contract tests plus the workflow-extension tests.

## Phase 7 — Documentation

- [x] Refine with the user the documentation scope: architecture, intended workflows, commands, and best practices. End users first; maintainer material remains in agent docs.
- [x] Add a concise end-user guide covering philosophy, installation, usage, commands, and architecture.

## Phase 8 — Guided implementation selection

- [x] Let no-argument `/implement-run` recommend a feature and its next runnable leaf with a short rationale, while preserving explicit user selection.

## Phase 9 — Session control and HITL recovery

- [x] Keep the Pi session that started `/implement-run` busy until the controller settles; show its phase/task, allow cancel/status only, and keep refine/inbox sessions usable.
- [x] Replace one-shot `Needs Human` input with a same-session, contextual dialogue: show the task, request, evidence, and options; persist each reply; only a human-confirmed continuation resumes work.
- [x] On reload, cancellation, or child failure, recover a started task from `In Progress` rather than stranding it.
- [x] Reconcile completed leaves into their sub-feature state before final feature approval; do not ask humans to infer or manually apply parent status changes.
