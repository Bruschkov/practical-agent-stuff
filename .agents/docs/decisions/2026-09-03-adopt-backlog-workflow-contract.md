---
status: accepted
date: 2026-09-03
decision-makers: Bruschkov
---

# Adopt a Backlog.md workflow contract

## Context and Problem Statement

The devflow Pi package needs one shared vocabulary before it can initialize Backlog.md projects, refine ideas into tickets, run implementation workers, and resume work safely. Backlog.md itself supplies task and draft storage, but the package has not yet selected the statuses, hierarchy, priorities, completion rule, or human-in-the-loop behavior that its later commands must enforce.

The package must use the package-local Backlog.md CLI and its supported command boundary, as required by [Use a package-local Backlog.md CLI](2026-09-03-use-package-local-backlog-cli.md). This decision defines workflow semantics only; it does not add a CLI wrapper or Pi commands.

## Decision

### Task taxonomy

Use only these task types:

- `feature`: a top-level outcome; it may contain `sub-feature` and/or `task` children.
- `sub-feature`: an optional grouping child of a `feature`; it may contain `task` children.
- `task`: an implementable leaf; it may be a direct child of a `feature` or child of a `sub-feature`, and has no children.

Do not introduce epic, bug, chore, spike, or other types. Represent those concerns in the title, description, acceptance criteria, or labels if Backlog.md supports them.

### Priorities

Use `Critical`, `High`, `Medium`, and `Low`, in that order. Workflow-created tickets default to `Medium`; the controller passes that priority explicitly because Backlog.md has no configurable default priority. Priority orders otherwise-equivalent runnable work; it does not override a dependency, block, or human assignment.

### Task status lifecycle

Use only these statuses:

- `Open`: published and potentially runnable.
- `In Progress`: an implementation worker is currently assigned to a run.
- `In Review`: implementation is complete and awaits automated review or final feature approval.
- `Rework`: review found required changes; runnable ahead of ordinary `Open` work.
- `Blocked`: an external condition or unmet dependency prevents progress.
- `Needs Human`: a worker needs a human answer or decision. Assign `@human` and persist the request before presenting UI.
- `Done`: completion criteria below are satisfied.

The controller changes status. Workers return outcomes, not arbitrary status changes. A cancelled or failed run records its outcome and evidence and returns the ticket to `Open`. `Rework` is selected ahead of ordinary `Open` work; returned `Open` work follows normal priority ordering (clarified 2026-09-04). `Blocked` and `Needs Human` tickets are never runnable. A human may persist one or more responses, but only an explicit confirmed continuation clears `@human`, reopens the ticket to `Open`, and resumes implementation selection. `Done` is terminal unless a human explicitly reopens the ticket.

### Refinement

Refinement uses a Backlog.md draft, not task statuses. An unarchived draft is active/resumable and records intent, acceptance criteria, proposed hierarchy, priorities, dependencies, and `Approval: pending`. No task is published before explicit user approval. On approval, create the proposed tickets, record their IDs in the draft, archive it, then have controller code stage only `backlog/` and commit with `git commit --only -- backlog`. A linked handoff moves to `processed/` only after that commit. A rejected, deferred, or cancelled proposal remains an unarchived draft for later refinement.

The main-session refiner does not run Git. Controller code owns the refinement commit; the implementer controller separately stages only recorded implementation files at final feature approval. Do not add general same-worktree locks for the single-controller workflow. A staged-tree change aborts final feature approval for retry rather than allowing an unrelated commit.

If the refinement commit fails after publication, leave the published backlog changes pending and the handoff in the inbox. Retry only the scoped backlog commit through `/devflow-commit-backlog`; do not rerun publication, which would duplicate tickets.

### Definition of Done

A `task` may move to `Done` only when all of the following are persisted in Backlog.md:

