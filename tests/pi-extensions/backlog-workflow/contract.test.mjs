import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { access, mkdir, mkdtemp, realpath, rm, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
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

async function workflowHarness() {
	const commands = new Map();
	const messages = [];
	const extension = await import(`${pathToFileURL(path.join(packageRoot, "index.ts")).href}?t=${Date.now()}`);
	extension.default({
		registerCommand(name, definition) {
			commands.set(name, definition);
		},
		registerTool() {},
		sendUserMessage(message) {
			messages.push(message);
		},
		async exec(command, args, options = {}) {
			try {
				const result = await run(command, args, { cwd: options.cwd, maxBuffer: 1024 * 1024 });
				return { ...result, code: 0, killed: false };
			} catch (error) {
				return { stdout: error.stdout ?? "", stderr: error.stderr ?? "", code: error.code ?? 1, killed: false };
			}
		},
	});
	return { commands, messages };
}

async function workflowToolHarness(exec = async (command, args, options = {}) => {
	try {
		const result = await run(command, args, { cwd: options.cwd, maxBuffer: 1024 * 1024 });
		return { ...result, code: 0, killed: false };
	} catch (error) {
		return { stdout: error.stdout ?? "", stderr: error.stderr ?? "", code: error.code ?? 1, killed: false };
	}
}) {
	const tools = await registeredTools(exec);
	return tools.get("backlog");
}

async function registeredTools(exec = async () => ({ stdout: "", stderr: "", code: 0, killed: false }), worker = false) {
	const tools = new Map();
	const previous = process.env.PI_BACKLOG_WORKFLOW_WORKER;
	if (worker) process.env.PI_BACKLOG_WORKFLOW_WORKER = "1";
	else delete process.env.PI_BACKLOG_WORKFLOW_WORKER;
	try {
		const extension = await import(`${pathToFileURL(path.join(packageRoot, "index.ts")).href}?t=${Date.now()}`);
		extension.default({
			registerCommand() {},
			registerTool(definition) {
				tools.set(definition.name, definition);
			},
			exec,
		});
	} finally {
		if (previous === undefined) delete process.env.PI_BACKLOG_WORKFLOW_WORKER;
		else process.env.PI_BACKLOG_WORKFLOW_WORKER = previous;
	}
	return tools;
}

function commandContext(cwd, confirm = async () => true) {
	const notifications = [];
	return {
		notifications,
		ctx: {
			hasUI: true,
			cwd,
			ui: {
				confirm,
				notify(message, level) {
					notifications.push({ message, level });
				},
			},
		},
	};
}

test("backlog-workflow is a Pi package with its Backlog.md dependency", async () => {
	const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
	assert.deepEqual(manifest.pi.extensions, ["./index.ts"]);
	assert.equal(manifest.dependencies["backlog.md"], "^1.4.0");

	const extension = await import(`${pathToFileURL(path.join(packageRoot, "index.ts")).href}?t=${Date.now()}`);
	assert.equal(typeof extension.default, "function");
	assert.doesNotThrow(() => extension.default({ registerCommand() {}, registerTool() {} }));
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

test("complete_transition is worker-only, validates outcomes, and terminates", async () => {
	assert.equal((await registeredTools()).has("complete_transition"), false);
	const tool = (await registeredTools(undefined, true)).get("complete_transition");
	assert.ok(tool);
	assert.deepEqual(tool.parameters.properties.outcome.enum, ["completed", "needs_human", "blocked", "failed"]);
	const result = await tool.execute("complete", { outcome: "completed" });
	assert.deepEqual(result.details, { outcome: "completed" });
	assert.equal(result.terminate, true);
});

test("implementer prompt requires ticket evidence and a terminating outcome", async () => {
	const { implementerPrompt } = await import(`${pathToFileURL(path.join(packageRoot, "worker-runner.ts")).href}?t=${Date.now()}`);
	const prompt = implementerPrompt("TASK-42");
	assert.match(prompt, /task_view/);
	assert.match(prompt, /project instructions/);
	assert.match(prompt, /Implement only the ticket's acceptance criteria/);
	assert.match(prompt, /required checks/);
	assert.match(prompt, /documentation and durable-decision impact/);
	assert.match(prompt, /\"modifiedFiles\"/);
	assert.match(prompt, /complete_transition exactly once as your final action/);
	assert.match(prompt, /TASK-42/);
});

test("child Pi runner inherits project context and reports bounded, malformed, and cancelled runs", async (t) => {
	const project = await mkdtemp(path.join(os.tmpdir(), "backlog-workflow-worker-"));
	const fakePi = path.join(project, "fake-pi.mjs");
	t.after(() => rm(project, { recursive: true, force: true }));
	await writeFile(fakePi, [
		'import { writeFileSync } from "node:fs";',
		'import path from "node:path";',
		'const prompt = process.argv.at(-1);',
		'writeFileSync(path.join(process.cwd(), "worker-invocation.json"), JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), worker: process.env.PI_BACKLOG_WORKFLOW_WORKER }));',
		'if (prompt === "wait") setInterval(() => {}, 1_000);',
		'else {',
		'  const output = prompt === "large" ? "line\\n".repeat(2_100) : "implemented";',
		'  console.log(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: output }], usage: { input: 2, output: 3, cacheRead: 4, cacheWrite: 5, totalTokens: 14, cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 } } } }));',
		'  if (prompt !== "missing") console.log(JSON.stringify({ type: "message_end", message: { role: "toolResult", toolName: "complete_transition", details: { outcome: "completed" }, isError: false, content: [] } }));',
		'}',
	].join("\n"));
	const previousScript = process.argv[1];
	process.argv[1] = fakePi;
	t.after(() => { process.argv[1] = previousScript; });
	const { runChildPi } = await import(`${pathToFileURL(path.join(packageRoot, "worker-runner.ts")).href}?t=${Date.now()}`);

	const completed = await runChildPi({ cwd: project, prompt: "large", model: { provider: "test", id: "model" }, thinkingLevel: "high" });
	assert.equal(completed.outcome, "completed");
	assert.equal(completed.failure, undefined);
	assert.match(completed.output, /Output truncated/);
	assert.deepEqual(completed.usage, { input: 2, output: 3, cacheRead: 4, cacheWrite: 5, totalTokens: 14, cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 } });
	assert.deepEqual(JSON.parse(await readFile(path.join(project, "worker-invocation.json"), "utf8")), {
		args: ["--mode", "json", "-p", "--no-session", "--extension", path.join(packageRoot, "index.ts"), "--model", "test/model", "--thinking", "high", "--", "large"],
		cwd: await realpath(project),
		worker: "1",
	});

	const malformed = await runChildPi({ cwd: project, prompt: "missing" });
	assert.match(malformed.failure, /without complete_transition/);
	const controller = new AbortController();
	setTimeout(() => controller.abort(), 20);
	const cancelled = await runChildPi({ cwd: project, prompt: "wait" }, controller.signal);
	assert.equal(cancelled.cancelled, true);
	assert.equal(cancelled.failure, "Worker cancelled.");
});

test("backlog tool uses structured operations, bounded output, and serialized writes", async (t) => {
	assert.ok(existsSync(backlog), "Run npm install in pi-extensions/backlog-workflow first.");
	const project = await mkdtemp(path.join(os.tmpdir(), "backlog-workflow-tool-"));
	t.after(() => rm(project, { recursive: true, force: true }));
	await run("git", ["init", "--quiet"], { cwd: project });
	await cli(project, "init", "Tool contract", "--defaults", "--integration-mode", "none");

	const tool = await workflowToolHarness();
	assert.ok(tool, "Extension did not register backlog tool");
	const ctx = { cwd: project };
	const created = await tool.execute("create", {
		operation: "task_create", title: "Created through tool", type: "feature", acceptanceCriteria: ["Tool creates the ticket"],
	}, undefined, undefined, ctx);
	const id = createdId(created.content[0].text, "task");
	const view = await tool.execute("view", { operation: "task_view", id }, undefined, undefined, ctx);
	assert.equal(JSON.parse(view.content[0].text).task.title, "Created through tool");
	const listed = await tool.execute("list", { operation: "task_list", limit: 1 }, undefined, undefined, ctx);
	assert.equal(JSON.parse(listed.content[0].text).tasks.length, 1);
	await assert.rejects(() => tool.execute("edit", { operation: "task_edit", id }, undefined, undefined, ctx), /edit requires/);

	let running = 0;
	let maxRunning = 0;
	const serialized = await workflowToolHarness(async (command, args) => {
		if (command === "git") return { stdout: project, stderr: "", code: 0 };
		running += 1;
		maxRunning = Math.max(maxRunning, running);
		await new Promise((resolve) => setTimeout(resolve, 10));
		running -= 1;
		return { stdout: "line\n".repeat(2_100), stderr: "", code: 0 };
	});
	await Promise.all([
		serialized.execute("one", { operation: "task_create", title: "One" }, undefined, undefined, ctx),
		serialized.execute("two", { operation: "task_create", title: "Two" }, undefined, undefined, ctx),
	]);
	assert.equal(maxRunning, 1);
	const truncated = await serialized.execute("list", { operation: "task_list" }, undefined, undefined, ctx);
	assert.match(truncated.content[0].text, /Output truncated/);
});

test("implement-run handles fake-Pi success, malformed evidence, and blocked-task refusal", async (t) => {
	assert.ok(existsSync(backlog), "Run npm install in pi-extensions/backlog-workflow first.");
	const project = await mkdtemp(path.join(os.tmpdir(), "backlog-workflow-implement-"));
	const fakePi = path.join(project, "fake-pi.mjs");
	const invocations = path.join(project, "worker-invocations");
	t.after(() => rm(project, { recursive: true, force: true }));
	await run("git", ["init", "--quiet"], { cwd: project });
	await cli(project, "init", "Implement contract", "--defaults", "--integration-mode", "none");
	await writeFile(fakePi, [
		'import { existsSync, readFileSync, writeFileSync } from "node:fs";',
		`const invocations = ${JSON.stringify(invocations)};`,
		'const call = existsSync(invocations) ? Number(readFileSync(invocations, "utf8")) : 0;',
		'writeFileSync(invocations, String(call + 1));',
		'const evidence = { summary: "Implemented", plan: ["Change code"], modifiedFiles: ["index.ts"], acceptanceCriteria: [{ criterion: "Works", status: "met", evidence: "Checked" }], checks: [{ command: "node --test", status: "passed", evidence: "ok" }], documentation: { impact: "none", evidence: "No docs" }, blockers: [] };',
		'console.log(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: call ? "malformed" : JSON.stringify(evidence) }], usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } }));',
		'console.log(JSON.stringify({ type: "message_end", message: { role: "toolResult", toolName: "complete_transition", details: { outcome: "completed" }, isError: false, content: [] } }));',
	].join("\n"));
	const previousScript = process.argv[1];
	process.argv[1] = fakePi;
	t.after(() => { process.argv[1] = previousScript; });

	const { commands } = await workflowHarness();
	await commands.get("workflow-init").handler("", commandContext(project).ctx);
	const command = commands.get("implement-run");
	const taskId = createdId(await cli(project, "task", "create", "Implement", "--type", "task", "--priority", "Medium", "--ac", "Works"), "task");
	await command.handler(taskId, commandContext(project).ctx);
	const task = JSON.parse(await cli(project, "task", "view", taskId, "--json")).task;
	assert.equal(task.status, "In Review");
	assert.equal(task.implementationPlan, "- Change code");
	assert.match(task.implementationNotes, /Works/);
	assert.match(task.implementationNotes, /node --test/);
	assert.deepEqual(task.modifiedFiles, ["index.ts"]);
	assert.equal(task.acceptanceCriteriaCompleted, 1);
	assert.equal(task.finalSummary, "Implemented");

	const malformedId = createdId(await cli(project, "task", "create", "Malformed", "--type", "task", "--priority", "Medium", "--ac", "Works"), "task");
	const malformedRun = commandContext(project);
	await command.handler(malformedId, malformedRun.ctx);
	const malformed = JSON.parse(await cli(project, "task", "view", malformedId, "--json")).task;
	assert.equal(malformed.status, "Open");
	assert.match(malformed.comments.at(-1).body, /required JSON evidence/);

	const blockedId = createdId(await cli(project, "task", "create", "Blocked", "--type", "task", "--priority", "Medium", "--ac", "Wait", "--depends-on", malformedId), "task");
	const blockedRun = commandContext(project);
	await command.handler(blockedId, blockedRun.ctx);
	assert.match(blockedRun.notifications.at(-1).message, /not a ready, unblocked leaf task/);
	assert.equal(JSON.parse(await cli(project, "task", "view", blockedId, "--json")).task.status, "Open");
	assert.equal(await readFile(invocations, "utf8"), "2");
});

test("refine creates or resumes a draft and continues in the main session", async (t) => {
	assert.ok(existsSync(backlog), "Run npm install in pi-extensions/backlog-workflow first.");
	const project = await mkdtemp(path.join(os.tmpdir(), "backlog-workflow-refine-"));
	t.after(() => rm(project, { recursive: true, force: true }));
	await run("git", ["init", "--quiet"], { cwd: project });
	await cli(project, "init", "Refine contract", "--defaults", "--integration-mode", "none");

	const { commands, messages } = await workflowHarness();
	const command = commands.get("refine");
	assert.ok(command, "Extension did not register refine");
	const first = commandContext(project);
	await command.handler("Make refinement durable", first.ctx);
	assert.equal(first.notifications.at(-1).level, "success");
	assert.match(await cli(project, "draft", "list", "--plain"), /DRAFT-1 - Make refinement durable/);
	const draft = await cli(project, "draft", "view", "DRAFT-1", "--plain");
	assert.match(draft, /## Accepted decisions/);
	assert.match(draft, /Approval: pending/);
	assert.match(messages.at(-1), /draft DRAFT-1/);
	assert.match(messages.at(-1), /main session/);
	assert.match(messages.at(-1), /acceptance criteria.*hierarchy.*priorities.*dependencies/is);
	assert.match(messages.at(-1), /refinement_publish/);

	const resumed = commandContext(project);
	await command.handler("DRAFT-1", resumed.ctx);
	assert.equal(resumed.notifications.at(-1).level, "success");
	assert.equal(((await cli(project, "draft", "list", "--plain")).match(/DRAFT-\d+/g) ?? []).length, 1);
});

test("refine discovers a valid handoff, preserves its format, and moves it only after publication", async (t) => {
	assert.ok(existsSync(backlog), "Run npm install in pi-extensions/backlog-workflow first.");
	const root = await mkdtemp(path.join(os.tmpdir(), "backlog-workflow-handoff-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const metaRoot = path.join(root, "meta");
	const project = path.join(metaRoot, "backend");
	const inbox = path.join(project, ".backlog-handoff", "inbox");
	const processed = path.join(project, ".backlog-handoff", "processed");
	await mkdir(inbox, { recursive: true });
	await mkdir(path.join(metaRoot, ".backlog-handoff", "projects"), { recursive: true });
	await writeFile(path.join(project, ".backlog-handoff", "config.json"), JSON.stringify({ projectId: "backend", metaRoot: ".." }));
	await writeFile(path.join(metaRoot, ".backlog-handoff", "projects", "backend.json"), JSON.stringify({ id: "backend", path: "./backend", description: "Backend" }));
	await run("git", ["init", "--quiet"], { cwd: project });
	await cli(project, "init", "Handoff contract", "--defaults", "--integration-mode", "none");
	const handoffPath = path.join(inbox, "add-retry-metadata.md");
	const handoff = [
		"---",
		'origin_project: "frontend"',
		'origin_path: "/workspace/frontend"',
		'target_project: "backend"',
		`target_path: ${JSON.stringify(project)}`,
		'created_at: "2026-09-04T00:00:00.000Z"',
		'status: "inbox"',
		"---",
		"",
		"# Add retry metadata",
		"",
		"## Why this is a handoff",
		"Backend owns retry persistence.",
		"",
		"## Requested Change",
		"Persist retry timestamps.",
		"",
		"## Acceptance Criteria",
		"- [ ] Retry timestamps are persisted.",
		"",
	].join("\n");
	await writeFile(handoffPath, handoff);

	const { commands, messages } = await workflowHarness();
	const command = commands.get("refine");
	assert.ok(command, "Extension did not register refine");
	const selected = commandContext(project);
	let choices = [];
	selected.ctx.ui.select = async (_label, options) => {
		choices = options;
		return options.find((option) => option.startsWith("Handoff:"));
	};
	await command.handler("", selected.ctx);
	assert.ok(choices.some((choice) => choice.includes("Add retry metadata")));
	assert.equal(selected.notifications.at(-1).level, "success");
	const draft = await cli(project, "draft", "view", "DRAFT-1", "--plain");
	assert.match(draft, /<!-- backlog-handoff: ".backlog-handoff\/inbox\/add-retry-metadata.md" -->/);
	assert.match(draft, /origin_project: "frontend"/);
	assert.match(draft, /## Requested Change/);
	assert.match(messages.at(-1), /preserve its metadata and original request/);
	assert.ok(existsSync(handoffPath), "Handoff must remain pending before approval");

	const tool = await workflowToolHarness();
	const published = await tool.execute("publish-handoff", {
		operation: "refinement_publish",
		id: "DRAFT-1",
		proposedTasks: [{ key: "feature", title: "Retry metadata", description: "Persist retry timestamps.", type: "feature", acceptanceCriteria: ["Retry timestamps are persisted."] }],
	}, undefined, undefined, { cwd: project, hasUI: true, ui: { confirm: async () => true } });
	assert.match(published.content[0].text, /Published and archived/);
	assert.match(published.content[0].text, /Moved handoff to/);
	assert.equal(existsSync(handoffPath), false);
	assert.equal(await readFile(path.join(processed, path.basename(handoffPath)), "utf8"), handoff);
});

test("refinement_publish requires confirmation, publishes the hierarchy, and archives its approved draft", async (t) => {
	assert.ok(existsSync(backlog), "Run npm install in pi-extensions/backlog-workflow first.");
	const project = await mkdtemp(path.join(os.tmpdir(), "backlog-workflow-publish-"));
	t.after(() => rm(project, { recursive: true, force: true }));
	await run("git", ["init", "--quiet"], { cwd: project });
	await cli(project, "init", "Publish contract", "--defaults", "--integration-mode", "none");
	const draftId = createdId(await cli(project, "draft", "create", "Approved proposal", "--description", "Approval: pending"), "draft");
	const calls = [];
	const tool = await workflowToolHarness(async (command, args, options = {}) => {
		calls.push(args);
		try {
			const result = await run(command, args, { cwd: options.cwd, maxBuffer: 1024 * 1024 });
			return { ...result, code: 0, killed: false };
		} catch (error) {
			return { stdout: error.stdout ?? "", stderr: error.stderr ?? "", code: error.code ?? 1, killed: false };
		}
	});
	const proposal = [
		{ key: "feature", title: "Feature", description: "The outcome", type: "feature", priority: "High", acceptanceCriteria: ["Outcome works"] },
		{ key: "setup", title: "Setup", description: "Prepare it", type: "task", parentKey: "feature", acceptanceCriteria: ["Setup works"] },
		{ key: "finish", title: "Finish", description: "Finish it", type: "task", parentKey: "feature", dependsOn: ["setup"], acceptanceCriteria: ["Finish works"] },
	];
	const declined = await tool.execute("decline", { operation: "refinement_publish", id: draftId, proposedTasks: proposal }, undefined, undefined, {
		cwd: project, hasUI: true, ui: { confirm: async () => false },
	});
	assert.match(declined.content[0].text, /cancelled/);
	assert.equal(JSON.parse(await cli(project, "task", "list", "--json")).tasks.length, 0);

	const published = await tool.execute("approve", { operation: "refinement_publish", id: draftId, proposedTasks: proposal }, undefined, undefined, {
		cwd: project, hasUI: true, ui: { confirm: async () => true },
	});
	assert.match(published.content[0].text, /Published and archived/);
	const tasks = JSON.parse(await cli(project, "task", "list", "--json")).tasks;
	assert.equal(tasks.length, 3);
	const byTitle = new Map(tasks.map((task) => [task.title, task]));
	assert.equal(byTitle.get("Setup").parentTaskId, byTitle.get("Feature").id);
	assert.deepEqual(JSON.parse(await cli(project, "task", "view", byTitle.get("Finish").id, "--json")).task.dependencies, [byTitle.get("Setup").id]);
	const approvalEdit = calls.find((args) => args[0] === "draft" && args[1] === "edit" && args.some((arg) => arg.includes("Published tickets:")));
	assert.ok(approvalEdit, "Approval and published IDs must be recorded before archiving");
	assert.ok(calls.indexOf(approvalEdit) < calls.findIndex((args) => args[0] === "draft" && args[1] === "archive"));
});

test("workflow-init initializes and validates the required configuration idempotently", async (t) => {
	assert.ok(existsSync(backlog), "Run npm install in pi-extensions/backlog-workflow first.");
	const project = await mkdtemp(path.join(os.tmpdir(), "backlog-workflow-init-"));
	t.after(() => rm(project, { recursive: true, force: true }));
	await run("git", ["init", "--quiet"], { cwd: project });

	const { commands } = await workflowHarness();
	const command = commands.get("workflow-init");
	assert.ok(command);
	const first = commandContext(project);
	await command.handler("", first.ctx);
	assert.equal(first.notifications.at(-1).level, "success");
	assert.equal((await cli(project, "config", "get", "defaultStatus")).trim(), "Open");
	assert.equal((await cli(project, "config", "get", "statuses")).trim(), "Open, In Progress, In Review, Rework, Blocked, Needs Human, Done");
	assert.equal((await cli(project, "config", "get", "types")).trim(), "feature, sub-feature, task");
	assert.equal((await cli(project, "config", "get", "priorities")).trim(), "Critical, High, Medium, Low");
	assert.match(await cli(project, "config", "get", "definitionOfDone"), /Acceptance criteria are met/);

	const repeat = commandContext(project, async () => assert.fail("matching config must not request confirmation"));
	await command.handler("", repeat.ctx);
	assert.equal(repeat.notifications.at(-1).level, "success");
});

test("workflow-init requires Git and never changes existing config without confirmation", async (t) => {
	const { commands } = await workflowHarness();
	const command = commands.get("workflow-init");
	const noGit = await mkdtemp(path.join(os.tmpdir(), "backlog-workflow-no-git-"));
	t.after(() => rm(noGit, { recursive: true, force: true }));
	const rejected = commandContext(noGit);
	await command.handler("", rejected.ctx);
	assert.match(rejected.notifications.at(-1).message, /requires a Git repository/);

	const project = await mkdtemp(path.join(os.tmpdir(), "backlog-workflow-reconcile-"));
	t.after(() => rm(project, { recursive: true, force: true }));
	await run("git", ["init", "--quiet"], { cwd: project });
	await cli(project, "init", "Existing", "--defaults", "--integration-mode", "none");
	const config = path.join(project, "backlog", "config.yml");
	await writeFile(config, `${await readFile(config, "utf8")}\nstatuses: ["Wrong"]\n`);
	const before = await readFile(config, "utf8");
	const declined = commandContext(project, async () => false);
	await command.handler("", declined.ctx);
	assert.equal(await readFile(config, "utf8"), before);
	assert.equal(declined.notifications.at(-1).message, "Cancelled");

	const accepted = commandContext(project);
	await command.handler("", accepted.ctx);
	assert.equal(accepted.notifications.at(-1).level, "success");
	assert.equal((await cli(project, "config", "get", "statuses")).trim(), "Open, In Progress, In Review, Rework, Blocked, Needs Human, Done");
});
