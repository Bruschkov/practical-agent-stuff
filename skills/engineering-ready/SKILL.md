---
name: engineering-ready
description: Establishes a minimal, stack-aware engineering foundation with approved tooling, Git hooks, CI, PR guidance and aligned agent docs. Use when making a new or existing project engineering-ready, adding development guardrails, or preparing a repository for agent-assisted development without building the application.
---

# Engineering Ready

Make the development process executable, not just documented. Adapt to the repository; do not copy a fixed Python/GitHub starter kit into every project.

## Boundaries

- Engineering foundation only: no application scaffolding, product features, speculative modules, deployment, or unrequested infrastructure.
- Inspect and interview read-only before approval. Do not install tools, write files, initialize Git, or change remote settings during discovery.
- Preserve unrelated edits, existing conventions and working checks. Do not replace a stack, package manager, CI provider or lockfile merely to match this skill.
- Do not commit, push, create remotes, install globally, alter host permissions or configure protected branches without explicit authorization for those actions. Never merge a PR.
- Instructions, hooks, ignore rules and PR templates are not access controls. Distinguish proposed, configured, locally verified and remotely enforced safeguards.

## 1. Inspect

Read applicable `AGENTS.md`, README, agent docs and relevant ADRs. Inspect Git status/branch/remotes, source layout, manifests, runtime declarations, lockfiles, tests, hooks, CI and ignore rules. Avoid reading credentials or private data.

Summarize with file paths:
- Actual stack and commands versus aspirational documentation.
- Existing safeguards, missing checks and contradictions.
- Changes needed across configuration, tests, docs and callers; what must remain untouched.

Include a recommended-improvements tier list in this initial scan, before the approval plan:

| Tier | Work | Effort |
| --- | --- | --- |
| A | Highest-priority gaps: address first for this repository. | Rough hands-on range. |
| B | Valuable improvements after A. | Rough hands-on range. |
| C | Lower-priority or higher-cost improvements that can wait. | Rough hands-on range. |

- Replace the illustrative rows with concrete, repository-specific work; omit empty tiers. If no improvements are justified, say so rather than inventing work.
- Rank by risk reduction and practical value, considering dependencies and effort; briefly explain priorities with file evidence in the work description or surrounding summary. Do not assign fixed tiers to tools or practices regardless of context.
- Estimate implementation and verification in minutes/hours as ranges, not promises. State material assumptions or unknowns; separate setup effort from open-ended remediation (for example, `1–2 h; findings extra`) and external waiting time.
- Keep recommendations within the skill's boundaries. The tier list is not authorization to implement; use it to agree scope in the next step.

If project intent is unclear, resolve it first; use an installed `project-init` skill if useful. Do not infer product architecture from a tooling request.

## 2. Interview and approve

Reuse established answers. Ask at most three focused questions per round, only about unresolved decisions:
- Scope: foundation only, existing-code integration, or a separately approved application slice?
- Runtime/tooling: retain current choices; for a new stack, propose a supported stable release and minimal native tools. Verify compatibility rather than assuming newest always works or selecting an old minimum without reason.
- Git/hosting: provider, default branch, task branches, PRs, reviewer availability, who may commit/push/merge, and which remote actions are authorized?
- Human checkpoints: plans, scope changes, architecture/dependencies, destructive operations and deployment; autonomy within approved work?
- Data/security: authorized fixtures/providers, credentials, isolation/permissions, and consciously deferred safeguards?
- Environment: editor, supported developer OS, CI runner and local hook prerequisites?

Present one concise plan: affected files, dependencies and rationale, checks at each lifecycle stage, human gates, non-goals, verification and pending external setup. Get explicit approval before modifying files. If inspection already answers everything, confirm the plan without repeating the interview. Cancellation leaves the project unchanged.

## 3. Build the smallest approved foundation

### Tooling and structure

- Reuse native tooling and existing dependencies first. Approve additions; lock versions using the stack's normal mechanism and verify locked installation.
- Start with formatter/linter/test-runner defaults. Add configuration only for a demonstrated project requirement; do not preselect large rule sets and compensating exemptions.
- Avoid duplicate runtime declarations unless selection, deployment or another actual tool requires them. Explain compatibility ranges versus interpreter selection and exact pins.
- Keep existing application boundaries; document intended responsibilities if useful, without creating empty future directories or prescribing unapproved frameworks/databases.
- Add narrow ignore rules for actual caches, build/coverage output, local environment/credentials, OS metadata and agreed private-data directories. Keep lockfiles, sanitized examples and useful shared editor configuration trackable; do not blanket-ignore `.zed/` or every database/log file without a reason.

