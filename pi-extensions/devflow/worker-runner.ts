import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } from "@earendil-works/pi-coding-agent";

const extensionPath = fileURLToPath(new URL("./index.ts", import.meta.url));
const outcomes = ["completed", "needs_human", "blocked", "failed"] as const;

type WorkerOutcome = typeof outcomes[number];
type WorkerUsage = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
};

export type ChildPiRequest = {
	cwd: string;
	prompt: string;
	model?: { provider: string; id: string };
	thinkingLevel?: string;
	readOnly?: boolean;
};

export type ChildPiResult = {
	exitCode: number;
	cancelled: boolean;
	outcome?: WorkerOutcome;
	output: string;
	stderr: string;
	usage: WorkerUsage;
	failure?: string;
};

export function implementerPrompt(taskId: string) {
	return `You are the implementation worker for Backlog.md ticket ${JSON.stringify(taskId)}.

1. Read the ticket with the backlog tool (operation: "task_view", id: ${JSON.stringify(taskId)}), including its newest review comments, and read all applicable project instructions and relevant code before changing anything.
2. Implement only the ticket's acceptance criteria; reuse existing patterns and keep the diff minimal. Do not change ticket status or make Git commits.
3. Run the ticket-required checks and the smallest relevant project checks. Do not report a failed or skipped required check as passing.
4. Assess documentation and durable-decision impact; update only material required by the ticket or project instructions.
5. Before ending, respond with one JSON object (no Markdown) containing: {"summary": string, "plan": string[], "modifiedFiles": string[], "acceptanceCriteria": [{"criterion": string, "status": "met"|"unmet", "evidence": string}], "checks": [{"command": string, "status": "passed"|"failed"|"not_run", "evidence": string}], "documentation": {"impact": "none"|"updated"|"needs_human", "evidence": string}, "blockers": string[]}.
6. Then call complete_transition exactly once as your final action: "completed" only when every criterion is met and required checks pass; "needs_human" for a specific human decision; "blocked" for an external blocker; otherwise "failed".`;
}

export function reviewerPrompt(taskId: string) {
	return `You are the read-only reviewer for Backlog.md ticket ${JSON.stringify(taskId)}.

1. Read the ticket with the backlog tool (operation: "task_view", id: ${JSON.stringify(taskId)}), its implementation evidence, and the relevant changed code.
2. Check every acceptance criterion. Before ending, respond with one JSON object (no Markdown): {"verdict": "approved"|"rework", "findings": string[]}; if you need a human decision instead, respond with {"request": string}. Use "rework" only for concrete required changes; use "approved" with an empty findings array when none remain. Do not modify files, Backlog.md, or Git state; your tools are read-only.
3. Then call complete_transition exactly once as your final action: "completed" when the review was completed, "needs_human" for a specific human decision, "blocked" for an external blocker, or "failed" when the review could not be completed.`;
}

export function reconcilerPrompt(featureId: string) {
	return `You are the read-only reconciliation worker for completed Backlog.md feature ${JSON.stringify(featureId)}.

1. Read the feature and its descendants with the backlog tool. Confirm every descendant task is Done, check the feature and parent acceptance criteria, inspect affected project documentation and durable technical decisions, and look for related Backlog.md tickets that remain relevant or conflicting.
2. Before ending, respond with one JSON object (no Markdown): {"summary": string, "checks": [{"area": "parent acceptance criteria"|"documentation"|"technical decisions"|"related tickets", "status": "passed", "evidence": string}]}. Include exactly one passed check for each area only when reconciliation is clean. If anything needs a human decision, respond with {"request": string} instead. Do not modify files, Backlog.md, or Git state; your tools are read-only.
3. Then call complete_transition exactly once as your final action: "completed" only when reconciliation is clean, "needs_human" for a specific human decision, "blocked" for an external blocker, or "failed" when reconciliation could not be completed.`;
}

function invocation() {
	const script = process.argv[1];
	if (script && !script.startsWith("/$bunfs/root/") && existsSync(script)) return { command: process.execPath, args: [script] };
	return /^(node|bun)(\.exe)?$/i.test(path.basename(process.execPath)) ? { command: "pi", args: [] } : { command: process.execPath, args: [] };
}

