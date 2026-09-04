import { readFile, access, writeFile, readdir, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateHead,
	withFileMutationQueue,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { implementerPrompt, reviewerPrompt, reconcilerPrompt, runChildPi, type ChildPiRequest, type ChildPiResult } from "./worker-runner.ts";

export { implementerPrompt, reviewerPrompt, reconcilerPrompt, runChildPi, type ChildPiRequest, type ChildPiResult } from "./worker-runner.ts";

const cli = fileURLToPath(new URL(`./node_modules/.bin/backlog${process.platform === "win32" ? ".cmd" : ""}`, import.meta.url));
const configPaths = ["backlog.config.yml", "backlog/config.yml", ".backlog/config.yml"];
const statuses = ["Open", "In Progress", "In Review", "Rework", "Blocked", "Needs Human", "Done"];
const types = ["feature", "sub-feature", "task"];
const priorities = ["Critical", "High", "Medium", "Low"];
const definitionOfDone = [
	"Acceptance criteria are met",
	"Required checks pass or exceptions include a reason",
	"Required review and rework are complete",
	"Documentation and durable-decision impact is assessed",
	"Implementation summary modified files and evidence are recorded",
	"No unresolved dependency blocker or human request remains",
];
const operations = [
	"task_list", "task_view", "task_create", "task_edit", "task_archive",
	"draft_list", "draft_view", "draft_create", "draft_edit", "draft_archive", "draft_promote", "refinement_publish",
] as const;
const completeOutcomes = ["completed", "needs_human", "blocked", "failed"] as const;
const maxReworkAttempts = 2;
const PROPOSED_TASK_SCHEMA = Type.Object({
	key: Type.String({ minLength: 1, description: "Unique proposal-local task key." }),
	title: Type.String({ minLength: 1, description: "Ticket title." }),
	description: Type.String({ minLength: 1, description: "Ticket description." }),
	type: Type.String({ enum: types, description: "Workflow task type." }),
	priority: Type.Optional(Type.String({ enum: priorities, description: "Defaults to Medium." })),
	acceptanceCriteria: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, description: "Concrete completion checks." }),
	parentKey: Type.Optional(Type.String({ minLength: 1, description: "Proposal-local parent key." })),
	dependsOn: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { description: "Proposal-local prerequisite keys." })),
});
const COMPLETE_TRANSITION_SCHEMA = Type.Object({
	outcome: Type.String({ enum: completeOutcomes, description: "Final worker outcome." }),
});

type CompleteTransitionInput = Static<typeof COMPLETE_TRANSITION_SCHEMA>;

const BACKLOG_SCHEMA = Type.Object({
	operation: Type.String({ enum: operations, description: "Backlog.md operation to run." }),
	id: Type.Optional(Type.String({ description: "Task or draft ID for view, edit, archive, or promote." })),
	title: Type.Optional(Type.String({ description: "Title for a new task or draft, or replacement title when editing." })),
	description: Type.Optional(Type.String({ description: "Markdown description for create or edit." })),
	status: Type.Optional(Type.String({ description: "Configured status for create, edit, or task-list filtering." })),
	priority: Type.Optional(Type.String({ description: "Configured priority for create, edit, or task-list filtering." })),
	type: Type.Optional(Type.String({ description: "Configured task type for create, edit, or task-list filtering." })),
	parent: Type.Optional(Type.String({ description: "Parent task ID for task creation or list filtering." })),
	dependsOn: Type.Optional(Type.Array(Type.String(), { description: "Task IDs that a new task depends on." })),
	assignees: Type.Optional(Type.Array(Type.String(), { description: "Assignees for task or draft creation/editing." })),
	labels: Type.Optional(Type.Array(Type.String(), { description: "Labels for task or draft creation/editing." })),
	acceptanceCriteria: Type.Optional(Type.Array(Type.String(), { description: "Acceptance criteria for task creation or editing." })),
	comment: Type.Optional(Type.String({ description: "Comment to append while editing a task or draft." })),
	commentAuthor: Type.Optional(Type.String({ description: "Author for an appended comment." })),
	ready: Type.Optional(Type.Boolean({ description: "Only list ready tasks." })),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, description: "Maximum listed tasks." })),
	proposedTasks: Type.Optional(Type.Array(PROPOSED_TASK_SCHEMA, { minItems: 1, description: "Approved refinement tickets to publish." })),
});
type BacklogInput = Static<typeof BACKLOG_SCHEMA>;
type ProposedTask = Static<typeof PROPOSED_TASK_SCHEMA>;
type IncomingHandoff = { filePath: string; title: string; content: string };
type HandoffInbox = { status: string; handoffs: IncomingHandoff[]; processedDir?: string };
type WorkflowTask = {
	id: string; title?: string; status: string; type: string; isReady: boolean; subtasks: unknown[];
	assignees?: string[];
	readiness?: { isBlocked?: boolean };
	acceptanceCriteria: { index: number; text: string }[];
	comments?: { body: string; author: string }[];
};
type WorkflowTaskSummary = Pick<WorkflowTask, "id" | "title" | "status" | "type" | "isReady" | "assignees"> & { parentTaskId?: string | null; priority?: string; ordinal?: number };
type ImplementationEvidence = {
	summary: string; plan: string[]; modifiedFiles: string[];
	acceptanceCriteria: { criterion: string; status: "met" | "unmet"; evidence: string; index: number }[];
	checks: { command: string; status: "passed" | "failed" | "not_run"; evidence: string }[];
	documentation: { impact: "none" | "updated" | "needs_human"; evidence: string };
	blockers: string[];
};
type ReviewEvidence = { verdict: "approved" | "rework"; findings: string[] };
type ReconciliationEvidence = { summary: string; checks: { area: "parent acceptance criteria" | "documentation" | "technical decisions" | "related tickets"; status: "passed"; evidence: string }[] };

function yamlValue(value: string) {
	return JSON.stringify(value);
}

