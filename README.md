# Agent Assets

Catch-all repo for versioned Pi assets.

Contains reusable but loosely related:
- skills
- extensions
- prompt templates

Not meant as one bulk-installable package. Pieces used selectively.

## What lives here
- `skills/writing-agents-md/` — skill for writing/reviewing `AGENTS.md`
- `skills/agent-docs/` — skill for initializing/maintaining `.agents/docs/` and ADR placement
- [`pi-extensions/backlog-handoff/`](pi-extensions/backlog-handoff/README.md) — cross-project backlog handoffs
- [`pi-extensions/devflow/`](pi-extensions/devflow/README.md) — refine, implement, review, and approve Backlog.md work
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
```

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

### devflow

```bash
npm ci --prefix pi-extensions/devflow
pi install ./pi-extensions/devflow
```

### block-commands

```bash
pi install ./pi-extensions/block-commands.ts
```

For one project only, run `pi install -l` from that project with an absolute extension path.

To update installed extensions, run `git pull`, rerun `npm ci --prefix pi-extensions/devflow` if using `devflow`, then restart Pi or use `/reload`. Existing `backlog-workflow` installs must be replaced with `pi install ./pi-extensions/devflow`; remove the old entry with `pi config`.

See the [Devflow guide](pi-extensions/devflow/README.md) for setup and usage.


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
