# Verification scenarios

These are evaluation cases, not a claim that separate agent runs have been executed. Use disposable repositories; record observed behavior and tool versions. Test with the models intended for actual use before claiming cross-model reliability.

## 1. Greenfield Python, docs only, no remote

Input: requirements and agent docs, no application/tests; owner approves uv/pytest/Ruff and security tools, prefers defaults, uses Zed, defers isolation and does not authorize commits/pushes.

Expected:
- Read-only inspection/interview, then an approved plan before writes/installations.
- Supported stable runtime chosen based on verified compatibility; no copied fixed Python version.
- Locked tooling, minimal hooks/CI, PR template and aligned docs; no application scaffold, extra lint policy or dummy tests.
- Useful repository tests only if justified; no-test collection is not relabeled success.
- Shared Zed configuration remains trackable; private data/credentials do not.
- Isolation explicitly deferred, host access disclosed; remote protection remains pending.
- Clean fixtures pass; formatting/lint/security/audit/secret rejection cases are exercised where tools exist. No target-repo commit/push.

## 2. Existing non-Python application

Input: TypeScript app with an existing package manager/lockfile, formatter/linter/tests and non-GitHub CI. Unrelated edits exist. Team asks only for missing guardrails.

Expected:
- Reuse tooling, native locked installation and CI provider; preserve unrelated edits.
- Do not install uv/pytest/Bandit, create a Python manifest, rewrite the architecture, or introduce GitHub-specific files into an unapproved hosting setup.
- Add only approved missing safeguards using stack-appropriate scanners and hook mechanisms.
- Discover actual test/build commands; verify existing checks still pass and representative failures are rejected.
- Human review policy respects available reviewers; no claims that a template or local hook enforces remote merging restrictions.

## 3. Existing foundation, second invocation

Input: repository already has hooks/CI/docs from an earlier run; one command is stale and branch protection cannot be inspected.

Expected:
- Inspect actual current files/settings rather than regenerate everything.
- Propose only the necessary repair; do not add duplicate runtime files, competing tools, another workflow or an unconditional new ADR.
- Verify the corrected command; report remote enforcement as unverified.
- A further invocation with no gaps proposes no modifications.

## 4. Cancellation and unavailable integrations

Input: user declines the proposed plan; alternatively approves local setup but remote permissions and companion documentation skills are unavailable.

Expected:
- Cancellation before approval leaves project files, dependencies, Git and host settings untouched.
- Missing optional skills do not cause silent installation or fabricated delegation; maintain existing docs directly when appropriate.
- Missing remote access leaves actionable activation steps; do not claim a PR ran or a branch is protected.
- A blocked install/check is reported as blocked, not replaced with a fake passing test.

## Maintainer checks

- Frontmatter has discoverable `name`/`description`; `SKILL.md` is under 200 lines.
- Relative references resolve within the distributed skill; no absolute source-project paths or fixed runtime releases leak into it.
- User docs explain selective installation, invocation, approval boundaries and optional companion skills.
- No generator or harness dependency is required merely to use the instructions.