function yamlList(values: string[]) {
	return `[${values.map(yamlValue).join(", ")}]`;
}

function setYamlValue(yaml: string, key: string, value: string) {
	const entry = new RegExp(`^${key}:[^\\n]*(?:\\n[\\t ]+[^\\n]*)*`, "gm");
	let found = false;
	const updated = yaml.replace(entry, () => {
		if (found) return "";
		found = true;
		return `${key}: ${value}`;
	});
	return found ? updated : `${yaml.trimEnd()}\n${key}: ${value}\n`;
}

function desiredConfig(yaml: string) {
	yaml = setYamlValue(yaml, "default_status", yamlValue("Open"));
	yaml = setYamlValue(yaml, "statuses", yamlList(statuses));
	yaml = setYamlValue(yaml, "types", yamlList(types));
	yaml = setYamlValue(yaml, "priorities", yamlList(priorities));
	return setYamlValue(yaml, "definition_of_done", `\n${definitionOfDone.map((item) => `  - ${yamlValue(item)}`).join("\n")}`);
}

async function configPath(root: string) {
	for (const relativePath of configPaths) {
		const candidate = path.join(root, relativePath);
		try {
			await access(candidate);
			return candidate;
		} catch {
			// Try the next supported Backlog.md config location.
		}
	}
	throw new Error("Backlog.md found a project, but its config is not at backlog.config.yml, backlog/config.yml, or .backlog/config.yml.");
}

async function cliConfig(pi: ExtensionAPI, root: string, key: string) {
	const result = await pi.exec(cli, ["config", "get", key], { cwd: root, timeout: 10_000 });
	if (result.code !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || `Could not read '${key}'.`);
	return result.stdout.trim();
}

async function isInitialized(pi: ExtensionAPI, root: string) {
	const result = await pi.exec(cli, ["config", "get", "projectName"], { cwd: root, timeout: 10_000 });
	if (result.code === 0) return true;
	if (/No Backlog\.md project found/.test(`${result.stdout}\n${result.stderr}`)) return false;
	throw new Error(result.stderr.trim() || result.stdout.trim() || "Could not inspect Backlog.md.");
}

async function needsReconciliation(pi: ExtensionAPI, root: string) {
	const actual = await Promise.all(["defaultStatus", "statuses", "types", "priorities", "definitionOfDone"].map((key) => cliConfig(pi, root, key)));
	return actual.join("\n") !== ["Open", statuses.join(", "), types.join(", "), priorities.join(", "), definitionOfDone.join(", ")].join("\n");
}

function required(value: string | undefined, field: string) {
	if (!value?.trim()) throw new Error(`'${field}' is required for this operation.`);
	return value;
}

function append(args: string[], flag: string, values: string[] | undefined) {
	for (const value of values ?? []) args.push(flag, value);
}

function backlogArgs(input: BacklogInput) {
	const args = input.operation.startsWith("task_") ? ["task", input.operation.slice(5)] : ["draft", input.operation.slice(6)];
	const id = () => required(input.id, "id");
	const title = () => required(input.title, "title");

	switch (input.operation) {
		case "task_list":
			if (input.status) args.push("--status", input.status);
			if (input.priority) args.push("--priority", input.priority);
			if (input.type) args.push("--type", input.type);
			if (input.parent) args.push("--parent", input.parent);
			if (input.ready) args.push("--ready");
			if (input.limit) args.push("--limit", String(input.limit));
			return [...args, "--json"];
		case "task_view": return [...args, id(), "--json"];
		case "draft_list": return [...args, "--plain"];
		case "draft_view": return [...args, id(), "--plain"];
		case "task_archive":
		case "draft_archive":
		case "draft_promote": return [...args, id()];
		case "task_create":
		case "draft_create": args.push(title()); break;
		case "task_edit":
		case "draft_edit": args.push(id()); break;
	}

	if (input.title && !["task_create", "draft_create"].includes(input.operation)) args.push("--title", input.title);
	if (input.description) args.push("--description", input.description);
	if (input.status) args.push("--status", input.status);
	if (input.priority && input.operation !== "task_create") args.push("--priority", input.priority);
	if (input.type) args.push("--type", input.type);
	append(args, "--assignee", input.assignees);
	append(args, input.operation.endsWith("create") ? "--labels" : "--label", input.labels);
	append(args, "--ac", input.acceptanceCriteria);
	if (input.operation === "task_create") {
		args.push("--priority", input.priority ?? "Medium");
		if (input.parent) args.push("--parent", input.parent);
		append(args, "--depends-on", input.dependsOn);
	}
	if (input.comment) args.push("--comment", input.comment);
	if (input.commentAuthor) {
		if (!input.comment) throw new Error("'commentAuthor' requires 'comment'.");
		args.push("--comment-author", input.commentAuthor);
	}
	if (["task_edit", "draft_edit"].includes(input.operation) && args.length === 3) {
		throw new Error("An edit requires at least one changed field.");
	}
	return args;
}

function isWrite(operation: BacklogInput["operation"]) {
	return !["task_list", "task_view", "draft_list", "draft_view"].includes(operation);
}

