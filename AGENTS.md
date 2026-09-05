# Agent Assets
Versioned coding-agent assets used selectively across projects.

## Stack
- Markdown for skills/prompts/docs.
- TypeScript for Pi extensions.
- Node.js built-in test runner for contract tests; Pi extensions target `@earendil-works/pi-coding-agent`.

## Build & Test
- Tests: `node --test tests/pi-extensions/*/contract.test.mjs`.
- Lint: none configured.
- Build: none configured; Pi loads extension source directly.

## Repo Rules
- Keep versioned source skills; do not track local `.agents/skills/` copies.
- Read the relevant `.agents/docs/` page before changing an extension or its contract tests.
- Keep optional integrations non-blocking; do not add hard dependencies solely for them.
- Prioritize end-user documentation; keep maintainer-only workflow detail in `.agents/docs/`.

## Docs
- Docs map: [`.agents/docs/README.md`](.agents/docs/README.md)
- Devflow maintainer guide: [`.agents/docs/devflow.md`](.agents/docs/devflow.md)
- ADRs: [`.agents/docs/decisions/README.md`](.agents/docs/decisions/README.md) (ADR tools: use `.agents/docs/decisions/` as dir)
