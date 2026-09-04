# Backlog workflow extension

## Phase 1 — Foundation

- [x] Create `pi-extensions/backlog-workflow/` as a locally installable Pi package, add `backlog.md`, register a minimal extension, and add a contract-test entry point.
- [x] Verify the package-local Backlog.md CLI in a temporary Git repository: initialization, config discovery, task/draft CRUD, parent/dependency data, comments, assignments, and stable `--json` output.
- [x] Define the required Backlog.md statuses, task types, priorities, and Definition of Done; record the accepted workflow contract in an ADR.
- [x] Synchronize `pi-extensions/backlog-workflow/package-lock.json` so `npm ci --prefix pi-extensions/backlog-workflow` installs, then rerun its contract test.
- [x] Implement idempotent `/workflow-init`: require Git, initialize Backlog.md when absent, install or reconcile the required config with confirmation, and fail clearly on incompatibility.

## Phase 2 — Interactive refinement

- [x] Add one package-local `backlog` tool wrapping the pinned CLI with structured arguments, bounded output, and serialized writes.
- [x] Implement `/refine <idea-or-draft-id>` as an interactive main-session workflow that creates or resumes a draft and keeps accepted decisions in Backlog.md.
- [x] Make refinement propose intent, acceptance criteria, feature/sub-feature/task decomposition, priorities, and dependencies; publish tasks only after explicit user approval.
- [x] Integrate optionally with `backlog-handoff`: include incoming handoffs in no-argument `/refine` selection, report inbox count/integration status, preserve handoff metadata, and move a handoff to `processed/` only after successful ticket publication.
- [x] Add refinement contract tests covering draft creation/resume, the approval boundary, handoff discovery/publication, and the handoff file-format contract.

## Phase 3 — One-ticket implementation

- [ ] Add a worker-only terminating `complete_transition` tool with validated outcomes: `completed`, `needs_human`, `blocked`, and `failed`.
- [ ] Add an isolated child-Pi runner based on Pi's subagent pattern: JSON event parsing, project cwd/context inheritance, cancellation, bounded output, usage capture, and failure reporting.
- [ ] Bonus: inherit installed `backlog-handoff` into implementation workers so they can route discovered cross-project work.
- [ ] Add the implementer worker prompt: read the ticket and project instructions, implement minimally, run required checks, assess documentation impact, and return structured evidence.
- [ ] Implement `/implement-run <task-id>` for one ready, unblocked leaf task and persist its plan, notes, modified files, acceptance-criteria progress, and final summary through Backlog.md.
- [ ] Add an end-to-end test with fake Pi output proving successful completion, malformed-result failure, and blocked-task refusal.

## Phase 4 — Review, rework, and HITL

- [ ] Add a read-only reviewer worker and route successful implementation through review before task completion.
- [ ] Persist review findings and rerun the implementer on required rework; cap repeated rework and pause with diagnostics.
- [ ] On `needs_human`, persist the request and assign `@human` before opening Pi UI; persist answers or leave deferred requests resumable.
- [ ] Add `/workflow-inbox` to list and resolve pending human requests.
- [ ] Test approval, rejection, deferred input, cancellation, and restart behavior.

## Phase 5 — Feature burn-down

- [ ] Extend `/implement-run <feature-id>` to discover descendant leaf tasks and select only tasks whose dependencies are complete and which are neither blocked nor human-owned.
- [ ] Apply deterministic ordering: interrupted/rework first, then configured priority, Backlog order, and task ID.
- [ ] Add no-argument feature selection with command completion; never switch features silently.
- [ ] Continue sequentially through implementation, review, rework, and HITL until the selected feature has no runnable tasks.
- [ ] Test hierarchy, dependency, priority, and resume selection against real Backlog.md JSON fixtures.

## Phase 6 — Reconciliation and completion

- [ ] Add a reconciler worker that checks parent acceptance criteria, affected project documentation, durable technical decisions, and related Backlog.md tickets after all implementation tasks finish.
- [ ] Present a final feature summary, checks, review evidence, and scoped diff for explicit human approval.
- [ ] Implement optional final commit using explicitly owned paths only; never use `git add -A`.
- [ ] Add same-worktree guards: refinement cannot manipulate Git state, the controller exclusively owns the Git index, and concurrent Backlog.md writes are serialized.
- [ ] Document installation, `/workflow-init`, `/refine`, `/implement-run`, `/workflow-inbox`, configuration requirements, recovery, and current single-controller limitation.
- [ ] Run existing repository contract tests plus the new workflow-extension tests.