function boundedOutput(output: string) {
	const truncation = truncateHead(output, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
	return {
		...truncation,
		text: truncation.truncated
			? `${truncation.content}\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).]`
			: truncation.content,
	};
}

async function projectRoot(pi: ExtensionAPI, cwd: string) {
	const result = await pi.exec("git", ["rev-parse", "--show-toplevel"], { cwd, timeout: 3_000 });
	return result.code === 0 && result.stdout.trim() ? result.stdout.trim() : cwd;
}

async function runBacklog(pi: ExtensionAPI, root: string, args: string[]) {
	const result = await pi.exec(cli, args, { cwd: root, timeout: 30_000 });
	const output = `${result.stdout}${result.stderr ? `${result.stdout ? "\n" : ""}${result.stderr}` : ""}`.trim();
	if (result.code !== 0) throw new Error(output || `backlog ${args.join(" ")} failed.`);
	return output;
}

async function featureChoices(pi: ExtensionAPI, root: string) {
	const tasks = JSON.parse(await runBacklog(pi, root, ["task", "list", "--type", "feature", "--json"])).tasks as WorkflowTaskSummary[];
	return tasks.sort((a, b) => (a.ordinal ?? Number.MAX_SAFE_INTEGER) - (b.ordinal ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id)).map((task) => ({
		id: task.id,
		label: `${task.id}: ${task.title ?? "Untitled"}`,
		description: `Feature (${task.status})`,
	}));
}

export function selectRunnableFeatureTask(tasks: WorkflowTaskSummary[], featureId: string) {
	const feature = tasks.find((task) => task.id === featureId);
	if (feature?.type !== "feature") return null;
	const children = new Map<string, WorkflowTaskSummary[]>();
	for (const task of tasks) if (task.parentTaskId) children.set(task.parentTaskId, [...(children.get(task.parentTaskId) ?? []), task]);
	const descendants = new Set<string>();
	for (const pending = [featureId]; pending.length;) {
		const id = pending.pop()!;
		for (const child of children.get(id) ?? []) if (!descendants.has(child.id)) descendants.add(child.id), pending.push(child.id);
	}
	const priorityRank = (task: WorkflowTaskSummary) => {
		const index = priorities.findIndex((priority) => priority.toLowerCase() === task.priority?.toLowerCase());
		return index < 0 ? priorities.length : index;
	};
	return tasks.filter((task) => descendants.has(task.id) && task.type === "task" && ["Rework", "Open"].includes(task.status) && task.isReady && !task.assignees?.includes("@human")).sort((a, b) =>
		["Rework", "Open"].indexOf(a.status) - ["Rework", "Open"].indexOf(b.status) ||
		priorityRank(a) - priorityRank(b) ||
		(a.ordinal ?? Number.MAX_SAFE_INTEGER) - (b.ordinal ?? Number.MAX_SAFE_INTEGER) ||
		(a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
	)[0]?.id ?? null;
}

async function runnableFeatureTask(pi: ExtensionAPI, root: string, featureId: string) {
	const tasks = JSON.parse(await runBacklog(pi, root, ["task", "list", "--json"])).tasks as WorkflowTaskSummary[];
	return selectRunnableFeatureTask(tasks, featureId);
}

function featureLeaves(tasks: WorkflowTaskSummary[], featureId: string) {
	const children = new Map<string, WorkflowTaskSummary[]>();
	for (const task of tasks) if (task.parentTaskId) children.set(task.parentTaskId, [...(children.get(task.parentTaskId) ?? []), task]);
	const descendants = new Set<string>();
	for (const pending = [featureId]; pending.length;) {
		const id = pending.pop()!;
		for (const child of children.get(id) ?? []) if (!descendants.has(child.id)) descendants.add(child.id), pending.push(child.id);
	}
	return tasks.filter((task) => descendants.has(task.id) && task.type === "task");
}

async function featureReadyForReconciliation(pi: ExtensionAPI, root: string, featureId: string) {
	const tasks = JSON.parse(await runBacklog(pi, root, ["task", "list", "--json"])).tasks as WorkflowTaskSummary[];
	const leaves = featureLeaves(tasks, featureId);
	return leaves.length > 0 && leaves.every((task) => task.status === "Done");
}

function implementationEvidence(output: string, task: WorkflowTask): ImplementationEvidence {
	let value: any;
	try { value = JSON.parse(output); } catch { throw new Error("Worker did not return its required JSON evidence."); }
	if (!value || typeof value !== "object" || typeof value.summary !== "string" || !Array.isArray(value.plan) || !Array.isArray(value.modifiedFiles) || !Array.isArray(value.acceptanceCriteria) || !Array.isArray(value.checks) || !Array.isArray(value.blockers) || !value.documentation) throw new Error("Worker returned incomplete JSON evidence.");
	if (![value.plan, value.modifiedFiles, value.blockers].every((items) => items.every((item: unknown) => typeof item === "string")) || !["none", "updated", "needs_human"].includes(value.documentation.impact) || typeof value.documentation.evidence !== "string") throw new Error("Worker returned invalid JSON evidence.");
	const used = new Set<number>();
	const acceptanceCriteria = value.acceptanceCriteria.map((item: any) => {
		if (!item || typeof item.criterion !== "string" || !["met", "unmet"].includes(item.status) || typeof item.evidence !== "string") throw new Error("Worker returned invalid acceptance-criteria evidence.");
		const index = task.acceptanceCriteria.findIndex((criterion) => criterion.text === item.criterion && !used.has(criterion.index));
		if (index < 0) throw new Error(`Worker reported an unknown acceptance criterion: ${item.criterion}`);
		used.add(task.acceptanceCriteria[index].index);
		return { ...item, index: task.acceptanceCriteria[index].index };
	});
	const checks = value.checks.map((item: any) => {
		if (!item || typeof item.command !== "string" || !["passed", "failed", "not_run"].includes(item.status) || typeof item.evidence !== "string") throw new Error("Worker returned invalid check evidence.");
		return item;
	});
	return { ...value, acceptanceCriteria, checks };
}

function completedEvidence(evidence: ImplementationEvidence, task: WorkflowTask) {
	return task.acceptanceCriteria.every((criterion) => evidence.acceptanceCriteria.some((item) => item.index === criterion.index && item.status === "met")) && evidence.checks.every((check) => check.status === "passed");
}

function reviewEvidence(output: string): ReviewEvidence {
	let value: any;
	try { value = JSON.parse(output); } catch { throw new Error("Reviewer did not return its required JSON evidence."); }
	if (!value || !["approved", "rework"].includes(value.verdict) || !Array.isArray(value.findings) || !value.findings.every((finding: unknown) => typeof finding === "string") || (value.verdict === "approved" && value.findings.length) || (value.verdict === "rework" && !value.findings.length)) throw new Error("Reviewer returned invalid JSON evidence.");
	return value;
}

function reconciliationEvidence(output: string): ReconciliationEvidence {
	let value: any;
	try { value = JSON.parse(output); } catch { throw new Error("Reconciler did not return its required JSON evidence."); }
	const areas = ["parent acceptance criteria", "documentation", "technical decisions", "related tickets"];
	if (!value || typeof value.summary !== "string" || !Array.isArray(value.checks) || value.checks.length !== areas.length || !value.checks.every((check: any) => check && areas.includes(check.area) && check.status === "passed" && typeof check.evidence === "string") || new Set(value.checks.map((check: any) => check.area)).size !== areas.length) throw new Error("Reconciler returned invalid JSON evidence.");
	return value;
}

async function persistReview(pi: ExtensionAPI, root: string, task: WorkflowTask, review: ReviewEvidence) {
	const comment = ["## Automated review", `Verdict: ${review.verdict}`, "## Findings", ...(review.findings.length ? review.findings.map((finding) => `- ${finding}`) : ["- None"])].join("\n");
	await runBacklog(pi, root, ["task", "edit", task.id, "--comment", comment, "--comment-author", "@reviewer"]);
}

async function reconcileFeature(pi: ExtensionAPI, root: string, featureId: string, ctx: any) {
	const result = await runChildPi({ cwd: root, prompt: reconcilerPrompt(featureId), model: ctx.model ? { provider: ctx.model.provider, id: ctx.model.id } : undefined, thinkingLevel: ctx.thinkingLevel, readOnly: true });
	if (result.failure || !result.outcome) throw new Error(result.failure || "Reconciler did not return an outcome.");
	if (result.outcome === "needs_human") {
		await requestHuman(pi, root, featureId, requestText(result.output), ctx);
		return "needs_human";
	}
	if (result.outcome !== "completed") throw new Error(`Reconciliation did not complete: ${result.outcome}.`);
	const evidence = reconciliationEvidence(result.output);
	const comment = ["## Reconciliation", evidence.summary, "## Checks", ...evidence.checks.map((check) => `- ${check.area}: ${check.evidence}`), "## Usage", JSON.stringify(result.usage)].join("\n");
	await runBacklog(pi, root, ["task", "edit", featureId, "--status", "In Review", "--comment", comment, "--comment-author", "@reconciler"]);
	return "completed";
}

function reworkAttempts(task: WorkflowTask) {
	return Math.max(0, ...(task.comments ?? []).filter((comment) => comment.author === "@workflow").map((comment) => Number(comment.body.match(new RegExp(`Rework attempt: (\\d+)/${maxReworkAttempts}`))?.[1]) || 0));
}

async function persistImplementation(pi: ExtensionAPI, root: string, task: WorkflowTask, evidence: ImplementationEvidence, result: { outcome: string; usage: unknown }, status: string) {
	const notes = [
		`Worker outcome: ${result.outcome}`,
		"## Acceptance criteria",
		...evidence.acceptanceCriteria.map((criterion) => `- ${criterion.status}: ${criterion.criterion}\n  ${criterion.evidence}`),
		"## Checks",
		...evidence.checks.map((check) => `- ${check.status}: ${check.command}\n  ${check.evidence}`),
		"## Documentation",
		`${evidence.documentation.impact}: ${evidence.documentation.evidence}`,
		"## Blockers",
		...(evidence.blockers.length ? evidence.blockers.map((blocker) => `- ${blocker}`) : ["- None"]),
		"## Usage",
		JSON.stringify(result.usage),
	].join("\n");
	const args = ["task", "edit", task.id, "--status", status, "--plan", evidence.plan.map((step) => `- ${step}`).join("\n"), "--notes", notes, "--final-summary", evidence.summary];
	for (const file of evidence.modifiedFiles) args.push("--modified-file", file);
	for (const criterion of evidence.acceptanceCriteria.filter((item) => item.status === "met")) args.push("--check-ac", String(criterion.index));
	await runBacklog(pi, root, args);
}

function requestText(output: string) {
	try {
		const value = JSON.parse(output);
		if (typeof value?.request === "string" && value.request.trim()) return value.request.trim();
	} catch { /* Worker output may be plain text. */ }
	return output.trim() || "Worker requested a human decision.";
}

async function resolveHumanRequest(pi: ExtensionAPI, root: string, taskId: string, answer: string) {
	await runBacklog(pi, root, ["task", "edit", taskId, "--status", "Open", "--assignee", "", "--comment", `## Human response\n${answer.trim()}`, "--comment-author", "@human"]);
}

async function requestHuman(pi: ExtensionAPI, root: string, taskId: string, request: string, ctx: any) {
	await runBacklog(pi, root, ["task", "edit", taskId, "--status", "Needs Human", "--assignee", "@human", "--comment", `## Human request\n${request}\n\nResponse: pending`, "--comment-author", "@workflow"]);
	if (!ctx.hasUI) return false;
	const answer = await ctx.ui.input(`Human input required: ${taskId}`, request);
	if (!answer?.trim()) return false;
	await resolveHumanRequest(pi, root, taskId, answer);
	return true;
}

function humanRequest(task: WorkflowTask) {
	return [...(task.comments ?? [])].reverse().find((comment) => comment.author === "@workflow" && comment.body.includes("## Human request"))?.body
		?? "This ticket requires human input. Review its workflow comments for details.";
}

function handoffFromFile(filePath: string, content: string): IncomingHandoff | null {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n\r?\n# (.+?)\r?\n/);
	if (!match || !/^status:\s*"inbox"\s*$/m.test(match[1])) return null;
	return { filePath, title: match[2], content };
}

async function incomingHandoffs(root: string): Promise<HandoffInbox> {
	const configFile = path.join(root, ".backlog-handoff", "config.json");
	try {
		const config = JSON.parse(await readFile(configFile, "utf8"));
		if (typeof config.projectId !== "string" || typeof config.metaRoot !== "string") throw new Error("config requires projectId and metaRoot strings");
		const registryDir = path.join(path.resolve(root, config.metaRoot), ".backlog-handoff", "projects");
		const entries = await readdir(registryDir);
		let handoffDir = ".backlog-handoff/inbox";
		for (const entry of entries.filter((entry) => entry.endsWith(".json"))) {
			const project = JSON.parse(await readFile(path.join(registryDir, entry), "utf8"));
			if (project.id === config.projectId && typeof project.handoffDir === "string") handoffDir = project.handoffDir;
		}
		const inboxDir = path.join(root, handoffDir);
		const files = await readdir(inboxDir, { withFileTypes: true });
		const handoffs = (await Promise.all(files.filter((file) => file.isFile() && file.name.endsWith(".md")).map(async (file) =>
			handoffFromFile(path.join(inboxDir, file.name), await readFile(path.join(inboxDir, file.name), "utf8")),
		))).filter((handoff): handoff is IncomingHandoff => handoff !== null);
		return { status: `backlog-handoff available: ${handoffs.length} inbox item${handoffs.length === 1 ? "" : "s"}`, handoffs, processedDir: path.join(root, ".backlog-handoff", "processed") };
	} catch (error: any) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "backlog-handoff unavailable (not configured)", handoffs: [] };
		return { status: `backlog-handoff unavailable (${error?.message ?? String(error)})`, handoffs: [] };
	}
}

