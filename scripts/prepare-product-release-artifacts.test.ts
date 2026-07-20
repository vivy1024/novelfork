import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { prepareEmbeddedProductMigrationData } from "./lib/prepare-product-release-artifacts.ts";

let workspaceRoot: string;

async function write(path: string, content: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, content);
}

function migrationsRoot(): string {
	return join(
		workspaceRoot,
		"packages",
		"novelfork-product-runtime",
		"src",
		"db",
		"migrations",
	);
}

beforeEach(async () => {
	workspaceRoot = await mkdtemp(join(tmpdir(), "novelfork-product-release-artifacts-test-"));
});

afterEach(async () => {
	await rm(workspaceRoot, { recursive: true, force: true });
});

describe("Product release artifact preparation", () => {
	test("embeds sorted product SQL migrations into only the disposable workspace", async () => {
		await write(join(migrationsRoot(), "0010_later.sql"), "CREATE TABLE later (id integer);");
		await write(join(migrationsRoot(), "0000_initial.sql"), "CREATE TABLE initial (id integer);");
		await write(join(migrationsRoot(), "README.md"), "not a migration");

		const result = prepareEmbeddedProductMigrationData(workspaceRoot);
		expect(result.migrationCount).toBe(2);
		const generated = await readFile(result.generatedFile, "utf8");
		expect(generated.indexOf("0000_initial.sql")).toBeLessThan(generated.indexOf("0010_later.sql"));
		expect(generated).toContain("CREATE TABLE initial");
		expect(generated).toContain("CREATE TABLE later");
		expect(generated).not.toContain("not a migration");
	});

	test("fails closed when the product migration directory is empty", async () => {
		await mkdir(migrationsRoot(), { recursive: true });
		expect(() => prepareEmbeddedProductMigrationData(workspaceRoot)).toThrow(
			/NovelFork product migrations directory is empty/,
		);
	});
});
