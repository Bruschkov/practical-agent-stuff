# Backlog Workflow

A Pi package that turns ideas into reviewed, traceable implementation through [Backlog.md](https://backlog.md).

## Idea

Backlog.md is the durable source of truth; chat is not. Humans approve scope and final changes, while Pi handles the repetitive loop:

1. refine an idea into acceptance criteria and small tickets;
2. implement one ready ticket at a time in an isolated worker;
3. review and rework automatically;
4. pause for human decisions;
5. reconcile and approve the finished feature.

Refinement and implementation are independent stages. `/refine` only publishes and commits backlog tickets; it never starts code changes. `/implement-run` can consume any compatible published ticket later—even in another Pi session.

The controller—not workers—owns ticket status changes and scoped Git commits.

## Install

Requires Pi, Git, and Node.js/npm.

```bash
git clone https://github.com/Bruschkov/practical-agent-stuff.git
cd practical-agent-stuff
npm ci --prefix pi-extensions/backlog-workflow
pi install "$PWD/pi-extensions/backlog-workflow"
```

For a project-local installation, run this from the target repository instead:

```bash
pi install -l /absolute/path/to/practical-agent-stuff/pi-extensions/backlog-workflow
```

Then open Pi there and initialize the workflow:

```text
/workflow-init
```

## When you open Pi

Run `/workflow-init` once per repository. After that, use whichever entry point matches your intent—there is no required sequence:

- `/workflow-inbox` — check or answer deferred human requests.
- `/refine <idea>` — shape future work without implementing it.
- `/implement-run` — choose a published feature and start implementation.

If unsure, check `/workflow-inbox` first; it reports when empty. Then implement existing work or refine a new idea.

With no argument, `/implement-run` opens a **feature picker**, not a task picker. After selection, it automatically chooses ready leaf tasks by rework status, priority, backlog order, and ID. Use `/implement-run <task-id>` only when you want one specific leaf.

## Example

```text
/refine Add CSV export for reports
```

Answer Pi's questions, inspect the proposed feature/tasks, and approve publication. Later, when you want implementation, run the published feature or one leaf task:

```text
/implement-run TASK-12
```

A feature run processes ready descendants sequentially, reviews each change, handles rework, and ends with a scoped diff for final approval.

### Parallel refinement and implementation

Use separate Pi sessions to refine upcoming work while implementing an already-published feature:

```text
Session A: /implement-run TASK-12
Session B: /refine Add scheduled report exports
```

These stages touch separate concerns and can proceed independently. Do not run multiple `/implement-run` controllers in the same Git worktree.

## State flow

```text
refinement draft --approval--> Open tickets

Open/Rework --> In Progress --> In Review --> Done
                    │              │
                    ├--> Blocked   ├--> Rework --> In Progress
                    ├--> Needs Human
                    └--> Open (failed or cancelled)

Needs Human --answer--> Open
all feature leaves Done --> reconciliation --> feature In Review --> final human approval --> Done
```

`/implement-run` asks for human input immediately when possible. If you dismiss the prompt, the request remains in `Needs Human`; run `/workflow-inbox` later from any interactive Pi session—no dedicated third session required. The answer reopens the ticket; rerun `/implement-run` if no feature run is still active.

Review-triggered rework runs automatically, up to two attempts. `Blocked` work stays paused until its external blocker is resolved and the ticket is reopened.

## Commands

- `/workflow-init` — initialize or reconcile the project's Backlog.md workflow.
- `/refine <idea-or-draft-id>` — create or resume refinement; omit the argument to select a draft or incoming handoff.
- `/implement-run <task-or-feature-id>` — implement one leaf or burn down a feature; omit the argument for a feature picker and automatic leaf selection.
- `/workflow-inbox` — answer requests waiting in `Needs Human`.
- `/workflow-commit-backlog` — retry a failed scoped backlog commit without republishing tickets.

Interactive Pi mode is required for confirmations and human input.

## Architecture

```text
Pi main session (refinement + human approval)
                │
Workflow controller (Backlog.md state + scoped Git operations)
                │
     isolated implementer → read-only reviewer → reconciler
```

The package uses its pinned local Backlog.md CLI. Implementation, review, and reconciliation evidence is persisted on tickets so interrupted work remains resumable and auditable. Workers run in the target project with its normal Pi instructions and resources; optional `backlog-handoff` integration remains non-blocking.
