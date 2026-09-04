# Agent Assets
Versioned coding-agent assets used selectively across projects.

## Stack
- Markdown for skills/prompts/docs.
- TypeScript for Pi extensions and OpenCode plugins.
- Node.js built-in test runner for contract tests.

## Build & Test
- Tests: `node --test tests/pi-extensions/*/contract.test.mjs`; install package-local dependencies first where required (see package docs).
- Lint: none configured.
- Build: none configured; Pi/OpenCode load extension/plugin source directly.

## Repo Rules
- Keep versioned source skills; do not track local `.agents/skills/` copies.

## Docs
- Docs map: [`.agents/docs/README.md`](.agents/docs/README.md)
- ADRs: [`.agents/docs/decisions/README.md`](.agents/docs/decisions/README.md) (ADR tools: use `.agents/docs/decisions/` as dir)