1. Its acceptance criteria are met.
2. Required checks pass, or each non-applicable check is explicitly marked not applicable with a reason.
3. Required review is accepted and any required rework is complete.
4. Documentation and durable-decision impact is assessed; affected material is updated when needed.
5. The implementation summary, modified files, and check/review evidence are recorded.
6. No unresolved dependency, blocker, or human request remains.

A `feature` or `sub-feature` may move to `Done` only after all descendant tasks are `Done` and its own acceptance criteria are met. A feature additionally requires reconciliation and explicit final human approval. When recorded descendant changes stage successfully, that approval also authorizes one final commit using explicitly owned paths; a feature with no staged recorded changes has no commit to make.

Non-goals: adding a Backlog.md dependency, changing its CLI compatibility range, defining a multi-controller workflow, or implementing the commands governed by this contract.

## Consequences

- `/devflow-init` can install or reconcile a single, deterministic project configuration.
- `/refine` has an explicit approval boundary and one scoped backlog commit without inventing task states for unfinished ideas.
- `/implement-run` can distinguish retryable rework, external blocks, and human questions without selecting non-runnable tickets.
- Later controllers must persist run and review evidence before marking work `Done`; this makes completion auditable but requires more ticket updates.

## Implementation Plan

- **Affected paths**: `pi-extensions/devflow/index.ts`, `tests/pi-extensions/devflow/contract.test.mjs`, and the Backlog.md config created by `/devflow-init`.
- **Dependencies**: retain `backlog.md` `^1.4.0`; add none.
- **Patterns to follow**: invoke the package-local CLI and consume its JSON boundary, per [the package-local CLI ADR](2026-09-03-use-package-local-backlog-cli.md); keep refinement decisions in Backlog.md drafts.
- **Patterns to avoid**: global Backlog.md executables, direct Backlog.md API imports, publishing before explicit approval, worker-controlled status writes, and ad-hoc task types or statuses.
- **Configuration**: `/devflow-init` must reconcile the seven statuses, three types, and four priorities with user confirmation before changing an existing project configuration. Ticket-creation code supplies `Medium` when no priority is chosen. It must report incompatible configurations clearly rather than silently changing them.

### Verification

- [x] `/devflow-init` creates or reconciles a Backlog.md configuration containing exactly the specified task types, statuses, and priorities only after required confirmation; workflow-created tickets without a chosen priority receive explicit `Medium`.
- [x] Refinement contract tests prove that unapproved drafts create no tasks, approved drafts record published ticket IDs before archiving, the controller commits only `backlog/` without consuming staged implementation paths, a failed scoped commit can retry without republishing, and valid incoming handoffs preserve their source format and move to `processed/` only after the scoped commit.
- [x] Implementation contract tests prove `Needs Human` assigns `@human`, persists contextual dialogue replies, requires confirmation before reopening, excludes human-owned tasks from selection, selects rework before ordinary open work, and requires persisted evidence for `Done`.
- [x] Review contract tests prove reviewer evidence is persisted, two rework attempts rerun the implementer, and the cap assigns `@human` with diagnostics.
- [x] Final approval stages and commits only validated recorded descendant paths; pre-existing or post-review index changes abort the commit, and declined approval may retain human feedback for discussion.
- [x] `node --test tests/pi-extensions/devflow/contract.test.mjs` passes.

## Alternatives Considered

- Reuse only Backlog.md defaults: rejected because defaults do not express the worker, review, and human-in-the-loop lifecycle required by this package.
- Use a generic `Blocked` status for human questions: rejected because an answer from a person and an external dependency need different inbox and resume behavior.
- Require every task to have a sub-feature parent: rejected because small features should not need a placeholder grouping ticket.
- General same-worktree locks: rejected for the current single-controller model because expected refinement/implementation overlap is rare, scoped commits preserve unrelated staged paths, and the existing final-approval staged-tree check fails safely for retry. Revisit when concurrent controllers or automation become normal.

## More Information

Revisit this contract if Backlog.md cannot represent the required configuration through its supported CLI, or if the package gains multiple concurrent controllers.

