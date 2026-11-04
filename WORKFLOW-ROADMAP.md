# Manual agentic development workflow — roadmap

Status: proposed design. No implementation yet. Devflow is a failed experiment, not the foundation or a compatibility contract.

## Outcome and boundaries

Three standalone skills: refine, implement, review. The user invokes each manually in an agent session; the skill selects one suitable ticket unless given an explicit ID. Each invocation stops at its own handoff boundary.

- Ticket reads/writes use available MCP tools, initially on one chosen backend (Backlog.md or GitLab).
- Tickets hold durable decisions, implementation evidence, review findings, and branch/PR references. Session history is not the handoff mechanism.
- The user performs final merge. No automatic loops, feature burn-down, daemon, or custom session controller.
- Domain-context provisioning is explicitly out of scope; skills still follow existing project instructions and inspect relevant code.
- Proposed asset location: versioned `skills/` in this repository. A separate repository/name remains optional, not a prerequisite.

## Milestone 0 — Agree the shared contract

Resolve these questions before writing skills:

- [ ] Choose the first MCP ticket backend and verify its actual read, update, comment, status, and dependency capabilities. Do not assume tools or fields exist.
- [ ] Agree logical states and their backend mapping: Unrefined → Ready to implement → In progress → Ready for review → completion. Review rejection returns to Ready to implement with unresolved findings retained.
- [ ] Decide completion semantics: original request says review approval means Done; recommendation is Approved / Awaiting merge, with Done after human merge. This recommendation is not yet agreed.
- [ ] Define how an invocation records ownership and avoids taking already-owned tickets. Start with one active implementer per worktree; do not promise race-free concurrent claiming without backend support.
- [ ] Agree selection: unresolved required rework first, then priority, then oldest ready ticket, then stable ticket ID. Explicit IDs still undergo readiness checks.
- [ ] Agree branch policy: task branch by default; shared development branch only by explicit agreement recorded during refinement, with a named base, integration PR, and ticket-specific review scope.
- [ ] Choose PR tooling separately from ticket tooling. Confirm what happens if credentials or creation/update capabilities are unavailable.
- [ ] Define project checks and the minimal ticket handoff fields below. Prefer an existing project configuration surface over inventing a configuration framework.

**Exit:** one concise shared contract, usable by all three skills, with no unresolved status/merge ambiguity. The actual contract can live in a shared reference; installation must preserve access to it for every skill.

### Minimal durable handoff

Use backend fields where available, otherwise a clearly named description/comment section:

- Intent, scope/non-goals, testable acceptance criteria, priority, blockers, and approved refinement decisions.
- Branch strategy, base, working branch, PR link, and implementation commit.
- Required review findings and their resolution; implementation summary, changed files, check results, documentation/decision impact, and remaining blockers.
- Review verdicts from both personas, exact reviewed commit, and explicitly unverified areas.

No large custom schema or backend abstraction layer for the first version.

### Dependency policy

Explicit `blocked by` relationships are enough; no separate graph engine. Hierarchy is not a dependency. Reject cycles and unresolved dependency references during refinement.

A prerequisite is usable only when its changes are available in the chosen implementation base. An agent-approved but unmerged ticket does not automatically unblock another task. Shared-branch exceptions require checking actual code availability and recording the relationship; avoid stacked-PR automation initially.

## Milestone 1 — Refinement skill

- [ ] Support explicit ticket ID or deterministic selection of one unrefined ticket.
- [ ] Read the ticket and relevant project/code context; discuss intent, scope, acceptance criteria, dependencies, and branch strategy with the user.
- [ ] Split oversized work only when useful; keep proposed child tickets pending approval.
- [ ] Persist accepted decisions so interrupted refinement can resume.
- [ ] Obtain explicit approval of the final proposal before publishing implementable work or moving it to Ready to implement.
- [ ] Stay in refinement; never start implementation automatically.

**Exit:** an approved ticket is implementable without reconstructing the conversation; cancelled or ambiguous refinement never becomes ready.

## Milestone 2 — Implementation skill

- [ ] Select one ready, unblocked, unowned ticket; explain selection or why nothing is runnable.
- [ ] Verify repository, clean/safe worktree, branch/base, dependency availability, and required tools before changing files. Never discard unrelated work.
- [ ] Mark In progress, implement only agreed scope, and address persisted review findings on rework.
- [ ] Run relevant checks, assess documentation and durable-decision impact, and persist evidence.
- [ ] Commit/push only intended changes under the agreed repository policy; create or update the task/integration PR, never merge it.
- [ ] Move to Ready for review only with complete implementation evidence and the required PR reference; then stop.
- [ ] On failure or interruption, record the last successful step and blocker. Resume the existing branch/PR rather than creating duplicates. Never claim that a failed status update or PR operation succeeded.

**Exit:** another session can review the exact implementation from ticket evidence, without access to the implementing session.

## Milestone 3 — Review skill

- [ ] Select one Ready for review ticket or validate an explicit ID; establish its exact diff and commit.
- [ ] Engineer pass: acceptance criteria, correctness, regressions, tests, maintainability, and documentation impact.
- [ ] Security pass: authorization, trust boundaries, input handling, secrets, and relevant dependency risks. Mark genuinely inapplicable checks with reasons.
- [ ] Use separate reviewer contexts when supported; otherwise perform distinct passes and disclose that they are not independent reviewers. Do not require a new subagent extension.
- [ ] Keep source review read-only; ticket/PR feedback and status updates are permitted. Do not silently fix code during review.
- [ ] Persist actionable findings with severity, file/line references, rationale, and required fixes. Distinguish blocking findings from optional suggestions.
- [ ] Blocking findings return the ticket to Ready to implement; missing evidence leaves it in Ready for review with the missing items recorded.
- [ ] Approval requires both passes and sufficient check evidence, using the completion state agreed in Milestone 0. Changed commits require renewed review.
- [ ] Stop after the verdict; never invoke implementation or merge automatically.

**Exit:** review produces a reproducible verdict tied to a commit, with no implied human merge approval.

## Milestone 4 — Pilot and simplify

- [ ] Walk a small real ticket through refine → implement → review → human merge using fresh sessions at handoffs.
- [ ] Exercise rejection → manual implementation rework → manual re-review on the same ticket/PR.
- [ ] Check an unmerged prerequisite, cancelled refinement, missing MCP access, failing checks, and unavailable PR creation.
- [ ] Check interruption/resume, an already-owned ticket, unrelated worktree edits, and changes after review approval.
- [ ] Pilot one agreed shared-branch case to verify ticket-specific review scope and PR reuse.
- [ ] Keep a small scenario checklist with expected transitions; record actual outcomes. Validate skill metadata, reference links, and installation with supported tooling.
- [ ] Publish concise setup/invocation instructions with verified syntax for the chosen harness; do not assume a particular slash-command registration mechanism.
- [ ] After the replacement works, compare `prompts/backlog-from-requirement.md`, `prompts/backlog-from-handoff.md`, and `prompts/backlog-start-task.md` against the new skills. Retire duplicates and document replacement invocation/install instructions; preserve unrelated TODO/context prompts.

**Exit:** manual happy path, rework, and failure paths are demonstrated; no handoff relies on hidden session memory.

## Later, only if demonstrated useful

Validate a second MCP backend before claiming backend portability. Add optional backlog-handoff intake only if needed. Consider additional concurrency, richer selection, or automation only after the manual workflow is reliable and the user explicitly requests it.

Not planned now: a controller extension, dependency visualization, automatic implementation/review retries, automatic merge, comprehensive domain-context delivery, or compatibility with devflow.
