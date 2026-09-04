import { readFile, access, writeFile } from "node:fs/promises";
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
	"draft_list", "draft_view", "draft_create", "draft_edit", "draft_archive", "draft_promote",
] as const;
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
});
type BacklogInput = Static<typeof BACKLOG_SCHEMA>;

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

export default function backlogWorkflowExtension(pi: ExtensionAPI) {
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

	pi.registerCommand("refine", {
		description: "Create or resume a Backlog.md refinement draft",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("refine requires interactive mode", "error");
				return;
			}

			const value = args.trim();
			if (!value) {
				ctx.ui.notify("Usage: /refine <idea-or-draft-id>", "error");
				return;
			}

			const root = await projectRoot(pi, ctx.cwd);
			try {
				let draftId: string;
				let created = false;
				if (/^DRAFT-\d+$/i.test(value)) {
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
				pi.sendUserMessage(`Refine Backlog.md draft ${draftId} in this main session. ${created ? "Start from its recorded intent." : "Read the existing draft first."} Ask focused questions, and use the backlog tool to record every accepted decision in the draft's description under "Accepted decisions". Keep \`Approval: pending\`; do not create or promote tasks yet.`);
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
			const root = await projectRoot(pi, ctx.cwd);
			const args = backlogArgs(input);
			const run = async () => {
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
