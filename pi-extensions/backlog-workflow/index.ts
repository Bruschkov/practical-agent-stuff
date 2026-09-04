import { readFile, access, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

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
}