function handoffMarker(root: string, handoff: IncomingHandoff) {
	return `<!-- backlog-handoff: ${JSON.stringify(path.relative(root, handoff.filePath))} -->`;
}

function draftHandoffPath(draft: string) {
	const match = draft.match(/^<!-- backlog-handoff: (.+) -->$/m);
	if (!match) return null;
	try {
		const file = JSON.parse(match[1]);
		return typeof file === "string" ? file : null;
	} catch {
		return null;
	}
}

function handoffDraftDescription(root: string, handoff: IncomingHandoff) {
	return `## Intent\n${handoff.title}\n\n## Incoming Backlog Handoff\n${handoffMarker(root, handoff)}\n\nSource file: \`${path.relative(root, handoff.filePath)}\`\n\n### Original handoff\n${handoff.content}\n\n## Accepted decisions\n- Intent: ${handoff.title}\n\nApproval: pending`;
}

async function movePublishedHandoff(root: string, draft: string) {
	const file = draftHandoffPath(draft);
	if (!file) return null;
	const inbox = await incomingHandoffs(root);
	const handoff = inbox.handoffs.find((item) => path.relative(root, item.filePath) === file);
	if (!handoff || !inbox.processedDir) return "Handoff remains in inbox: it is no longer available through backlog-handoff.";
	try {
		await mkdir(inbox.processedDir, { recursive: true });
		await rename(handoff.filePath, path.join(inbox.processedDir, path.basename(handoff.filePath)));
		return `Moved handoff to ${inbox.processedDir}.`;
	} catch (error: any) {
		return `Handoff remains in inbox: ${error?.message ?? String(error)}`;
	}
}

