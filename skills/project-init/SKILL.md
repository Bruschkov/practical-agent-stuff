---
name: project-init
description: Establishes project intent through repository inspection and a short user interview before initializing agent-facing documentation with agent-docs. Use for existing or greenfield projects via /skill:project-init, before documentation bootstrap.
---

# Project Init

Establish intent first; delegate documentation initialization to the installed `agent-docs` skill only after explicit user confirmation.

## Boundaries

- Documentation initialization only: no application scaffolding, dependency installation, git initialization, or unsolicited architecture decisions.
- Before confirmation, use read-only inspection and conversation only. Keep notes and the brief in conversation, not project files; do not run commands that generate artifacts. If the user cancels or declines, stop without project modifications.
- Never invent requirements, stack choices, commands, or architecture. Keep confirmed facts, proposals, and unresolved questions visibly separate throughout.

## 1. Inspect before interviewing

- Inspect the target directory even if it has no Git repository. Read applicable `AGENTS.md`, README, existing agent/user docs and ADRs; inspect relevant source, manifests, tests, CI, integration and deployment configuration when present. Respect access boundaries; avoid secrets.
- Summarize what exists today with source paths. Treat aspirational docs as intended behavior, not proof of implementation; surface contradictions rather than silently resolving them.
- For an empty or greenfield directory, state that little or nothing exists. Do not require a stack, database, framework, or deployment choice to document intent.
- Reuse answers already established by the repo or conversation. Ask only about gaps, contradictions, or intended changes.

## 2. Interview in small rounds

Ask at most three focused questions per round, then wait for answers. Adapt follow-ups to what is still missing:

- Purpose, problem being solved, and target users.
- Core use cases and expected outcomes.
- Scope, ownership boundaries (including adjacent systems/teams), and explicit non-goals.
- Known technical, integration, security/data-handling, and deployment constraints.
- What exists today versus what is intended next.

Mark repo-backed observations and explicit user decisions as **Confirmed** (cite paths or user answers); label suggestions **Proposed** and unanswered items **Unresolved**. Do not promote a proposal without agreement. “Not decided” is valid when it does not block useful documentation.

## 3. Confirm the project brief

Present a concise brief in conversation covering:

- Purpose and users.
- Core use cases.
- Scope, ownership boundaries, and non-goals.
- Known constraints.
- Current state versus intended direction.
- Proposals awaiting agreement and unresolved questions, with blockers distinguished from non-blocking unknowns.

Resolve material ambiguities before asking to proceed: conflicting purpose, scope/ownership, or constraints that would change documentation content or authorize work outside this scope. Leave non-blocking unknowns explicit; do not force premature technical choices.

Ask the user to confirm the brief and authorize documentation initialization. Wait for an explicit answer. If corrections materially change the brief, revise it and obtain confirmation again. Silence or an interview answer alone is not authorization.

## 4. Delegate documentation initialization

After confirmation:

1. Locate the installed `agent-docs` skill using the available skill listing and its resolved path. Read its `SKILL.md` with the file-reading tool; do not assume a sibling path or a particular installation directory.
2. If unavailable or unreadable, explain that the installed `agent-docs` skill is required and stop without project modifications. Do not silently install it, copy a substitute, or implement its workflow yourself.
3. Follow the loaded skill's **init** workflow directly in this session. Printing `/skill:agent-docs init` is not delegation; slash commands are not tools.
4. Carry the confirmed brief, evidence paths, current/intended distinction, constraints, non-goals, and remaining unknowns into that workflow. Reuse the inspection; perform any additional checks it requires. Do not re-interview for established answers.
5. Let `agent-docs` own documentation layout and creation. Ensure the root `AGENTS.md` includes the following instruction. Preserve useful existing docs and link rather than duplicate them. Do not write a separate project-brief file or repeat the brief across files; let `agent-docs` place durable agreed context once and link to it as needed.

   ```markdown
   ## Commits
   - Conventional Commit headers: `type(scope): summary`; use `feat`, `fix`, `perf`, `chore` or `docs`. Breaking markers only for actual breaking changes.
   ```

6. Keep undecided stack/architecture and unverified commands explicit, not invented. Stay within documentation-only authorization. Report files changed, checks actually performed, and remaining unknowns using `agent-docs`' output format.
