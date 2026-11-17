# Python foundation reference

Read only for a Python repository. Adapt to existing tools and the approved plan; these are patterns, not files to copy blindly. Resolve current supported releases when applying the skill, then record exact versions in the lockfile and pinned hook/CI references.

## Minimal tooling

For a new Python project, propose uv, pytest and Ruff. Preserve an existing working equivalent. Consider pre-commit, Gitleaks, Bandit and pip-audit only with approval; explain prerequisites, including Go when building the Gitleaks pre-commit hook.

- Put the agreed Python compatibility range in `project.requires-python`. Ruff can infer its target from it; do not repeat it in Ruff configuration by default.
- `.python-version` selects an interpreter for tools such as uv; it does not declare compatibility or lock dependencies. Omit it unless explicit interpreter selection is useful or required. A minor selector allows patch updates; an exact version intentionally does not.
- Put development tools in a dependency group; commit `uv.lock`. A tooling-only repository can use `[tool.uv] package = false`; do not invent an application package/versioning scheme to install checks.
- Leave Ruff and pytest configuration absent initially. Pytest discovers `test_*.py` and `*_test.py` without a `testpaths` setting. Configure only when discovery or another concrete need warrants it.
- Do not turn on extra security lint rules and then globally exempt tests by default. Bandit is a separate check if approved; handle intentional test constructs with narrow, explained exceptions when necessary.

## Commands after tools are configured

```sh
uv sync --locked
uv run --locked ruff format --check .
uv run --locked ruff check .
uv run --locked pytest
```

Run pytest as a required gate only once real tests exist. Exit code 5 means no tests were collected, not success. Documentation-link tests can be useful in a documentation-heavy repository, but are not engine/application acceptance coverage.

For approved hooks:

```sh
uv run --locked pre-commit install
uv run --locked pre-commit install-hooks
uv run --locked pre-commit run --all-files
```

These commands do not define what a scanner examines: inspect each hook's actual entrypoint. Ruff hooks can use local `uv run --locked` entrypoints to share locked versions with CI; let commit-time formatting modify files, but run format-check mode in CI.

For approved security checks:

```sh
uv run --locked bandit -r . -x ./.venv,./.git
```

Adapt excluded environment/generated paths to the repo; do not silently exclude application code. For pip-audit, export the full locked dependency closure with hashes to a temporary file outside the repository:

```sh
uv export --locked --all-groups --no-emit-project --format requirements-txt --output-file "$requirements"
uv run --locked pip-audit --requirement "$requirements" --disable-pip --require-hashes
```

Create `$requirements` with the environment's temporary-file facility and clean it up even on failure. These flags avoid dependency resolution/installation during auditing. Check the selected tool version supports them; network availability and the current vulnerability database affect results. Report platform/marker coverage where relevant. Do not automatically upgrade packages to fix audit output without approval.

## Gitleaks and CI

A Gitleaks staged hook commonly uses `gitleaks git --pre-commit --staged --redact`; a separate history check uses `gitleaks git --redact`. Verify the pinned release's actual syntax. A history scan does not include pending changes. A staged scan does not validate committed history merely because pre-commit was invoked with `--all-files`.

On GitHub, fetch full history for history scanning, disable retained checkout credentials, use `contents: read`, and SHA-pin Actions. Select a supported uv setup/install version, install the agreed interpreter, then run the same locked checks as locally. Avoid duplicating tool versions in local hook installations and CI where the lockfile can supply them.

Ignore `.venv/`, Python/test/tool caches, build artifacts, coverage, local environment and credential files. Keep sanitized `.env.example`, lockfiles and shared Zed settings/tasks trackable. Scope private-data directories to the individual project rather than copying domain-specific paths as universal Python defaults.