### Lifecycle checks

| Stage | Establish |
| --- | --- |
| Before implementation | Goal, boundaries, concrete acceptance cases, relevant context and human-approved plan. |
| During development | Task branch, focused real tests, small steps, affected docs updated with the change. |
| At commit | Fast formatting/lint and staged-secret checks; document installation and restaging after formatter changes. |
| At PR | Independent CI: locked install, format check, lint, real tests and approved secret/dependency/code security scans. |
| Before merge | Required green checks and human review/merge, enforced remotely only where configured and verified. |
| At milestone/handoff | Runnable demonstration when software exists; durable decisions, results, limits and next steps in the repo. |
| Before deployment | Separate approval and release design; no deployment pipeline added by default. |

- Do not create dummy tests or suppress "no tests collected" to manufacture a green test gate. Use existing real tests; add useful repository checks only where justified. Otherwise state application tests are absent and require a real test gate with the first application slice.
- Pick security tools suited to the stack and threat surface; do not install Python scanners in a non-Python repo. Include development dependencies where supported and disclose coverage limits.
- Ensure staged-secret checks cover the initial commit and history scanners actually see history in CI. Do not assume `--all-files` changes a staged-only scanner into a history/worktree scanner. Explain what untracked/unstaged files have not passed.
- Use minimal CI permissions, immutable action/plugin references where supported, and no production credentials. Never run untrusted PR code with privileged events/tokens. Do not bypass failures or blanket-ignore security findings.
- Reuse the host's PR template convention. On GitHub use `.github/pull_request_template.md`; automatic prefilling starts once it reaches the default branch. Include goal/approved scope, changes, exact verification, risks and human approvals.

For an approved Python foundation, read [the Python reference](references/python.md); it is an example, not a compulsory preset.

## 4. Align durable documentation

Use installed `agent-docs` for documentation placement/maintenance and `adr-skill` for architectural decisions when available; load their instructions rather than copying their workflows. Follow existing ADR conventions and approval gates. Never silently install companion skills. If absent, maintain the repository's current docs directly; for a new layout use root `AGENTS.md` plus `.agents/docs/`.

Keep root instructions short: purpose, actual stack/commands, universal gates and links. Put lifecycle, setup, security limits and task-specific architecture guidance in focused pages. Update user-facing setup instructions and stale references in requirements. Keep one authoritative location for each rule; preserve old decision rationale.

Record agreed decisions and reasons, including deferred isolation or deployment. Do not claim a sandbox, allow-list, secret barrier or protected branch exists because a document says so. If isolation is deferred, disclose retained host access and agree when to revisit it.

## 5. Verify, then report

Run actual locked installation, checks and hook setup where authorized. Keep local/CI commands aligned. Test representative failures in disposable directories/repos: unformatted/lint-invalid code, a broken real invariant, a known-vulnerable dependency without installing it, and recognizable synthetic secrets. Never use live credentials or commit fixtures into the target repository. Verify clean fixtures pass and remove temporary artifacts.

Verify tracked-versus-ignored examples and changed relative links. Inspect CI events, credential exposure, permissions and pinned references. Re-run checks after fixes; do not hide failures or claim local YAML inspection proves hosted CI works.

For remote activation, only when authorized:
- Run a real PR to register check names; require the actual reported contexts and verify failure blocks merge.
- Configure protected default branches, required PRs/checks and appropriate bypass/merge restrictions. Report hosting-plan limitations.
- Require independent approval when another reviewer exists; a solo author cannot approve their own PR. Record human manual merge and credential boundaries honestly.
- If remote/credentials/permissions are missing, leave explicit activation steps rather than claiming completion.

Report concisely:
- Changed paths and the development gates established.
- Exact checks/results and rejection cases actually exercised.
- Pending remote settings, absent product coverage and deferred safeguards.
- Anything not committed, pushed, installed or verified.

Use [verification scenarios](references/verification.md) to review the skill on representative repositories; do not label a checklist walkthrough as an executed agent evaluation.