2026-09-03: Backlog.md 1.51.0 reads `statuses`, `types`, and `priorities` through `backlog config get`, but `backlog config set` rejects those list-valued keys. `/devflow-init` must therefore update the project YAML only after confirmation and validate through the CLI. `definition_of_done` is supported in the YAML and appears as `definitionOfDone` in task JSON. Backlog.md has no configurable default priority.

2026-09-04: `refinement_publish` adds the approval boundary without another extension dependency: it validates proposal-local feature/sub-feature/task parentage and dependencies, asks for final interactive confirmation, creates parents before children, applies dependencies after IDs exist, records approval and ticket IDs in the draft, then archives it. Declined confirmation leaves the draft unchanged.

2026-09-04: Optional backlog-handoff intake reads its on-disk config and registry rather than importing the extension. A selected handoff's complete source content and a source marker are retained in its refinement draft. Only after ticket publication and draft archival does the controller move that source file to `processed/`; an unavailable integration or failed move leaves it in the inbox.

2026-09-04: Outgoing handoffs from implementation workers are a bonus, not a prerequisite for core workflow delivery. The child-Pi runner and `/implement-run` must work with no handoff extension. Once the runner exists, it may inherit an installed `backlog-handoff` extension; do not add a workflow dependency, detection, adapter, or dedicated tests for this optional capability.

2026-09-04: A child worker opts into its final-result tool with `PI_DEVFLOW_WORKER=1`. In that mode only, `complete_transition` accepts `completed`, `needs_human`, `blocked`, or `failed`, returns the outcome to the controller, and terminates the child run. It makes no Backlog.md mutation, so controller-only status transitions remain enforced.

2026-09-04: Verified `runChildPi` supplies the workflow extension without `--no-extensions`; Pi therefore discovers an installed project- or global-level `backlog-handoff` for the worker. No dependency, detection, adapter, or dedicated test is needed.

2026-09-04: Automated review reuses the child-Pi runner in read-only mode rather than a separate executor. That mode allows only `read`, `grep`, `find`, `ls`, `backlog`, and `complete_transition`, sets `PI_DEVFLOW_REVIEWER=1`, and rejects mutating `backlog` operations. The controller retains `In Review` until review evidence and any required rework are persisted; it must not move a task to `Done` first.

2026-09-04: A completed reviewer run returns JSON with an `approved` or `rework` verdict and concrete findings; do not add another `complete_transition` outcome. The controller persists that evidence as an `@reviewer` comment. It immediately reruns `rework` through the implementer, allowing two persisted attempts. A third rework verdict pauses the ticket in `Needs Human`, assigns `@human`, and records the cap diagnostic.

2026-09-04: An implementation or reviewer `needs_human` outcome persists its request and assigns `@human` before the controller prompts. A non-empty response is persisted as an `@human` comment, clears the assignment, and reopens the task; dismissal or unavailable UI leaves the task pending and resumable in `Needs Human`.

2026-09-04: Feature-child selection orders runnable `Rework` before `Open`, then configured priority, Backlog ordinal, and task ID. `Rework` is the only persisted resume class; do not add an interrupted marker or resume stale `In Progress` work. Failed or cancelled work returned to `Open` follows ordinary priority ordering.

2026-09-04: A selected feature repeats deterministic selection after each leaf reaches review, blocks, or pauses for deferred human input, instead of requiring one `/implement-run` invocation per task. A failed implementation remains `Open` and ends that invocation to avoid an unbounded automatic retry loop.

2026-09-04: After an approved review has been persisted, the controller moves the leaf to `Done`; it does not treat `In Review` as complete. Once every descendant leaf is `Done`, a read-only reconciler checks parent acceptance criteria, affected documentation, durable technical decisions, and related Backlog.md tickets. It persists clean reconciliation evidence on the feature and leaves the feature `In Review` until the separate final human-approval step is implemented.

