import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { access, chmod, mkdir, mkdtemp, realpath, rm, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const packageRoot = path.join(repoRoot, "pi-extensions", "devflow");
const backlog = path.join(packageRoot, "node_modules", ".bin", "backlog");
const run = promisify(execFile);

async function cli(cwd, ...args) {
	return (await run(backlog, args, { cwd, maxBuffer: 1024 * 1024 })).stdout;
}

async function configureGit(cwd) {
	await run("git", ["config", "user.email", "workflow@example.test"], { cwd });
	await run("git", ["config", "user.name", "Workflow Test"], { cwd });
}

function createdId(output, kind) {
	const match = output.match(new RegExp(`Created ${kind} (\\S+)`));
	assert.ok(match, `Could not find ${kind} ID in: ${output}`);
	return match[1];
}

async function workflowHarness(beforeExec = async () => {}) {
	const commands = new Map();
	const events = new Map();
	const messages = [];
	const extension = await import(`${pathToFileURL(path.join(packageRoot, "index.ts")).href}?t=${Date.now()}`);
	extension.default({
		registerCommand(name, definition) {
			commands.set(name, definition);
		},
		registerTool() {},
		on(name, handler) {
			events.set(name, handler);
		},
		sendUserMessage(message) {
			messages.push(message);
		},
		async exec(command, args, options = {}) {
			await beforeExec(command, args, options);
			try {
				const result = await run(command, args, { cwd: options.cwd, maxBuffer: 1024 * 1024 });
				return { ...result, code: 0, killed: false };
			} catch (error) {
				return { stdout: error.stdout ?? "", stderr: error.stderr ?? "", code: error.code ?? 1, killed: false };
			}
		},
	});
	return { commands, events, messages };
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
	const previous = process.env.PI_DEVFLOW_WORKER;
	if (worker) process.env.PI_DEVFLOW_WORKER = "1";
	else delete process.env.PI_DEVFLOW_WORKER;
	try {
		const extension = await import(`${pathToFileURL(path.join(packageRoot, "index.ts")).href}?t=${Date.now()}`);
		extension.default({
			registerCommand() {},
			on() {},
			registerTool(definition) {
				tools.set(definition.name, definition);
			},
			exec,
		});
	} finally {
		if (previous === undefined) delete process.env.PI_DEVFLOW_WORKER;
		else process.env.PI_DEVFLOW_WORKER = previous;
	}
	return tools;
}

function commandContext(cwd, confirm = async () => true, input = async () => undefined, select = async () => undefined) {
	const notifications = [];
	const statuses = [];
	const widgets = [];
	const listeners = new Set();
	return {
		notifications,
		statuses,
		widgets,
		terminalInput: (data) => [...listeners].map((listener) => listener(data)),
		ctx: {
			hasUI: true,
			mode: "tui",
			isIdle: () => true,
			cwd,
			ui: {
				confirm,
				input,
				select,
				notify(message, level) {
					notifications.push({ message, level });
				},
				setStatus(_key, text) {
					statuses.push(text);
				},
				setWidget(_key, content) { widgets.push(content); },
				onTerminalInput(listener) {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
			},
		},
	};
}

test("devflow is a Pi package with its Backlog.md dependency", async () => {
	const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
	assert.deepEqual(manifest.pi.extensions, ["./index.ts"]);
	assert.equal(manifest.dependencies["backlog.md"], "^1.4.0");

	const extension = await import(`${pathToFileURL(path.join(packageRoot, "index.ts")).href}?t=${Date.now()}`);
	assert.equal(typeof extension.default, "function");
	assert.doesNotThrow(() => extension.default({ registerCommand() {}, registerTool() {}, on() {} }));
});

test("package-local Backlog.md CLI supports the workflow contract", async (t) => {
	assert.ok(existsSync(backlog), "Run npm install in pi-extensions/devflow first.");
	const project = await mkdtemp(path.join(os.tmpdir(), "devflow-"));
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

test("session start recovers only stale devflow implementation tasks", async (t) => {
	const project = await mkdtemp(path.join(os.tmpdir(), "devflow-recovery-"));
	t.after(() => rm(project, { recursive: true, force: true }));
	await run("git", ["init", "--quiet"], { cwd: project });
	await cli(project, "init", "Recovery", "--defaults", "--integration-mode", "none");
	const { commands, events } = await workflowHarness();
	await commands.get("devflow-init").handler("", commandContext(project).ctx);
	const staleId = createdId(await cli(project, "task", "create", "Stale", "--type", "task"), "task");
	const otherId = createdId(await cli(project, "task", "create", "Other", "--type", "task"), "task");
	await cli(project, "task", "edit", staleId, "--status", "In Progress", "--comment", "Implementation worker started.", "--comment-author", "@workflow");
	await cli(project, "task", "edit", otherId, "--status", "In Progress");

	const previousWorker = process.env.PI_DEVFLOW_WORKER;
	await events.get("session_start")({ reason: "startup" }, { cwd: project });
	assert.equal(JSON.parse(await cli(project, "task", "view", staleId, "--json")).task.status, "In Progress");
	process.env.PI_DEVFLOW_WORKER = "1";
	try { await events.get("session_start")({ reason: "reload" }, { cwd: project }); }
	finally {
		if (previousWorker === undefined) delete process.env.PI_DEVFLOW_WORKER;
		else process.env.PI_DEVFLOW_WORKER = previousWorker;
	}
	assert.equal(JSON.parse(await cli(project, "task", "view", staleId, "--json")).task.status, "In Progress");
	await events.get("session_start")({ reason: "reload" }, { cwd: project });

	const stale = JSON.parse(await cli(project, "task", "view", staleId, "--json")).task;
	assert.equal(stale.status, "Open");
	assert.match(stale.comments.at(-1).body, /Recovered stale devflow implementation/);
	assert.equal(JSON.parse(await cli(project, "task", "view", otherId, "--json")).task.status, "In Progress");
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

test("worker prompts require ticket evidence, review, reconciliation, and a terminating outcome", async () => {
	const { implementerPrompt, reviewerPrompt, reconcilerPrompt } = await import(`${pathToFileURL(path.join(packageRoot, "worker-runner.ts")).href}?t=${Date.now()}`);
	const prompt = implementerPrompt("TASK-42");
	assert.match(prompt, /task_view/);
	assert.match(prompt, /project instructions/);
	assert.match(prompt, /Implement only the ticket's acceptance criteria/);
	assert.match(prompt, /required checks/);
	assert.match(prompt, /documentation and durable-decision impact/);
	assert.match(prompt, /\"modifiedFiles\"/);
	assert.match(prompt, /complete_transition exactly once as your final action/);
	assert.match(prompt, /TASK-42/);
	const review = reviewerPrompt("TASK-42");
	assert.match(review, /read-only reviewer/);
	assert.match(review, /"verdict": "approved"\|"rework"/);
	assert.match(review, /Do not modify files, Backlog\.md, or Git state/);
	assert.match(review, /complete_transition exactly once as your final action/);
	const reconciliation = reconcilerPrompt("TASK-42");
	assert.match(reconciliation, /reconciliation worker/);
	assert.match(reconciliation, /parent acceptance criteria.*documentation.*technical decisions.*related Backlog\.md tickets/is);
	assert.match(reconciliation, /Do not modify files, Backlog\.md, or Git state/);
	assert.match(reconciliation, /complete_transition exactly once as your final action/);
});

test("child Pi runner inherits project context and reports bounded, malformed, and cancelled runs", async (t) => {
	const project = await mkdtemp(path.join(os.tmpdir(), "devflow-worker-"));
	const fakePi = path.join(project, "fake-pi.mjs");
	t.after(() => rm(project, { recursive: true, force: true }));
	await writeFile(fakePi, [
		'import { writeFileSync } from "node:fs";',
		'import path from "node:path";',
		'const prompt = process.argv.at(-1);',
		'writeFileSync(path.join(process.cwd(), "worker-invocation.json"), JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), worker: process.env.PI_DEVFLOW_WORKER, reviewer: process.env.PI_DEVFLOW_REVIEWER }));',
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
		reviewer: "0",
	});

	const reviewer = await runChildPi({ cwd: project, prompt: "review", readOnly: true });
	assert.equal(reviewer.outcome, "completed");
	assert.deepEqual(JSON.parse(await readFile(path.join(project, "worker-invocation.json"), "utf8")), {
		args: ["--mode", "json", "-p", "--no-session", "--extension", path.join(packageRoot, "index.ts"), "--tools", "read,grep,find,ls,backlog,complete_transition", "--", "review"],
		cwd: await realpath(project),
		worker: "1",
		reviewer: "1",
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
	assert.ok(existsSync(backlog), "Run npm install in pi-extensions/devflow first.");
	const project = await mkdtemp(path.join(os.tmpdir(), "devflow-tool-"));
	t.after(() => rm(project, { recursive: true, force: true }));
	await run("git", ["init", "--quiet"], { cwd: project });
	await cli(project, "init", "Tool contract", "--defaults", "--integration-mode", "none");

	const tool = await workflowToolHarness();
	assert.ok(tool, "Extension did not register backlog tool");
	const previousReviewer = process.env.PI_DEVFLOW_REVIEWER;
	process.env.PI_DEVFLOW_REVIEWER = "1";
	const reviewerTool = await workflowToolHarness();
	await assert.rejects(() => reviewerTool.execute("write", { operation: "task_create", title: "Forbidden" }, undefined, undefined, { cwd: project }), /Reviewer workers may only read/);
	if (previousReviewer === undefined) delete process.env.PI_DEVFLOW_REVIEWER;
	else process.env.PI_DEVFLOW_REVIEWER = previousReviewer;
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

test("devflow-inbox lists and resolves pending human requests", async (t) => {
	assert.ok(existsSync(backlog), "Run npm install in pi-extensions/devflow first.");
	const project = await mkdtemp(path.join(os.tmpdir(), "devflow-inbox-"));
	t.after(() => rm(project, { recursive: true, force: true }));
	await run("git", ["init", "--quiet"], { cwd: project });
	await cli(project, "init", "Inbox contract", "--defaults", "--integration-mode", "none");

	const { commands } = await workflowHarness();
	await commands.get("devflow-init").handler("", commandContext(project).ctx);
	const firstId = createdId(await cli(project, "task", "create", "First request", "--type", "task", "--priority", "Medium", "--ac", "Works"), "task");
	const secondId = createdId(await cli(project, "task", "create", "Deployment request", "--type", "task", "--priority", "Medium", "--ac", "Works"), "task");
	for (const id of [firstId, secondId]) await cli(project, "task", "edit", id, "--status", "Needs Human", "--assignee", "@human", "--comment", `## Human request\nChoose a target for ${id}.\n\nResponse: pending`, "--comment-author", "@workflow");

	const inbox = commandContext(project, async () => true, async () => "Use staging.");
	let choices = [];
	let prompt = "";
	const actions = ["Add response", "Continue"];
	inbox.ctx.ui.select = async (_label, options) => {
		if (options.some((option) => option.startsWith(`${secondId}:`))) {
			choices = options;
			return options.find((option) => option.startsWith(`${secondId}:`));
		}
		return actions.shift();
	};
	const input = inbox.ctx.ui.input;
	inbox.ctx.ui.input = async (label, value) => {
		prompt = `${label}\n${value}`;
		return input(label, value);
	};
	await commands.get("devflow-inbox").handler("", inbox.ctx);
	assert.ok(choices.some((choice) => choice.startsWith(`${firstId}: First request`)));
	assert.ok(choices.some((choice) => choice.startsWith(`${secondId}: Deployment request`)));
	assert.match(prompt, /Choose a target for/);
	const resolved = JSON.parse(await cli(project, "task", "view", secondId, "--json")).task;
	assert.equal(resolved.status, "Open");
	assert.deepEqual(resolved.assignees, []);
	assert.match(resolved.comments.map(({ body }) => body).join("\n"), /Use staging/);
	assert.match(resolved.comments.at(-1).body, /Continue confirmed/);
	assert.equal(JSON.parse(await cli(project, "task", "view", firstId, "--json")).task.status, "Needs Human");
});

test("implement-run handles fake-Pi success, malformed evidence, and blocked-task refusal", async (t) => {
	assert.ok(existsSync(backlog), "Run npm install in pi-extensions/devflow first.");
	const project = await mkdtemp(path.join(os.tmpdir(), "devflow-implement-"));
	const fakePi = path.join(project, "fake-pi.mjs");
	const invocations = path.join(project, "worker-invocations");
	t.after(() => rm(project, { recursive: true, force: true }));
	await run("git", ["init", "--quiet"], { cwd: project });
	await cli(project, "init", "Implement contract", "--defaults", "--integration-mode", "none");
	await writeFile(fakePi, [
		'import { existsSync, readFileSync, writeFileSync } from "node:fs";',
		`const invocations = ${JSON.stringify(invocations)};`,
		'const call = existsSync(invocations) ? Number(readFileSync(invocations, "utf8")) : 0;',
		'const prompt = process.argv.at(-1);',
		'writeFileSync(invocations, String(call + 1));',
		'const evidence = { summary: "Implemented", plan: ["Change code"], modifiedFiles: ["index.ts"], acceptanceCriteria: [{ criterion: "Works", status: "met", evidence: "Checked" }], checks: [{ command: "node --test", status: "passed", evidence: "ok" }], documentation: { impact: "none", evidence: "No docs" }, blockers: [] };',
		'const review = prompt.includes("read-only reviewer");',
		'const human = [9, 12].includes(call) && !review;',
		'const reviewEvidence = { verdict: call === 1 || call >= 11 ? "approved" : "rework", findings: call === 1 || call >= 11 ? [] : [`Required fix ${call}`] };',
		'const output = review ? JSON.stringify(reviewEvidence) : call === 2 ? "malformed" : JSON.stringify(human ? { ...evidence, blockers: ["Choose a deployment target."] } : evidence);',
		'const outcome = human && !review ? "needs_human" : "completed";',
		'console.log(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: output }], usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } }));',
		'console.log(JSON.stringify({ type: "message_end", message: { role: "toolResult", toolName: "complete_transition", details: { outcome }, isError: false, content: [] } }));',
	].join("\n"));
	const previousScript = process.argv[1];
	process.argv[1] = fakePi;
	t.after(() => { process.argv[1] = previousScript; });

	const { commands } = await workflowHarness();
	await commands.get("devflow-init").handler("", commandContext(project).ctx);
	const command = commands.get("implement-run");
	const taskId = createdId(await cli(project, "task", "create", "Implement", "--type", "task", "--priority", "Medium", "--ac", "Works"), "task");
	const startedRun = commandContext(project);
	await command.handler(taskId, startedRun.ctx);
	assert.ok(startedRun.notifications.some(({ message }) => message === `${taskId}: implementation started`));
	assert.ok(startedRun.statuses.includes(`Busy — ${taskId}: implementing`));
	assert.ok(startedRun.statuses.includes(`Busy — ${taskId}: reviewing`));
	assert.deepEqual(startedRun.statuses.filter((status) => status === undefined), [undefined]);
	assert.equal(startedRun.statuses.at(-1), undefined);
	assert.equal(startedRun.widgets.at(-1), undefined);
	assert.deepEqual(startedRun.terminalInput("ordinary input"), []);
	const task = JSON.parse(await cli(project, "task", "view", taskId, "--json")).task;
	assert.equal(task.status, "Done");
	assert.equal(task.implementationPlan, "- Change code");
	assert.match(task.implementationNotes, /Works/);
	assert.match(task.implementationNotes, /node --test/);
	assert.deepEqual(task.modifiedFiles, ["index.ts"]);
	assert.equal(task.acceptanceCriteriaCompleted, 1);
	assert.equal(task.finalSummary, "Implemented");
	assert.match(task.comments.at(-1).body, /Verdict: approved/);

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

	const reworkId = createdId(await cli(project, "task", "create", "Rework", "--type", "task", "--priority", "Medium", "--ac", "Works"), "task");
	await command.handler(reworkId, commandContext(project).ctx);
	const rework = JSON.parse(await cli(project, "task", "view", reworkId, "--json")).task;
	assert.equal(rework.status, "Needs Human");
	assert.deepEqual(rework.assignees, ["@human"]);
	const comments = rework.comments.map(({ body }) => body).join("\n");
	assert.match(comments, /Verdict: rework/);
	assert.match(comments, /Rework attempt: 1\/2/);
	assert.match(comments, /Rework attempt: 2\/2/);
	assert.match(comments, /Rework cap reached after 2 attempts/);
	assert.equal(await readFile(invocations, "utf8"), "9");

	const humanId = createdId(await cli(project, "task", "create", "Human input", "--type", "task", "--priority", "Medium", "--ac", "Works"), "task");
	let requestAtPrompt;
	const responses = ["Use staging.", "Proceed after review."];
	const humanRun = commandContext(project, async () => true, async (_title, context) => {
		requestAtPrompt ??= JSON.parse(await cli(project, "task", "view", humanId, "--json")).task;
		assert.match(context, new RegExp(`Task: ${humanId}`));
		assert.match(context, /Choose a deployment target\./);
		assert.match(context, /Worker outcome: needs_human/);
		return responses.shift();
	});
	const humanActions = ["Add response", "Add response", "Continue"];
	humanRun.ctx.ui.select = async (_title, options) => {
		assert.deepEqual(options, ["Add response", "Continue", "Defer"]);
		return humanActions.shift();
	};
	await command.handler(humanId, humanRun.ctx);
	assert.equal(requestAtPrompt.status, "Needs Human");
	assert.deepEqual(requestAtPrompt.assignees, ["@human"]);
	assert.match(requestAtPrompt.comments.at(-1).body, /Human request/);
	const human = JSON.parse(await cli(project, "task", "view", humanId, "--json")).task;
	assert.equal(human.status, "Done");
	assert.deepEqual(human.assignees, []);
	const humanComments = human.comments.map(({ body, author }) => `${author}: ${body}`).join("\n");
	assert.match(humanComments, /@workflow: ## Human request\nChoose a deployment target\.\n\nResponse: pending/);
	assert.match(humanComments, /@human: ## Human response\nUse staging\./);
	assert.match(humanComments, /@human: ## Human response\nProceed after review\./);
	assert.match(humanComments, /@human: ## Human continuation\nContinue confirmed\./);

	const deferredId = createdId(await cli(project, "task", "create", "Deferred human input", "--type", "task", "--priority", "Medium", "--ac", "Works"), "task");
	const deferredRun = commandContext(project, async () => false);
	const deferredActions = ["Continue", "Defer"];
	deferredRun.ctx.ui.select = async () => deferredActions.shift();
	await command.handler(deferredId, deferredRun.ctx);
	const deferred = JSON.parse(await cli(project, "task", "view", deferredId, "--json")).task;
	assert.equal(deferred.status, "Needs Human");
	assert.deepEqual(deferred.assignees, ["@human"]);
	assert.match(deferred.comments.at(-2).body, /Response: pending/);
	assert.match(deferred.comments.at(-1).body, /Deferred\./);
	assert.ok(deferredRun.notifications.some(({ message }) => /Needs Human/.test(message)));

	const { commands: restartedCommands } = await workflowHarness();
	const restarted = commandContext(project, async () => true, async () => "Resume with staging.");
	const resumedActions = ["Add response", "Continue"];
	restarted.ctx.ui.select = async (_label, options) => options.find((option) => option.startsWith(`${deferredId}:`)) ?? resumedActions.shift();
	await restartedCommands.get("devflow-inbox").handler("", restarted.ctx);
	const resumed = JSON.parse(await cli(project, "task", "view", deferredId, "--json")).task;
	assert.equal(resumed.status, "Open");
	assert.deepEqual(resumed.assignees, []);
	assert.match(resumed.comments.map(({ body }) => body).join("\n"), /Resume with staging/);
	assert.match(resumed.comments.at(-1).body, /Continue confirmed/);
});

test("implement-run locks only its session through cancellation and cleanup in every worker phase", { timeout: 60_000 }, async (t) => {
	const project = await mkdtemp(path.join(os.tmpdir(), "devflow-session-control-"));
	t.after(() => rm(project, { recursive: true, force: true }));
	await run("git", ["init", "--quiet"], { cwd: project });
	await cli(project, "init", "Session control", "--defaults", "--integration-mode", "none");
	const fakePi = path.join(project, "fake-pi.mjs");
	const reached = path.join(project, "reached");
	await writeFile(fakePi, [
		'import { readFileSync, writeFileSync } from "node:fs";',
		'const prompt = process.argv.at(-1);',
		'const phase = prompt.includes("reconciliation worker") ? "reconciling" : prompt.includes("read-only reviewer") ? "reviewing" : "implementing";',
		'if (phase === readFileSync("hold", "utf8")) { writeFileSync("reached", phase); setInterval(() => {}, 1000); }',
		'else {',
		'  const output = phase === "reviewing" ? { verdict: "approved", findings: [] } : { summary: "Implemented", plan: [], modifiedFiles: [], acceptanceCriteria: [{ criterion: "Works", status: "met", evidence: "Checked" }], checks: [], documentation: { impact: "none", evidence: "None" }, blockers: [] };',
		'  console.log(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: JSON.stringify(output) }] } }));',
		'  console.log(JSON.stringify({ type: "message_end", message: { role: "toolResult", toolName: "complete_transition", details: { outcome: "completed" } } }));',
		'}',
	].join("\n"));
	const previousScript = process.argv[1];
	process.argv[1] = fakePi;
	t.after(() => { process.argv[1] = previousScript; });
	const waitFor = async (check) => {
		for (let i = 0; i < 500; i++) {
			if (await check()) return;
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		assert.fail("Controller did not reach the expected phase");
	};
	let recoveryReached = false;
	const recovery = Promise.withResolvers();
	const { commands, events } = await workflowHarness(async (_command, args) => {
		if (args[0] === "task" && args[1] === "edit" && args.includes("Open") && args.some((arg) => arg.startsWith("Implementation failed:"))) {
			recoveryReached = true;
			await recovery.promise;
		}
	});
	await commands.get("devflow-init").handler("", commandContext(project).ctx);

	for (const phase of ["implementing", "reviewing", "reconciling"]) {
		await writeFile(path.join(project, "hold"), phase);
		await writeFile(reached, "");
		const featureId = createdId(await cli(project, "task", "create", phase, "--type", "feature"), "task");
		const leafId = createdId(await cli(project, "task", "create", "Leaf", "--type", "task", "--parent", featureId, "--ac", "Works"), "task");
		const nextId = createdId(await cli(project, "task", "create", "Next", "--type", "task", "--parent", featureId, "--ac", "Works"), "task");
		const controller = commandContext(project);
		const running = commands.get("implement-run").handler(featureId, controller.ctx);
		t.after(async () => { recovery.resolve(); await commands.get("devflow-cancel").handler("", controller.ctx); await running; });
		await waitFor(async () => (await readFile(reached, "utf8")) === phase);
		const taskId = phase === "reconciling" ? featureId : leafId;
		await commands.get("devflow-status").handler("", controller.ctx);
		assert.match(controller.notifications.at(-1).message, new RegExp(`${taskId}: ${phase}`));
		assert.deepEqual(controller.terminalInput("s"), [{ consume: true }]);
		for (const text of ["ordinary prompt", "/refine surprise", "/reload", "!touch surprise", "\x10", "\x1b[200~/devflow-init\r\x1b[201~"]) {
			assert.deepEqual(controller.terminalInput(text), [{ consume: true }]);
		}
		assert.deepEqual(await events.get("input")({ text: "ordinary prompt", source: "rpc" }, controller.ctx), { action: "handled" });
		assert.equal((await events.get("tool_call")({}, controller.ctx)).block, true);
		assert.equal((await events.get("user_bash")({}, controller.ctx)).result.exitCode, 1);
		for (const event of ["session_before_switch", "session_before_fork", "session_before_tree", "session_before_compact"]) {
			assert.deepEqual(await events.get(event)({}, controller.ctx), { cancel: true });
		}
		for (const command of ["implement-run", "refine", "devflow-inbox", "devflow-init", "devflow-commit-backlog"]) {
			await commands.get(command).handler(featureId, controller.ctx);
			assert.match(controller.notifications.at(-1).message, /implement-run busy/);
		}

		if (phase === "implementing") {
			const other = await workflowHarness();
			const otherSession = commandContext(project);
			await other.commands.get("refine").handler("Independent refinement", otherSession.ctx);
			assert.match(other.messages.at(-1), /Refine Backlog.md draft/);
			const humanId = createdId(await cli(project, "task", "create", "Human", "--type", "task"), "task");
			await cli(project, "task", "edit", humanId, "--status", "Needs Human", "--assignee", "@human");
			const inbox = commandContext(project, undefined, async () => "Proceed");
			const actions = ["Add response", "Continue"];
			inbox.ctx.ui.select = async (_title, options) => options[0].startsWith(`${humanId}:`) ? options[0] : actions.shift();
			await other.commands.get("devflow-inbox").handler("", inbox.ctx);
			assert.equal(JSON.parse(await cli(project, "task", "view", humanId, "--json")).task.status, "Open");
			assert.equal(await other.events.get("input")({}, otherSession.ctx), undefined);
			assert.deepEqual(controller.terminalInput("\x1b"), [{ consume: true }]);
			await waitFor(async () => recoveryReached);
			assert.deepEqual(await events.get("input")({}, controller.ctx), { action: "handled" }, "Must stay locked while recovery is pending");
			assert.match(controller.statuses.at(-1), /^Cancelling/);
			recovery.resolve();
		} else if (phase === "reviewing") {
			await commands.get("devflow-cancel").handler("", controller.ctx);
		} else {
			await events.get("session_shutdown")({}, controller.ctx);
		}
		await running;
		assert.equal(controller.statuses.at(-1), undefined);
		assert.equal(controller.widgets.at(-1), undefined);
		assert.deepEqual(controller.terminalInput("unlocked"), []);
		assert.equal(await events.get("input")({}, controller.ctx), undefined);
		await commands.get("devflow-status").handler("", controller.ctx);
		assert.match(controller.notifications.at(-1).message, /No implementation controller/);
		assert.equal(JSON.parse(await cli(project, "task", "view", leafId, "--json")).task.status, phase === "implementing" ? "Open" : phase === "reviewing" ? "In Review" : "Done");
		assert.equal(JSON.parse(await cli(project, "task", "view", nextId, "--json")).task.status, phase === "reconciling" ? "Done" : "Open", "Cancellation must not start the next leaf");
	}
});

test("implement-run releases its lock after picker cancellation and setup failure, and refuses an active main agent", { timeout: 15_000 }, async (t) => {
	const project = await mkdtemp(path.join(os.tmpdir(), "devflow-picker-control-"));
	t.after(() => rm(project, { recursive: true, force: true }));
	const { commands, events } = await workflowHarness();
	const command = commands.get("implement-run");
	const controller = commandContext(project);
	controller.ctx.isIdle = () => false;
	await command.handler("TASK-1", controller.ctx);
	assert.match(controller.notifications.at(-1).message, /Wait for the main session/);
	assert.deepEqual(controller.statuses, []);
	controller.ctx.isIdle = () => true;
	await command.handler("TASK-1", controller.ctx);
	assert.match(controller.notifications.at(-1).message, /implement-run failed/);
	assert.equal(controller.statuses.at(-1), undefined);
	assert.deepEqual(controller.terminalInput("unlocked"), []);

	await run("git", ["init", "--quiet"], { cwd: project });
	await cli(project, "init", "Picker cancellation", "--defaults", "--integration-mode", "none");
	await cli(project, "task", "create", "Feature", "--type", "feature");
	const picker = Promise.withResolvers();
	controller.ctx.ui.select = async (_title, _options, { signal }) => {
		assert.equal((await events.get("input")({}, controller.ctx)).action, "handled");
		assert.deepEqual(controller.terminalInput("answer"), [undefined], "Only the workflow's prompt accepts text");
		picker.resolve();
		return new Promise((resolve) => signal.addEventListener("abort", () => resolve(undefined), { once: true }));
	};
	const running = command.handler("", controller.ctx);
	t.after(async () => { await commands.get("devflow-cancel").handler("", controller.ctx); await running; });
	await picker.promise;
	assert.match(controller.statuses.at(-1), /waiting for human/);
	assert.deepEqual(controller.terminalInput("\x03"), [{ consume: true }]);
	await running;
	assert.match(controller.notifications.at(-1).message, /implement-run cancelled/);
	assert.equal(controller.statuses.at(-1), undefined);
	assert.equal(controller.widgets.at(-1), undefined);
	assert.equal(await events.get("input")({}, controller.ctx), undefined);
	assert.deepEqual(controller.terminalInput("unlocked"), []);
});

test("implement-run processes every ready descendant leaf for a feature", async (t) => {
	assert.ok(existsSync(backlog), "Run npm install in pi-extensions/devflow first.");
	const project = await mkdtemp(path.join(os.tmpdir(), "devflow-feature-"));
	const fakePi = path.join(project, "fake-pi.mjs");
	t.after(() => rm(project, { recursive: true, force: true }));
	await run("git", ["init", "--quiet"], { cwd: project });
	await cli(project, "init", "Feature contract", "--defaults", "--integration-mode", "none");
	await writeFile(fakePi, [
		'const prompt = process.argv.at(-1);',
		'const review = prompt.includes("read-only reviewer");',
		'const reconciliation = prompt.includes("reconciliation worker");',
		'const evidence = { summary: "Implemented", plan: ["Change code"], modifiedFiles: ["index.ts"], acceptanceCriteria: [{ criterion: "Works", status: "met", evidence: "Checked" }], checks: [{ command: "node --test", status: "passed", evidence: "ok" }], documentation: { impact: "none", evidence: "No docs" }, blockers: [] };',
		'const reconciliationEvidence = { summary: "Reconciled", checks: ["parent acceptance criteria", "documentation", "technical decisions", "related tickets"].map((area) => ({ area, status: "passed", evidence: "Checked" })) };',
		'const output = JSON.stringify(reconciliation ? reconciliationEvidence : review ? { verdict: "approved", findings: [] } : evidence);',
		'console.log(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: output }], usage: {} } }));',
		'console.log(JSON.stringify({ type: "message_end", message: { role: "toolResult", toolName: "complete_transition", details: { outcome: "completed" }, isError: false, content: [] } }));',
	].join("\n"));
	const previousScript = process.argv[1];
	process.argv[1] = fakePi;
	t.after(() => { process.argv[1] = previousScript; });

	const { commands, events } = await workflowHarness();
	await commands.get("devflow-init").handler("", commandContext(project).ctx);
	const featureId = createdId(await cli(project, "task", "create", "Feature", "--type", "feature", "--priority", "Medium"), "task");
	const subFeatureId = createdId(await cli(project, "task", "create", "Group", "--type", "sub-feature", "--priority", "Medium", "--parent", featureId), "task");
	const blockedId = createdId(await cli(project, "task", "create", "Blocked dependency", "--type", "task", "--priority", "Medium", "--parent", subFeatureId, "--ac", "Works"), "task");
	await cli(project, "task", "edit", blockedId, "--status", "Blocked");
	const waitingId = createdId(await cli(project, "task", "create", "Waiting", "--type", "task", "--priority", "Medium", "--parent", subFeatureId, "--depends-on", blockedId, "--ac", "Works"), "task");
	const humanId = createdId(await cli(project, "task", "create", "Human owned", "--type", "task", "--priority", "Medium", "--parent", subFeatureId, "--ac", "Works"), "task");
	await cli(project, "task", "edit", humanId, "--assignee", "@human");
	const runnableId = createdId(await cli(project, "task", "create", "Runnable", "--type", "task", "--priority", "Medium", "--parent", subFeatureId, "--ac", "Works"), "task");
	const laterRunnableId = createdId(await cli(project, "task", "create", "Later runnable", "--type", "task", "--priority", "Medium", "--parent", subFeatureId, "--ac", "Works"), "task");
	const priorityId = createdId(await cli(project, "task", "create", "Higher priority", "--type", "task", "--priority", "High", "--parent", subFeatureId, "--ac", "Works"), "task");
	const reworkId = createdId(await cli(project, "task", "create", "Rework first", "--type", "task", "--priority", "Low", "--parent", subFeatureId, "--ac", "Works"), "task");
	await cli(project, "task", "edit", reworkId, "--status", "Rework");

	const command = commands.get("implement-run");
	await events.get("session_start")({}, { cwd: project });
	assert.ok(command.getArgumentCompletions("").some(({ value }) => value === featureId));
	let pickerOptions = [];
	const cancelled = commandContext(project, async () => true, async () => undefined, async (_label, options) => {
		pickerOptions = options;
		return undefined;
	});
	await command.handler("", cancelled.ctx);
	assert.match(pickerOptions.find((option) => option.startsWith(`${featureId}:`)), new RegExp(`Recommended; next ${reworkId}: Rework first \\(Rework, Low\\)`));
	assert.equal(JSON.parse(await cli(project, "task", "view", reworkId, "--json")).task.status, "Rework");
	await command.handler("", commandContext(project, async () => true, async () => undefined, async (_label, options) => options.find((option) => option.startsWith(`${featureId}:`))).ctx);
	for (const [id, status] of [[blockedId, "Blocked"], [waitingId, "Open"], [humanId, "Open"], [reworkId, "Done"], [priorityId, "Done"], [runnableId, "Done"], [laterRunnableId, "Done"], [featureId, "Open"]]) {
		assert.equal(JSON.parse(await cli(project, "task", "view", id, "--json")).task.status, status);
	}
});

test("implement-run reconciles and requires final human approval after every descendant leaf is Done", async (t) => {
	assert.ok(existsSync(backlog), "Run npm install in pi-extensions/devflow first.");
	const project = await mkdtemp(path.join(os.tmpdir(), "devflow-reconcile-feature-"));
	const fakePi = path.join(project, "fake-pi.mjs");
	t.after(() => rm(project, { recursive: true, force: true }));
	await run("git", ["init", "--quiet"], { cwd: project });
	await cli(project, "init", "Reconcile contract", "--defaults", "--integration-mode", "none");
	await writeFile(path.join(project, "tracked.txt"), "before\n");
	await run("git", ["config", "user.email", "test@example.com"], { cwd: project });
	await run("git", ["config", "user.name", "Test"], { cwd: project });
	await run("git", ["add", "tracked.txt"], { cwd: project });
	await run("git", ["commit", "--quiet", "-m", "baseline"], { cwd: project });
	await writeFile(path.join(project, "tracked.txt"), "after\n");
	await writeFile(fakePi, [
		'const output = JSON.stringify({ summary: "Reconciled", checks: ["parent acceptance criteria", "documentation", "technical decisions", "related tickets"].map((area) => ({ area, status: "passed", evidence: "Checked" })) });',
		'console.log(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: output }], usage: {} } }));',
		'console.log(JSON.stringify({ type: "message_end", message: { role: "toolResult", toolName: "complete_transition", details: { outcome: "completed" }, isError: false, content: [] } }));',
	].join("\n"));
	const previousScript = process.argv[1];
	process.argv[1] = fakePi;
	t.after(() => { process.argv[1] = previousScript; });

	const { commands, messages } = await workflowHarness();
	await commands.get("devflow-init").handler("", commandContext(project).ctx);
	const featureId = createdId(await cli(project, "task", "create", "Feature", "--type", "feature", "--priority", "Medium", "--ac", "Feature works"), "task");
	const subFeatureId = createdId(await cli(project, "task", "create", "Sub-feature", "--type", "sub-feature", "--priority", "Medium", "--parent", featureId, "--ac", "Sub-feature works"), "task");
	const leafId = createdId(await cli(project, "task", "create", "Leaf", "--type", "task", "--priority", "Medium", "--parent", subFeatureId, "--ac", "Leaf works"), "task");
	await cli(project, "task", "edit", leafId, "--status", "Done", "--final-summary", "Leaf shipped", "--notes", "node --test: passed", "--modified-file", "tracked.txt", "--comment", "Verdict: approved", "--comment-author", "@reviewer");
	await writeFile(path.join(project, "user-staged.txt"), "do not commit\n");
	await run("git", ["add", "user-staged.txt"], { cwd: project });
	const guarded = commandContext(project);
	await commands.get("implement-run").handler(featureId, guarded.ctx);
	assert.match(guarded.notifications.at(-1).message, /Git index already contains staged changes/);
	assert.equal(JSON.parse(await cli(project, "task", "view", featureId, "--json")).task.status, "In Review");
	assert.equal(JSON.parse(await cli(project, "task", "view", subFeatureId, "--json")).task.status, "Done");
	await run("git", ["restore", "--staged", "user-staged.txt"], { cwd: project });
	await commands.get("implement-run").handler(featureId, commandContext(project, async () => false, async () => "Why this approach?").ctx);
	let pending = JSON.parse(await cli(project, "task", "view", featureId, "--json")).task;
	assert.equal(pending.status, "In Review");
	assert.match(pending.comments.at(-1).body, /Why this approach\?/);
	assert.match(messages.at(-1), /Discuss it before changing anything/);
	const changedIndex = commandContext(project, async () => {
		await run("git", ["add", "user-staged.txt"], { cwd: project });
		return true;
	});
	await commands.get("implement-run").handler(featureId, changedIndex.ctx);
	assert.match(changedIndex.notifications.at(-1).message, /Git index changed after final review/);
	assert.equal(JSON.parse(await cli(project, "task", "view", featureId, "--json")).task.status, "In Review");
	await run("git", ["restore", "--staged", "user-staged.txt"], { cwd: project });
	const cancelledApproval = commandContext(project, async () => {
		assert.match(cancelledApproval.statuses.at(-1), /waiting for human/);
		assert.deepEqual(cancelledApproval.terminalInput("\x1b"), [{ consume: true }]);
		return true; // A late dialog answer must not override cancellation.
	});
	await commands.get("implement-run").handler(featureId, cancelledApproval.ctx);
	assert.match(cancelledApproval.notifications.at(-1).message, /implement-run cancelled/);
	assert.equal(JSON.parse(await cli(project, "task", "view", featureId, "--json")).task.status, "In Review");
	assert.equal((await run("git", ["diff", "--cached", "--name-only"], { cwd: project })).stdout.trim(), "");
	assert.equal(cancelledApproval.statuses.at(-1), undefined);
	assert.deepEqual(cancelledApproval.terminalInput("unlocked"), []);
	let approvalTitle = "";
	let approvalReport = "";
	const approval = commandContext(project, async (title, report) => {
		approvalTitle = title;
		approvalReport = report;
		return true;
	});
	await commands.get("implement-run").handler(featureId, approval.ctx);
	const feature = JSON.parse(await cli(project, "task", "view", featureId, "--json")).task;
	assert.equal(feature.status, "Done");
	assert.match(approvalTitle, new RegExp(featureId));
	assert.match(approvalTitle, /and commit/);
	assert.match(approvalReport, /Leaf shipped/);
	assert.match(approvalReport, /node --test: passed/);
	assert.match(approvalReport, /Verdict: approved/);
	assert.match(approvalReport, /Staged owned files/);
	assert.match(approvalReport, /-before[\s\S]*\+after/);
	assert.deepEqual((await run("git", ["show", "--format=", "--name-only", "HEAD"], { cwd: project })).stdout.trim().split("\n"), ["tracked.txt"]);
	assert.ok(feature.comments.some(({ author, body }) => author === "@reconciler" && /parent acceptance criteria/.test(body)));
	assert.match(feature.comments.at(-1).body, /Final feature approval/);
	assert.match(feature.comments.at(-1).body, /Commit: [0-9a-f]+/);
});

test("feature selection and recommendation follow hierarchy, dependency, priority, and resume JSON fixtures", async () => {
	const { recommendRunnableFeature, selectRunnableFeatureTask } = await import(`${pathToFileURL(path.join(packageRoot, "index.ts")).href}?t=${Date.now()}`);
	const fixture = async (name) => JSON.parse(await readFile(path.join(repoRoot, "tests", "pi-extensions", "devflow", "fixtures", name), "utf8")).tasks;
	const initial = await fixture("selection-initial.json");
	const resumed = await fixture("selection-resume.json");
	assert.equal(selectRunnableFeatureTask(initial, "TASK-1"), "TASK-1.1.1.4");
	assert.equal(selectRunnableFeatureTask(resumed, "TASK-1"), "TASK-1.1.1.5");
	assert.equal(selectRunnableFeatureTask(await fixture("selection-priority.json"), "TASK-1"), "TASK-1.1.1.6");
	assert.equal(selectRunnableFeatureTask(await fixture("selection-ordinal.json"), "TASK-1"), "TASK-1.1.1.7");
	assert.deepEqual(recommendRunnableFeature(initial), { featureId: "TASK-1", taskId: "TASK-1.1.1.4" });
	assert.deepEqual(recommendRunnableFeature(resumed), { featureId: "TASK-2", taskId: "TASK-2.1" });
});

test("refine creates or resumes a draft and continues in the main session", async (t) => {
	assert.ok(existsSync(backlog), "Run npm install in pi-extensions/devflow first.");
	const project = await mkdtemp(path.join(os.tmpdir(), "devflow-refine-"));
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
	assert.ok(existsSync(backlog), "Run npm install in pi-extensions/devflow first.");
	const root = await mkdtemp(path.join(os.tmpdir(), "devflow-handoff-"));
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
	await configureGit(project);
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
	assert.ok(existsSync(backlog), "Run npm install in pi-extensions/devflow first.");
	const project = await mkdtemp(path.join(os.tmpdir(), "devflow-publish-"));
	t.after(() => rm(project, { recursive: true, force: true }));
	await run("git", ["init", "--quiet"], { cwd: project });
	await configureGit(project);
	await cli(project, "init", "Publish contract", "--defaults", "--integration-mode", "none");
	await writeFile(path.join(project, "implementation.ts"), "export {};\n");
	await run("git", ["add", "implementation.ts"], { cwd: project });
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
	assert.match(await cli(project, "draft", "view", draftId, "--plain"), /Approval: pending/);

	const cancelled = await tool.execute("cancel", { operation: "refinement_publish", id: draftId, proposedTasks: proposal }, undefined, undefined, {
		cwd: project, hasUI: true, ui: { confirm: async () => undefined },
	});
	assert.match(cancelled.content[0].text, /cancelled/);
	assert.equal(JSON.parse(await cli(project, "task", "list", "--json")).tasks.length, 0);
	assert.match(await cli(project, "draft", "view", draftId, "--plain"), /Approval: pending/);

	const published = await tool.execute("approve", { operation: "refinement_publish", id: draftId, proposedTasks: proposal }, undefined, undefined, {
		cwd: project, hasUI: true, ui: { confirm: async () => true },
	});
	assert.match(published.content[0].text, /Published and archived/);
	assert.match(published.content[0].text, /Committed Backlog\.md changes/);
	const committedFiles = (await run("git", ["show", "--format=", "--name-only", "HEAD"], { cwd: project })).stdout.trim().split("\n");
	assert.ok(committedFiles.every((file) => file.startsWith("backlog/")));
	assert.deepEqual((await run("git", ["diff", "--cached", "--name-only"], { cwd: project })).stdout.trim().split("\n"), ["implementation.ts"]);
	const tasks = JSON.parse(await cli(project, "task", "list", "--json")).tasks;
	assert.equal(tasks.length, 3);
	const byTitle = new Map(tasks.map((task) => [task.title, task]));
	assert.equal(byTitle.get("Setup").parentTaskId, byTitle.get("Feature").id);
	assert.deepEqual(JSON.parse(await cli(project, "task", "view", byTitle.get("Finish").id, "--json")).task.dependencies, [byTitle.get("Setup").id]);
	const approvalEdit = calls.find((args) => args[0] === "draft" && args[1] === "edit" && args.some((arg) => arg.includes("Published tickets:")));
	assert.ok(approvalEdit, "Approval and published IDs must be recorded before archiving");
	assert.ok(calls.indexOf(approvalEdit) < calls.findIndex((args) => args[0] === "draft" && args[1] === "archive"));
});

test("devflow-commit-backlog retries a pending scoped commit", async (t) => {
	assert.ok(existsSync(backlog), "Run npm install in pi-extensions/devflow first.");
	const project = await mkdtemp(path.join(os.tmpdir(), "devflow-commit-"));
	t.after(() => rm(project, { recursive: true, force: true }));
	await run("git", ["init", "--quiet"], { cwd: project });
	await configureGit(project);
	await cli(project, "init", "Commit contract", "--defaults", "--integration-mode", "none");
	await writeFile(path.join(project, "implementation.ts"), "export {};\n");
	await run("git", ["add", "implementation.ts"], { cwd: project });
	const hook = path.join(project, ".git", "hooks", "pre-commit");
	await writeFile(hook, "#!/bin/sh\nexit 1\n");
	await chmod(hook, 0o755);

	const { commands } = await workflowHarness();
	const command = commands.get("devflow-commit-backlog");
	assert.ok(command, "Extension did not register devflow-commit-backlog");
	const failed = commandContext(project);
	await command.handler("", failed.ctx);
	assert.equal(failed.notifications.at(-1).level, "error");
	await rm(hook);

	const retried = commandContext(project);
	await command.handler("", retried.ctx);
	assert.equal(retried.notifications.at(-1).level, "success");
	const committedFiles = (await run("git", ["show", "--format=", "--name-only", "HEAD"], { cwd: project })).stdout.trim().split("\n");
	assert.ok(committedFiles.every((file) => file.startsWith("backlog/")));
	assert.deepEqual((await run("git", ["diff", "--cached", "--name-only"], { cwd: project })).stdout.trim().split("\n"), ["implementation.ts"]);
});

test("devflow-init initializes and validates the required configuration idempotently", async (t) => {
	assert.ok(existsSync(backlog), "Run npm install in pi-extensions/devflow first.");
	const project = await mkdtemp(path.join(os.tmpdir(), "devflow-init-"));
	t.after(() => rm(project, { recursive: true, force: true }));
	await run("git", ["init", "--quiet"], { cwd: project });

	const { commands } = await workflowHarness();
	const command = commands.get("devflow-init");
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

test("devflow-init requires Git and never changes existing config without confirmation", async (t) => {
	const { commands } = await workflowHarness();
	const command = commands.get("devflow-init");
	const noGit = await mkdtemp(path.join(os.tmpdir(), "devflow-no-git-"));
	t.after(() => rm(noGit, { recursive: true, force: true }));
	const rejected = commandContext(noGit);
	await command.handler("", rejected.ctx);
	assert.match(rejected.notifications.at(-1).message, /requires a Git repository/);

	const project = await mkdtemp(path.join(os.tmpdir(), "devflow-reconcile-"));
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
