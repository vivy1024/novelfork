import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core";
import {
	closeNovelRuntimeStorage,
	initializeNovelRuntimeStorage,
} from "../adapters/storage";
import { transferRuntimeProductData } from "./compatibility-transfer";
import {
	createNovelForkProductDatabase,
	getNovelForkProductDatabase,
} from "./database";
import { runNovelForkProductMigrations } from "./migrations";
import { bookRuntimeBindings } from "./schema";

const tempDirs: string[] = [];
const storages: StorageDatabase[] = [];
const originalStoragePath = process.env.NOVELFORK_STORAGE_DB_PATH;
const originalNarraforkHome = process.env.NARRAFORK_HOME;

function restoreStorageEnvironment(): void {
	if (originalStoragePath === undefined) delete process.env.NOVELFORK_STORAGE_DB_PATH;
	else process.env.NOVELFORK_STORAGE_DB_PATH = originalStoragePath;
	if (originalNarraforkHome === undefined) delete process.env.NARRAFORK_HOME;
	else process.env.NARRAFORK_HOME = originalNarraforkHome;
}

async function tempPath(name: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "novelfork-product-storage-"));
	tempDirs.push(dir);
	return join(dir, name);
}

async function createTarget(): Promise<StorageDatabase> {
	const storage = createStorageDatabase({ databasePath: await tempPath("novelfork.db") });
	storages.push(storage);
	return storage;
}

function createLegacyRuntimeDatabase(path: string): void {
	const source = new Database(path);
	source.exec(`
		CREATE TABLE book_runtime_bindings (
			id TEXT PRIMARY KEY, runtime_project_id TEXT NOT NULL UNIQUE,
			book_id TEXT NOT NULL UNIQUE, book_root TEXT NOT NULL,
			created_by_user_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
		);
		CREATE TABLE book_provision_operations (
			id TEXT PRIMARY KEY, actor_user_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
			book_id TEXT NOT NULL UNIQUE, title TEXT NOT NULL, input_json TEXT NOT NULL,
			state TEXT NOT NULL, runtime_project_id TEXT, runtime_chapter_id TEXT,
			narrator_id TEXT, error_message TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
		);
		CREATE TABLE novelfork_legacy_session_imports (
			source_session_id TEXT PRIMARY KEY, narrator_id TEXT NOT NULL UNIQUE,
			source_updated_at TEXT NOT NULL, summary_hash TEXT NOT NULL,
			status TEXT NOT NULL, imported_at TEXT, error_message TEXT
		);
	`);
	source.prepare("INSERT INTO book_runtime_bindings VALUES (?, ?, ?, ?, ?, ?, ?)").run(
		"binding-1",
		"project-1",
		"book-1",
		"C:/books/book-1",
		"user-1",
		"2026-01-01T00:00:00.000Z",
		"2026-01-01T00:00:00.000Z",
	);
	source.prepare("INSERT INTO book_provision_operations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
		"operation-1",
		"user-1",
		"request-1",
		"book-1",
		"Book One",
		JSON.stringify({ title: "Book One" }),
		"ready",
		"project-1",
		"chapter-1",
		"narrator-1",
		null,
		"2026-01-01T00:00:00.000Z",
		"2026-01-01T00:00:00.000Z",
	);
	source.prepare("INSERT INTO novelfork_legacy_session_imports VALUES (?, ?, ?, ?, ?, ?, ?)").run(
		"session-1",
		"legacy-narrator-1",
		"2026-01-01T00:00:00.000Z",
		"hash-1",
		"done",
		"2026-01-01T00:00:00.000Z",
		null,
	);
	source.close();
}

afterEach(async () => {
	closeNovelRuntimeStorage();
	restoreStorageEnvironment();
	for (const storage of storages.splice(0)) storage.close();
	await Promise.all(
		tempDirs.splice(0).map((dir) =>
			rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }).catch(() => undefined),
		),
	);
});

describe("NovelFork product storage", () => {
	test("initializes the product schema after Core storage migrations", async () => {
		const runtimeHome = await mkdtemp(join(tmpdir(), "novelfork-product-runtime-source-"));
		tempDirs.push(runtimeHome);
		process.env.NARRAFORK_HOME = runtimeHome;
		process.env.NOVELFORK_STORAGE_DB_PATH = await tempPath("novelfork.db");

		const storage = initializeNovelRuntimeStorage();
		expect(
			storage.sqlite
				.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'book_runtime_bindings'")
				.get(),
		).toBeDefined();
		expect(getNovelForkProductDatabase()).toBeDefined();
	});

	test("runs generated migrations idempotently and exposes the product Drizzle schema", async () => {
		const storage = await createTarget();
		expect(runNovelForkProductMigrations(storage).applied).toEqual(["0000_high_sage.sql"]);
		expect(runNovelForkProductMigrations(storage).applied).toEqual([]);

		const db = createNovelForkProductDatabase(storage);
		await db.insert(bookRuntimeBindings).values({
			id: "binding-local",
			runtimeProjectId: "project-local",
			bookId: "book-local",
			bookRoot: "C:/books/book-local",
			createdByUserId: null,
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
		});
		expect(await db.query.bookRuntimeBindings.findFirst()).toMatchObject({ bookId: "book-local" });
	});

	test("adopts pre-existing Runtime-owned product tables before their migration ledger exists", async () => {
		const storage = await createTarget();
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

	test("copies all legacy Runtime product rows once without overwriting later product writes", async () => {
		const sourcePath = await tempPath("narrafork.db");
		createLegacyRuntimeDatabase(sourcePath);
		const storage = await createTarget();
		runNovelForkProductMigrations(storage);

		expect(transferRuntimeProductData(storage, sourcePath)).toEqual({
			copied: 3,
			skipped: 0,
			missingTables: [],
		});
		expect(transferRuntimeProductData(storage, sourcePath)).toEqual({
			copied: 0,
			skipped: 3,
			missingTables: [],
		});

		storage.sqlite.run(
			"UPDATE book_runtime_bindings SET book_root = ? WHERE id = ?",
			"D:/moved/book-1",
			"binding-1",
		);
		expect(transferRuntimeProductData(storage, sourcePath).skipped).toBe(3);
		expect(
			storage.sqlite.prepare<{ book_root: string }>("SELECT book_root FROM book_runtime_bindings WHERE id = ?").get("binding-1"),
		).toEqual({ book_root: "D:/moved/book-1" });
		expect(
			storage.sqlite.prepare<{ count: number }>("SELECT count(*) AS count FROM novelfork_runtime_compatibility_transfers").get(),
		).toEqual({ count: 3 });
	});

	test("tolerates a Runtime database with none of the legacy product tables", async () => {
		const sourcePath = await tempPath("empty-runtime.db");
		new Database(sourcePath).close();
		const storage = await createTarget();
		runNovelForkProductMigrations(storage);

		expect(transferRuntimeProductData(storage, sourcePath)).toEqual({
			copied: 0,
			skipped: 0,
			missingTables: [
				"book_runtime_bindings",
				"book_provision_operations",
				"novelfork_legacy_session_imports",
			],
		});
	});
});
