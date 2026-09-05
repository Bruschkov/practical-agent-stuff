# Architecture Decision Records

ADRs for durable repo decisions.

## Read when
- Making architecture, workflow, storage, or compatibility decisions likely to affect future agents.
- Looking for accepted constraints before changing repo structure.

## Index
- [2026-09-03 — Use a package-local Backlog.md CLI](2026-09-03-use-package-local-backlog-cli.md) — accepted.
- [2026-09-03 — Adopt a Backlog.md workflow contract](2026-09-03-adopt-backlog-workflow-contract.md) — accepted; governs independent refinement/implementation, session-local controller ownership and cancellation, guided feature selection, leaf completion, reconciliation, and scoped commits.

## Rules / workflow
- Store ADRs in this directory.
- Use `adr-skill` with `--dir .agents/docs/decisions` when available.
- Update this index when adding, superseding, or deprecating ADRs.

## Minimal ADR shape
- Status
- Context
- Decision
- Consequences
- Implementation notes
- Verification
