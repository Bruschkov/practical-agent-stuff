# Agent Assets
Versioned coding-agent assets used selectively across projects.

## Stack
- Markdown for skills/prompts/docs.
- TypeScript for Pi extensions and OpenCode plugins.
- Node.js built-in test runner for contract tests.

## Build & Test
- Tests: `node --test tests/pi-extensions/*/contract.test.mjs`.
- Backlog workflow: `npm ci --prefix pi-extensions/backlog-workflow && node --test tests/pi-extensions/backlog-workflow/contract.test.mjs`.
- Lint: none configured.
- Build: none configured; Pi/OpenCode load extension/plugin source directly.

## Repo Rules
- Keep versioned source skills; do not track local `.agents/skills/` copies.
- Read the relevant `.agents/docs/` page before changing an extension.
- Keep optional integrations non-blocking; do not add hard dependencies solely for them.
- Keep child-Pi extension discovery enabled unless isolation is explicitly required.

## Docs
- Docs map: [`.agents/docs/README.md`](.agents/docs/README.md)
- Backlog workflow, feature run-to-exhaustion, `/implement-run`, `/workflow-inbox`, review/rework/HITL protocol, child-Pi runner: [`.agents/docs/backlog-workflow.md`](.agents/docs/backlog-workflow.md)
- ADRs: [`.agents/docs/decisions/README.md`](.agents/docs/decisions/README.md) (ADR tools: use `.agents/docs/decisions/` as dir)
