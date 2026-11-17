---
description: Update agent context docs from this session
---

Reconcile @AGENTS.md and files under @.agents/docs/ with durable results and decisions from this session. Maintain a concise operating manual, not an accumulating session log.

Follow installed skills where applicable:
- use agent-docs for broader agent-doc maintenance
- use writing-agents-md for AGENTS.md-specific changes

Rules:
- Read existing guidance before editing. For each affected topic, replace outdated guidance rather than appending another version.
- Explicitly review affected docs for pruning: remove obsolete instructions, resolved temporary workarounds, duplicated guidance, and details that no longer help future agents. Consolidate overlapping sections; delete pages with no remaining useful content.
- Preserve still-valid constraints and rationale. Verify suspected stale guidance against current code or session decisions; if uncertain, flag it rather than deleting it. Preserve historical ADRs; mark superseded decisions through the repo's ADR lifecycle instead of erasing them.
- Add only durable, repo-specific knowledge not already covered. If nothing warrants a change, leave docs unchanged; do not force additions or deletions.
- Keep @AGENTS.md concise; include only universal repo entrypoint info.
- Put task-specific or durable agent-facing docs under @.agents/docs/.
- Put ADR-worthy decisions in the repo ADR location when present, especially @.agents/docs/decisions/.
- Do not copy transient TODOs, scratch notes, generated dumps, or secrets into docs.
- Update docs map, ADR index, and other inbound links when files move or are deleted; verify links in touched docs.
- Briefly report what was added, replaced, consolidated, or removed, and any uncertain stale guidance left for review.