function text(content: unknown) {
	return Array.isArray(content)
		? content.filter((part): part is { type: "text"; text: string } => !!part && typeof part === "object" && (part as any).type === "text" && typeof (part as any).text === "string").map((part) => part.text).join("\n").trim()
		: "";
}

function bounded(output: string) {
	const result = truncateHead(output, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
	return result.truncated
		? `${result.content}\n\n[Output truncated: ${result.outputLines} of ${result.totalLines} lines (${formatSize(result.outputBytes)} of ${formatSize(result.totalBytes)}).]`
		: result.content;
}

function usage() {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
}

function addUsage(total: WorkerUsage, value: any) {
	for (const key of ["input", "output", "cacheRead", "cacheWrite"] as const) total[key] += Number(value?.[key]) || 0;
	total.totalTokens += Number(value?.totalTokens) || 0;
	for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"] as const) total.cost[key] += Number(value?.cost?.[key]) || 0;
}

export async function runChildPi({ cwd, prompt, model, thinkingLevel, readOnly }: ChildPiRequest, signal?: AbortSignal): Promise<ChildPiResult> {
	const child = invocation();
	const args = [...child.args, "--mode", "json", "-p", "--no-session", "--extension", extensionPath];
	if (readOnly) args.push("--tools", "read,grep,find,ls,backlog,complete_transition");
	if (model) args.push("--model", `${model.provider}/${model.id}`);
	if (thinkingLevel) args.push("--thinking", thinkingLevel);
	args.push("--", prompt);

	const result = await new Promise<ChildPiResult>((resolve) => {
		const totalUsage = usage();
		let stderr = "";
		let lastOutput = "";
		let outcome: WorkerOutcome | undefined;
		let completionError: string | undefined;
		let cancelled = false;
		let buffer = "";
		let killTimer: ReturnType<typeof setTimeout> | undefined;
		let settled = false;
		const finish = (exitCode: number, failure?: string) => {
			if (settled) return;
			settled = true;
			if (killTimer) clearTimeout(killTimer);
			signal?.removeEventListener("abort", abort);
			resolve({ exitCode, cancelled, outcome, output: bounded(lastOutput), stderr: bounded(stderr), usage: totalUsage, failure });
		};
		const proc = spawn(child.command, args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PI_DEVFLOW_WORKER: "1", PI_DEVFLOW_REVIEWER: readOnly ? "1" : "0" } });
		const abort = () => {
			cancelled = true;
			proc.kill("SIGTERM");
			killTimer = setTimeout(() => proc.kill("SIGKILL"), 5_000);
		};
		const parse = (line: string) => {
			if (!line.trim()) return;
			try {
				const event = JSON.parse(line);
				const message = event.type === "message_end" ? event.message : undefined;
				if (message?.role === "assistant") {
					const value = text(message.content);
					if (value) lastOutput = value;
					addUsage(totalUsage, message.usage);
				}
				if (message?.role === "toolResult" && message.toolName === "complete_transition") {
					const value = message.details?.outcome;
					if ((outcomes as readonly string[]).includes(value)) outcome = value;
					else completionError = "complete_transition returned an invalid outcome.";
					if (message.isError) completionError = text(message.content) || "complete_transition failed.";
				}
			} catch {
				// Pi may write non-JSON diagnostics; stderr captures fatal diagnostics.
			}
		};
		proc.stdout.on("data", (data) => {
			buffer += data;
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const line of lines) parse(line);
		});
		proc.stderr.on("data", (data) => { stderr += data; });
		proc.on("error", (error) => finish(1, `Could not start Pi worker: ${error.message}`));
		proc.on("close", (code) => {
			if (buffer.trim()) parse(buffer);
			if (cancelled) return finish(code ?? 1, "Worker cancelled.");
			if (code !== 0) return finish(code ?? 1, `Pi worker exited with code ${code ?? 1}.`);
			if (completionError) return finish(0, completionError);
			if (!outcome) return finish(0, "Pi worker ended without complete_transition.");
			finish(0);
		});
		if (signal?.aborted) abort();
		else signal?.addEventListener("abort", abort, { once: true });
	});
	return result;
}
