# Agent Assets

Catch-all repo for versioned Pi assets.

Contains reusable but loosely related:
- skills
- extensions
- prompt templates

Not meant as one bulk-installable package. Pieces used selectively.

## Planning
- [New workflow roadmap](WORKFLOW-ROADMAP.md) — manually invoked refinement, implementation, and review skills; design only.

## What lives here
- `skills/writing-agents-md/` — skill for writing/reviewing `AGENTS.md`
- `skills/agent-docs/` — skill for initializing/maintaining `.agents/docs/` and ADR placement
- [`skills/project-init/`](skills/project-init/SKILL.md) — inspect and clarify project intent before confirmed documentation initialization through installed `agent-docs`
- [`skills/engineering-ready/`](skills/engineering-ready/SKILL.md) — establish a minimal, stack-aware engineering foundation: tooling, hooks, CI, PR guidance and aligned docs
- [`pi-extensions/backlog-handoff/`](pi-extensions/backlog-handoff/README.md) — cross-project backlog handoffs
- `pi-extensions/block-commands.ts` — block configured shell commands
- `prompts/` — prompt templates tracked in git

## Skill installation
The `skills` CLI scans the repo for directories containing `SKILL.md`. `--skill` selects by frontmatter `name`, not by path.

List available skills:

```bash
npx skills add Bruschkov/practical-agent-stuff --list
```

Install all skills:

```bash
npx skills add Bruschkov/practical-agent-stuff
```

Install one skill:

```bash
npx skills add Bruschkov/practical-agent-stuff --skill "agent-docs"
npx skills add Bruschkov/practical-agent-stuff --skill "writing-agents-md"
npx skills add Bruschkov/practical-agent-stuff --skill "project-init"
npx skills add Bruschkov/practical-agent-stuff --skill "engineering-ready"
```

For `project-init`, also install `agent-docs` using the command above. In the target project, invoke `/skill:project-init` (restart Pi or use `/reload` after installation). It inspects existing files, interviews in small rounds, and waits for confirmation before loading `agent-docs` and following its `init` workflow. Existing and greenfield projects are supported; no application scaffolding or installation is performed. Cancellation before confirmation leaves the project unchanged. If `agent-docs` is missing, it stops and explains the prerequisite.

For `engineering-ready`, invoke `/skill:engineering-ready` in the target project after installation (restart Pi or use `/reload`). It inspects the stack, interviews about missing decisions, and asks for plan approval before modifying files or installing tools. It preserves existing tools and defaults, adds only approved safeguards, and verifies both passing checks and representative failures. Application scaffolding, deployment, commits/pushes and remote settings are not implicitly authorized. Installed `agent-docs` and `adr-skill` are optional integrations, not prerequisites. A [Python reference](skills/engineering-ready/references/python.md) and [verification scenarios](skills/engineering-ready/references/verification.md) accompany the stack-aware workflow. No global installation or real GitHub activation is performed by adding the skill to this repository; publish/push before using the remote install command for this new skill.

After repo path changes, reinstall affected skills if old lock entries point at removed paths.

## Pi extension installation

Check out the asset repository once:

```bash
git clone https://github.com/Bruschkov/practical-agent-stuff.git ~/src/practical-agent-stuff
cd ~/src/practical-agent-stuff
```

Install any extension globally:

### backlog-handoff

```bash
pi install ./pi-extensions/backlog-handoff/index.ts
```

### block-commands

```bash
pi install ./pi-extensions/block-commands.ts
```

For one project only, run `pi install -l` from that project with an absolute extension path.

To update installed extensions, run `git pull`, then restart Pi or use `/reload`.

### Retired devflow experiment

Devflow (formerly `backlog-workflow`) is no longer shipped or supported. Before updating an existing installation, stop active runs and remove its package/extension entry or symlink from your user/project Pi configuration. Keep project backlog data, drafts, handoffs, branches, and PRs. Restart Pi afterward. No replacement workflow is implemented yet; see the [roadmap](WORKFLOW-ROADMAP.md).

Historical source and tests are available at commit `7592e4e2240a155e7601bec4e1faa3a528065796`.


## Prompt workflow
Prompt templates in `prompts/` are source of truth.

They can be symlinked into `~/.pi/agent/prompts/` so Pi loads them from normal global location while files stay version-controlled here.

Current tracked prompts:
- `backlog-from-handoff.md`
- `backlog-from-requirement.md`
- `backlog-start-task.md`

## Usage model
Use this repo as curated storage for Pi-related tooling.

- reusable prompt/skill/extension worth versioning → put here
- personal scratch or temporary local prompt → keep out
- project-specific prompt → keep in that project
