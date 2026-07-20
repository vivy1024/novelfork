import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { StorageDatabase } from "@vivy1024/novelfork-core";
import { embeddedProductMigrationSqlFiles } from "./generated-migrations-data";
import { runNovelForkProductMigrations } from "./migrations";

const databases: Database[] = [];

function createStorage(): StorageDatabase {
	const sqlite = new Database(":memory:");
	databases.push(sqlite);
	return { sqlite } as StorageDatabase;
}

afterEach(() => {
	for (const database of databases.splice(0)) database.close();
});

describe("NovelFork product migrations", () => {
	test("adopts pre-existing Runtime-owned tables before product migration tracking exists", async () => {
		const storage = await createStorage();
		storage.sqlite.exec(`
			CREATE TABLE book_provision_operations (
				id TEXT PRIMARY KEY NOT NULL,
				actor_user_id TEXT NOT NULL,
				idempotency_key TEXT NOT NULL,
				book_id TEXT NOT NULL,
				title TEXT NOT NULL,
				input_json TEXT NOT NULL,
				state TEXT NOT NULL,
				runtime_project_id TEXT,
				runtime_chapter_id TEXT,
				narrator_id TEXT,
				error_message TEXT,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);
		`);

		expect(runNovelForkProductMigrations(storage).applied).toEqual(["0000_high_sage.sql"]);
		expect(
			storage.sqlite
				.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'book_runtime_bindings'")
				.get(),
		).toBeDefined();
		expect(
			storage.sqlite
				.prepare<{ count: number }>(
					"SELECT count(*) AS count FROM novelfork_product_migrations WHERE name = '0000_high_sage.sql'",
				)
				.get(),
		).toEqual({ count: 1 });
		expect(runNovelForkProductMigrations(storage).applied).toEqual([]);
	});

	test("uses embedded migration data when the source SQL directory is unavailable", () => {
		const embedded = embeddedProductMigrationSqlFiles as {
			name: string;
			content: string;
		}[];
		const original = [...embedded];
		embedded.splice(
			0,
			embedded.length,
			{
				name: "0000_high_sage.sql",
				content: readFileSync(join(import.meta.dir, "migrations", "0000_high_sage.sql"), "utf8"),
			},
		);

		try {
			const storage = createStorage();
			expect(
				runNovelForkProductMigrations(
					storage,
					join(import.meta.dir, "missing-compiled-product-migrations"),
				).applied,
			).toEqual(["0000_high_sage.sql"]);
			expect(
				storage.sqlite
					.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'book_runtime_bindings'")
					.get(),
			).toBeDefined();
		} finally {
			embedded.splice(0, embedded.length, ...original);
		}
	});
});
