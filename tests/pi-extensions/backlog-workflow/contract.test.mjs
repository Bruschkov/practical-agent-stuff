import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { access, mkdtemp, rm } from "node:fs/promises";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const packageRoot = path.join(repoRoot, "pi-extensions", "backlog-workflow");
const backlog = path.join(packageRoot, "node_modules", ".bin", "backlog");
const run = promisify(execFile);

async function cli(cwd, ...args) {
	return (await run(backlog, args, { cwd, maxBuffer: 1024 * 1024 })).stdout;
}

function createdId(output, kind) {
	const match = output.match(new RegExp(`Created ${kind} (\\S+)`));
	assert.ok(match, `Could not find ${kind} ID in: ${output}`);
	return match[1];
}

test("backlog-workflow is a Pi package with its Backlog.md dependency", async () => {
	const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
	assert.deepEqual(manifest.pi.extensions, ["./index.ts"]);
	assert.equal(manifest.dependencies["backlog.md"], "^1.4.0");

	const extension = await import(`${pathToFileURL(path.join(packageRoot, "index.ts")).href}?t=${Date.now()}`);
	assert.equal(typeof extension.default, "function");
	assert.doesNotThrow(() => extension.default({}));
});

test("package-local Backlog.md CLI supports the workflow contract", async (t) => {
	assert.ok(existsSync(backlog), "Run npm install in pi-extensions/backlog-workflow first.");
	const project = await mkdtemp(path.join(os.tmpdir(), "backlog-workflow-"));
	t.after(() => rm(project, { recursive: true, force: true }));

	await run("git", ["init", "--quiet"], { cwd: project });
	await cli(project, "init", "CLI contract", "--defaults", "--integration-mode", "none");
	await access(path.join(project, "backlog", "config.yml"));
	assert.equal((await cli(project, "config", "get", "projectName")).trim(), "CLI contract");

	const parentId = createdId(await cli(project, "task", "create", "Parent", "--type", "feature", "--priority", "High"), "task");
	const childId = createdId(
		await cli(project, "task", "create", "Child", "--parent", parentId, "--depends-on", parentId),
		"task",
	);
	await cli(project, "task", "edit", childId, "--title", "Child updated", "--assignee", "@bob", "--comment", "Needs review", "--comment-author", "@carol");

	const view = JSON.parse(await cli(project, "task", "view", childId, "--json"));
	assert.equal(view.schemaVersion, 1);
	assert.equal(view.kind, "task-view");
	assert.equal(view.task.title, "Child updated");
	assert.equal(view.task.parentTaskId, parentId);
	assert.deepEqual(view.task.dependencies, [parentId]);
	assert.deepEqual(view.task.assignees, ["@bob"]);
	assert.deepEqual(view.task.comments.map(({ body, author }) => ({ body, author })), [{ body: "Needs review", author: "@carol" }]);

	const tasks = JSON.parse(await cli(project, "task", "list", "--json"));
	assert.deepEqual(JSON.parse(await cli(project, "task", "list", "--json")), tasks);
	assert.equal(tasks.kind, "task-list");
	assert.deepEqual(tasks.tasks.map(({ id }) => id), [parentId, childId]);

	const draftId = createdId(await cli(project, "draft", "create", "Idea", "--description", "original"), "draft");
	await cli(project, "draft", "edit", draftId, "--title", "Idea updated", "--assignee", "@dana");
	assert.match(await cli(project, "draft", "view", draftId, "--plain"), /Idea updated/);
	await cli(project, "draft", "archive", draftId);
	await cli(project, "task", "archive", childId);
});