2026-09-04: The final approval step presents the human with feature and leaf summaries, persisted check and review evidence, reconciliation evidence, and `git diff --no-ext-diff` scoped exclusively to recorded descendant modified files within the project root. Declining retains `In Review`; approval records an `@human` comment, marks feature acceptance criteria complete, and moves the feature to `Done`. Non-interactive runs retain `In Review`.

2026-09-04: Final human approval is the commit authorization; a second commit prompt is redundant. Before presenting approval, the controller rejects a non-empty index, stages only validated recorded descendant paths, and shows the cached diff and staged-path list. It verifies the index tree is unchanged after review before committing, so unrelated or post-review staging aborts the commit. A declined review unstages controller-owned paths and may persist feedback for main-session discussion; feedback does not itself request rework. The controller reruns reconciliation whenever a completed feature returns for final review, including after explicit rework.

2026-09-04: No-argument `/implement-run` places first and recommends, but never auto-selects, the feature containing the globally highest-ranked runnable leaf. It displays that leaf's status and priority as rationale and reuses the established deterministic leaf order: `Rework`, configured priority, Backlog ordinal, then task ID. Explicit feature selection remains the safety boundary.

2026-09-04: Refinement, inbox handling, and implementation are independent command entry points. One Git worktree may have one `/implement-run` controller plus optional interactive sessions refining future work or resolving persisted human requests; multiple implementation controllers remain unsupported. Final feature approval stays with the implementation-controller session, and every command persists pauses rather than acting as a permanent daemon.

2026-09-05: Controller session ownership is enforced with extension-instance state, a TUI input listener, and event/devflow-command guards in `pi-extensions/devflow/index.ts`. The guard spans selection through worker, persistence, approval, and cleanup phases; it rejects an already-active main agent and keeps separate refinement/inbox Pi instances usable. This enforces the existing session topology without introducing a worktree-wide lock or overriding Pi's native idle state. The TUI accepts cancellation/status hotkeys and controller-owned dialog input, not ordinary prompts or commands. `@earendil-works/pi-tui` is now an explicit `*` peer dependency for native key decoding rather than a custom terminal parser; the manifest and lockfile support source-local tests.

2026-09-05: All worker roles and controller dialogs share one cancellation signal. Cancellation requests do not release the session guard until workers and cleanup settle; graceful shutdown aborts and awaits that settlement. Keep in-flight Backlog.md writes intact. Before a final commit starts, cancellation rejects even a late affirmative dialog answer and unstages owned paths; after commit starts, finish recording its outcome. Persist declined-approval feedback before releasing the guard, but defer the main-session discussion message until afterward so the input guard does not discard it. This does not add crash-time stale-ticket recovery. Contract tests in `tests/pi-extensions/devflow/contract.test.mjs` verify the session guards, independent sessions, worker-phase cancellation, delayed recovery, picker/setup exits, and staged-approval cancellation. See [Controller session control](../devflow.md#controller-session-control) for mechanics and current recovery limits.

2026-09-05: `Needs Human` uses one same-session contextual dialogue in `/implement-run` and `/devflow-inbox`. It shows task, request, and persisted implementation evidence; `Add response` may be repeated and each reply is persisted. `Continue` must receive a separate confirmation before the controller records it, clears `@human`, reopens the ticket, and resumes deterministic selection. `Defer`, dismissal, or unavailable UI leaves the ticket pending. Reuse this protocol for implementation, review, and rework-cap requests; do not reopen solely because a response was entered.

2026-09-05: On a non-worker session reload, recover an `In Progress` leaf only when its latest comment is devflow's `@workflow` implementation-start marker; move it to `Open` and record the recovery. Startup, worker sessions, session replacement, and abrupt process loss do not recover stale tickets. The marker has no durable controller ownership, so another non-worker session in the same worktree cannot be distinguished from the controller's reload.

2026-09-05: After clean feature reconciliation, the controller marks each unfinished direct sub-feature `Done` and checks its acceptance criteria before setting the feature to `In Review`. The reconciler's required parent-acceptance-criteria check is the evidence for this automatic transition; final human approval remains feature-only.
