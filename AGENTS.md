# Agent Assets
Versioned coding-agent assets used selectively across projects.

## Stack
- Markdown for skills/prompts/docs.
- TypeScript for Pi extensions and OpenCode plugins.
- Node.js built-in test runner for contract tests.

## Build & Test
- Tests: `node --test tests/pi-extensions/backlog-handoff/contract.test.mjs tests/opencode-plugins/backlog-handoff/contract.test.mjs`
- Lint: none configured.
- Build: none configured; Pi/OpenCode load extension/plugin source directly.

## Repo Rules
- `skills/` = versioned source skills for distribution; keep them when local installations change.
- Skills are installed globally; do not track local `.agents/skills/` copies.
- `prompts/` = tracked Pi prompt templates.
- `pi-extensions/` = Pi extension source plus examples.
- `opencode-plugins/` = OpenCode plugin source plus docs.

## Docs
- Docs map: [`.agents/docs/README.md`](.agents/docs/README.md)
- ADRs: [`.agents/docs/decisions/README.md`](.agents/docs/decisions/README.md) (ADR tools: use `.agents/docs/decisions/` as dir)