function validateProposal(tasks: ProposedTask[]) {
	const byKey = new Map(tasks.map((task) => [task.key, task]));
	if (byKey.size !== tasks.length) throw new Error("Proposed task keys must be unique.");
	for (const task of tasks) {
		const parent = task.parentKey && byKey.get(task.parentKey);
		if (task.parentKey && !parent) throw new Error(`Unknown parentKey '${task.parentKey}' for '${task.key}'.`);
		if (task.type === "feature" ? task.parentKey : !task.parentKey) throw new Error(`${task.type} '${task.key}' has an invalid parent.`);
		if (parent && !((task.type === "sub-feature" && parent.type === "feature") || (task.type === "task" && ["feature", "sub-feature"].includes(parent.type)))) {
			throw new Error(`'${task.key}' has an invalid ${task.type} parent.`);
		}
		for (const dependency of task.dependsOn ?? []) {
			if (!byKey.has(dependency) || dependency === task.key) throw new Error(`Invalid dependency '${dependency}' for '${task.key}'.`);
		}
	}
	return byKey;
}

async function publishRefinement(pi: ExtensionAPI, root: string, input: BacklogInput, ctx: any) {
	const draftId = required(input.id, "id");
	const tasks = input.proposedTasks;
	if (!tasks?.length) throw new Error("'proposedTasks' is required for refinement_publish.");
	if (!ctx.hasUI) throw new Error("refinement_publish requires interactive mode.");
	validateProposal(tasks);
	const draft = await runBacklog(pi, root, ["draft", "view", draftId, "--plain"]);
	if (!await ctx.ui.confirm("Publish refinement?", `Draft: ${draftId}\nCreate ${tasks.length} proposed ticket${tasks.length === 1 ? "" : "s"} and archive the draft?`)) {
		return "Publication cancelled; draft remains pending.";
	}

	const ids = new Map<string, string>();
	let published = false;
	try {
		while (ids.size < tasks.length) {
			let created = false;
			for (const task of tasks) {
				if (ids.has(task.key) || (task.parentKey && !ids.has(task.parentKey))) continue;
				const args = ["task", "create", task.title, "--description", task.description, "--type", task.type, "--priority", task.priority ?? "Medium"];
				if (task.parentKey) args.push("--parent", ids.get(task.parentKey)!);
				append(args, "--ac", task.acceptanceCriteria);
				const output = await runBacklog(pi, root, args);
				const match = output.match(/Created task (\S+)/);
				if (!match) throw new Error(`Could not determine the created task ID: ${output}`);
				ids.set(task.key, match[1]);
				created = true;
			}
			if (!created) throw new Error("Proposed task parents form a cycle.");
		}
		for (const task of tasks) {
			if (task.dependsOn?.length) await runBacklog(pi, root, ["task", "edit", ids.get(task.key)!, "--depends-on", ...task.dependsOn.map((key) => ids.get(key)!)]);
		}
		const publishedTickets = tasks.map((task) => `- ${task.key}: ${ids.get(task.key)}`).join("\n");
		await runBacklog(pi, root, ["draft", "edit", draftId, "--comment", `Approval: approved\n\nPublished tickets:\n${publishedTickets}`, "--comment-author", "@human"]);
		await runBacklog(pi, root, ["draft", "archive", draftId]);
		published = true;
		const handoffResult = await movePublishedHandoff(root, draft);
		return `Published and archived ${draftId}: ${[...ids.values()].join(", ")}${handoffResult ? `\n${handoffResult}` : ""}`;
	} catch (error) {
		if (ids.size && !published) await runBacklog(pi, root, ["draft", "edit", draftId, "--comment", `Publication failed after creating: ${[...ids.values()].join(", ")}`, "--comment-author", "@workflow"]);
		throw error;
	}
}

