import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const packageRoot = path.join(repoRoot, "pi-extensions", "backlog-workflow");

test("backlog-workflow is a Pi package with its Backlog.md dependency", async () => {
	const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
	assert.deepEqual(manifest.pi.extensions, ["./index.ts"]);
	assert.equal(manifest.dependencies["backlog.md"], "^1.4.0");

	const extension = await import(`${pathToFileURL(path.join(packageRoot, "index.ts")).href}?t=${Date.now()}`);
	assert.equal(typeof extension.default, "function");
	assert.doesNotThrow(() => extension.default({}));
});