export default function backlogWorkflowExtension(pi: ExtensionAPI) {
	let featureCompletions: AutocompleteItem[] = [];
	const refreshFeatureCompletions = async (cwd: string) => {
		try {
			const choices = await featureChoices(pi, await projectRoot(pi, cwd));
			featureCompletions = choices.map(({ id, label, description }) => ({ value: id, label, description }));
		} catch {
			featureCompletions = [];
		}
	};
	pi.on("session_start", async (_event, ctx) => refreshFeatureCompletions(ctx.cwd));

	if (process.env.PI_BACKLOG_WORKFLOW_WORKER === "1") {
		pi.registerTool({
			name: "complete_transition",
			label: "Complete Transition",
			description: "Finish this workflow-worker run with its validated outcome.",
			promptSnippet: "Finish the workflow worker with a terminating outcome",
			promptGuidelines: ["Use complete_transition exactly once as the workflow worker's final action."],
			parameters: COMPLETE_TRANSITION_SCHEMA,
			async execute(_toolCallId, input: CompleteTransitionInput) {
				return {
					content: [{ type: "text" as const, text: `Worker outcome: ${input.outcome}` }],
					details: { outcome: input.outcome },
					terminate: true,
				};
			},
		});
	}

	pi.registerCommand("workflow-init", {
		description: "Initialize or reconcile the Backlog.md workflow configuration",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("workflow-init requires interactive mode", "error");
				return;
			}

			const git = await pi.exec("git", ["rev-parse", "--show-toplevel"], { cwd: ctx.cwd, timeout: 3_000 });
			if (git.code !== 0 || !git.stdout.trim()) {
				ctx.ui.notify("workflow-init requires a Git repository", "error");
				return;
			}
			const root = git.stdout.trim();

			try {
				const initialized = await isInitialized(pi, root);
				let approved = false;
				if (!initialized) {
					const ok = await ctx.ui.confirm("Initialize Backlog.md?", `Project root: ${root}\nBacklog.md config: backlog/config.yml\nThe workflow configuration will be installed.`);
					if (!ok) return void ctx.ui.notify("Cancelled", "info");
					approved = true;
					const result = await pi.exec(cli, ["init", path.basename(root), "--defaults", "--integration-mode", "none"], { cwd: root, timeout: 30_000 });
					if (result.code !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || "Backlog.md initialization failed.");
				}

				const file = await configPath(root);
				const current = await readFile(file, "utf8");
				if (await needsReconciliation(pi, root)) {
					if (!approved && !await ctx.ui.confirm("Reconcile Backlog.md workflow?", `Config: ${file}\nStatuses, types, priorities, default status, and Definition of Done will be replaced.`)) {
						return void ctx.ui.notify("Cancelled", "info");
					}
					await writeFile(file, desiredConfig(current), "utf8");
					if (await needsReconciliation(pi, root)) throw new Error(`Backlog.md configuration remains incompatible: ${file}`);
				}
				ctx.ui.notify("Backlog.md workflow is ready", "success");
			} catch (error: any) {
				ctx.ui.notify(`workflow-init failed: ${error?.message ?? String(error)}`, "error");
			}
		},
	});

	pi.registerCommand("workflow-inbox", {
		description: "List and resolve pending human requests",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return void ctx.ui.notify("workflow-inbox requires interactive mode", "error");
			const root = await projectRoot(pi, ctx.cwd);
			try {
				const tasks = JSON.parse(await runBacklog(pi, root, ["task", "list", "--status", "Needs Human", "--json"])).tasks as WorkflowTask[];
				if (!tasks.length) return void ctx.ui.notify("No pending human requests", "info");
				const choices = new Map(tasks.map((task) => [`${task.id}: ${task.title ?? "Untitled"}`, task.id]));
				const choice = await ctx.ui.select("Pending human requests", [...choices.keys()]);
				if (!choice) return;
				const taskId = choices.get(choice)!;
				const task = JSON.parse(await runBacklog(pi, root, ["task", "view", taskId, "--json"])).task as WorkflowTask;
				const answer = await ctx.ui.input(`Human input required: ${task.id}`, humanRequest(task));
				if (!answer?.trim()) return void ctx.ui.notify(`${task.id}: remains Needs Human`, "info");
				await resolveHumanRequest(pi, root, task.id, answer);
				ctx.ui.notify(`${task.id}: human response recorded`, "success");
			} catch (error: any) {
				ctx.ui.notify(`workflow-inbox failed: ${error?.message ?? String(error)}`, "error");
			}
		},
	});

	pi.registerCommand("implement-run", {
		description: "Run one ready leaf task or select a feature descendant in an isolated implementation worker",
		getArgumentCompletions: (prefix) => {
			const query = prefix.trim().toLowerCase();
			const matches = featureCompletions.filter((item) => item.value.toLowerCase().startsWith(query) || item.label.toLowerCase().includes(query));
			return matches.length ? matches : null;
		},
		handler: async function implementRun(args, ctx) {
			let requestedId = args.trim();
			const root = await projectRoot(pi, ctx.cwd);
			if (!requestedId) {
				if (!ctx.hasUI) return void ctx.ui.notify("implement-run without an ID requires interactive feature selection", "error");
				const choices = await featureChoices(pi, root);
				featureCompletions = choices.map(({ id, label, description }) => ({ value: id, label, description }));
				if (!choices.length) return void ctx.ui.notify("No features available", "info");
				const selected = await ctx.ui.select("Select a feature", choices.map((choice) => choice.label));
				if (!selected) return;
				requestedId = choices.find((choice) => choice.label === selected)!.id;
			}
			let taskId = requestedId;
			let started = false;
			try {
				const requestedTask = JSON.parse(await runBacklog(pi, root, ["task", "view", requestedId, "--json"])).task as WorkflowTask;
				if (requestedTask.type === "feature") {
					taskId = await runnableFeatureTask(pi, root, requestedId) ?? "";
					if (!taskId) {
						if (!await featureReadyForReconciliation(pi, root, requestedId)) return void ctx.ui.notify(`${requestedId}: no runnable descendant leaf tasks`, "info");
						const outcome = await reconcileFeature(pi, root, requestedId, ctx);
						return void ctx.ui.notify(`${requestedId}: ${outcome === "completed" ? "reconciliation complete" : "Needs Human"}`, outcome === "completed" ? "success" : "warning");
					}
				}
				const task = taskId === requestedId ? requestedTask : JSON.parse(await runBacklog(pi, root, ["task", "view", taskId, "--json"])).task as WorkflowTask;
				if (task.type !== "task" || !["Open", "Rework"].includes(task.status) || !task.isReady || task.readiness?.isBlocked || task.assignees?.includes("@human") || task.subtasks.length) throw new Error(`${taskId} is not a ready, unblocked leaf task.`);
				let attempt = reworkAttempts(task);
				const implement = async (rework = false) => {
					await runBacklog(pi, root, ["task", "edit", task.id, "--status", "In Progress", "--comment", rework ? `Rework implementation worker started (attempt ${attempt} of ${maxReworkAttempts}).` : "Implementation worker started.", "--comment-author", "@workflow"]);
					started = true;
					const result = await runChildPi({ cwd: root, prompt: implementerPrompt(task.id), model: ctx.model ? { provider: ctx.model.provider, id: ctx.model.id } : undefined, thinkingLevel: ctx.thinkingLevel });
					if (result.failure || !result.outcome) throw new Error(result.failure || "Worker did not return an outcome.");
					const evidence = implementationEvidence(result.output, task);
					if (result.outcome === "completed" && !completedEvidence(evidence, task)) throw new Error("Worker marked completion without meeting every criterion and check.");
					const status = result.outcome === "completed" ? "In Review" : result.outcome === "blocked" ? "Blocked" : result.outcome === "needs_human" ? "Needs Human" : "Open";
					await persistImplementation(pi, root, task, evidence, result, status);
					started = false;
					if (result.outcome === "needs_human") {
						const answered = await requestHuman(pi, root, task.id, evidence.blockers.join("\n") || evidence.summary, ctx);
						ctx.ui.notify(`${task.id}: ${answered ? "human response recorded" : "Needs Human"}`, answered ? "success" : "warning");
						return result.outcome;
					}
					return result.outcome;
				};

				const initialOutcome = await implement();
				if (initialOutcome !== "completed") {
					if (requestedTask.type === "feature" && ["blocked", "needs_human"].includes(initialOutcome)) return implementRun(requestedId, ctx);
					return void ctx.ui.notify(`${task.id}: implementation did not complete`, "warning");
				}
				while (true) {
					const review = await runChildPi({ cwd: root, prompt: reviewerPrompt(task.id), model: ctx.model ? { provider: ctx.model.provider, id: ctx.model.id } : undefined, thinkingLevel: ctx.thinkingLevel, readOnly: true });
					if (review.failure || !review.outcome) {
						ctx.ui.notify(`${task.id}: review failed: ${review.failure || "Worker did not return an outcome."}`, "error");
						if (requestedTask.type === "feature") return implementRun(requestedId, ctx);
						return;
					}
					if (review.outcome !== "completed") {
						if (review.outcome === "needs_human") {
							const answered = await requestHuman(pi, root, task.id, requestText(review.output), ctx);
							ctx.ui.notify(`${task.id}: ${answered ? "human response recorded" : "Needs Human"}`, answered ? "success" : "warning");
							if (requestedTask.type === "feature") return implementRun(requestedId, ctx);
							return;
						}
						ctx.ui.notify(`${task.id}: In Review (${review.outcome})`, "warning");
						if (requestedTask.type === "feature") return implementRun(requestedId, ctx);
						return;
					}
					const evidence = reviewEvidence(review.output);
					await persistReview(pi, root, task, evidence);
					if (evidence.verdict === "approved") {
						await runBacklog(pi, root, ["task", "edit", task.id, "--status", "Done"]);
						ctx.ui.notify(`${task.id}: Done`, "success");
						if (requestedTask.type === "feature") return implementRun(requestedId, ctx);
						return;
					}
					if (attempt >= maxReworkAttempts) {
						await runBacklog(pi, root, ["task", "edit", task.id, "--status", "Needs Human", "--assignee", "@human", "--comment", `Rework cap reached after ${maxReworkAttempts} attempts. Review findings are recorded above.`, "--comment-author", "@workflow"]);
						ctx.ui.notify(`${task.id}: Needs Human (rework cap reached)`, "warning");
						if (requestedTask.type === "feature") return implementRun(requestedId, ctx);
						return;
					}
					attempt += 1;
					await runBacklog(pi, root, ["task", "edit", task.id, "--status", "Rework", "--comment", `Rework attempt: ${attempt}/${maxReworkAttempts}.`, "--comment-author", "@workflow"]);
					const reworkOutcome = await implement(true);
					if (reworkOutcome !== "completed") {
						if (requestedTask.type === "feature" && ["blocked", "needs_human"].includes(reworkOutcome)) return implementRun(requestedId, ctx);
						return void ctx.ui.notify(`${task.id}: implementation did not complete`, "warning");
					}
				}
			} catch (error: any) {
				if (started) {
					try {
						await runBacklog(pi, root, ["task", "edit", taskId, "--status", "Open", "--comment", `Implementation failed: ${error?.message ?? String(error)}`, "--comment-author", "@workflow"]);
					} catch { /* Preserve the original failure when recovery also fails. */ }
				}
				ctx.ui.notify(`implement-run failed: ${error?.message ?? String(error)}`, "error");
			}
		},
	});

	pi.registerCommand("refine", {
		description: "Create or resume a Backlog.md refinement draft",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("refine requires interactive mode", "error");
				return;
			}

			let value = args.trim();
			const root = await projectRoot(pi, ctx.cwd);
			try {
				let selectedHandoff: IncomingHandoff | undefined;
				if (!value) {
					const [drafts, inbox] = await Promise.all([
						runBacklog(pi, root, ["draft", "list", "--plain"]),
						incomingHandoffs(root),
					]);
					ctx.ui.notify(inbox.status, inbox.handoffs.length ? "info" : "warning");
					const choices = new Map<string, string | IncomingHandoff>();
					for (const line of drafts.split("\n")) {
						const match = line.match(/^(DRAFT-\d+)\b/i);
						if (match) choices.set(`Draft: ${line}`, match[1].toUpperCase());
					}
					for (const handoff of inbox.handoffs) choices.set(`Handoff: ${handoff.title} (${path.relative(root, handoff.filePath)})`, handoff);
					if (!choices.size) {
						ctx.ui.notify("No active drafts or incoming handoffs. Use /refine <idea> to start one.", "info");
						return;
					}
					const choice = await ctx.ui.select("Select a refinement", [...choices.keys()]);
					if (!choice) return;
					const selected = choices.get(choice)!;
					if (typeof selected === "string") value = selected;
					else selectedHandoff = selected;
				}

				let draftId: string;
				let created = false;
				if (selectedHandoff) {
					const output = await runBacklog(pi, root, ["draft", "create", selectedHandoff.title, "--description", handoffDraftDescription(root, selectedHandoff)]);
					const match = output.match(/Created draft (\S+)/);
					if (!match) throw new Error(`Could not determine the created draft ID: ${output}`);
					draftId = match[1];
					created = true;
				} else if (/^DRAFT-\d+$/i.test(value)) {
					draftId = value.toUpperCase();
					await runBacklog(pi, root, ["draft", "view", draftId, "--plain"]);
				} else {
					const output = await runBacklog(pi, root, [
						"draft", "create", value,
						"--description", `## Intent\n${value}\n\n## Accepted decisions\n- Intent: ${value}\n\nApproval: pending`,
					]);
					const match = output.match(/Created draft (\S+)/);
					if (!match) throw new Error(`Could not determine the created draft ID: ${output}`);
					draftId = match[1];
					created = true;
				}

				ctx.ui.notify(`${created ? "Created" : "Resuming"} refinement draft ${draftId}`, "success");
				pi.sendUserMessage(`Refine Backlog.md draft ${draftId} in this main session. ${selectedHandoff ? "The draft contains an incoming backlog-handoff; preserve its metadata and original request while refining it." : created ? "Start from its recorded intent." : "Read the existing draft first."} Ask focused questions, then propose intent, concrete acceptance criteria, and a feature/sub-feature/task hierarchy with priorities and dependencies. Record every accepted decision and the full proposal in the draft's description under "Accepted decisions". Keep \`Approval: pending\` and do not create or promote tasks. Only after the user explicitly approves the displayed proposal, call backlog with \`operation: "refinement_publish"\`, the draft ID, and matching \`proposedTasks\`; it will ask final confirmation, publish tickets, record their IDs, archive the draft, and then move any linked handoff to processed.`);
			} catch (error: any) {
				ctx.ui.notify(`refine failed: ${error?.message ?? String(error)}`, "error");
			}
		},
	});

	pi.registerTool({
		name: "backlog",
		label: "Backlog",
		description: `Read and update this project's Backlog.md tickets and drafts through the package-local CLI. Output is limited to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}.`,
		promptSnippet: "Read and update Backlog.md tasks and drafts through the package-local CLI",
		promptGuidelines: ["Use backlog rather than shell commands to read or update Backlog.md tickets and drafts."],
		parameters: BACKLOG_SCHEMA,
		async execute(_toolCallId, input: BacklogInput, signal, _onUpdate, ctx) {
			if (process.env.PI_BACKLOG_WORKFLOW_REVIEWER === "1" && isWrite(input.operation)) throw new Error("Reviewer workers may only read Backlog.md.");
			const root = await projectRoot(pi, ctx.cwd);
			const run = async () => {
				if (input.operation === "refinement_publish") {
					const text = await publishRefinement(pi, root, input, ctx);
					return { content: [{ type: "text" as const, text }], details: { operation: input.operation, args: [], truncated: false } };
				}
				const args = backlogArgs(input);
				const result = await pi.exec(cli, args, { cwd: root, signal, timeout: isWrite(input.operation) ? 30_000 : 10_000 });
				const output = `${result.stdout}${result.stderr ? `${result.stdout ? "\n" : ""}${result.stderr}` : ""}`;
				const bounded = boundedOutput(output);
				if (result.code !== 0) throw new Error(bounded.text.trim() || `backlog ${args.join(" ")} failed.`);
				return {
					content: [{ type: "text" as const, text: bounded.text.trim() || "Backlog command completed." }],
					details: { operation: input.operation, args, truncated: bounded.truncated },
				};
			};
			return isWrite(input.operation)
				? withFileMutationQueue(path.join(root, "backlog"), run)
				: run();
		},
	});
}
