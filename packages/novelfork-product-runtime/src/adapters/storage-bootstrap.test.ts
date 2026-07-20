import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	closeNovelRuntimeStorage,
	initializeNovelRuntimeStorage,
	resolveNovelRuntimeStoragePath,
} from "./storage";

const originalStoragePath = process.env.NOVELFORK_STORAGE_DB_PATH;
const originalSessionStoreDir = process.env.NOVELFORK_SESSION_STORE_DIR;
const roots: string[] = [];

afterEach(async () => {
	closeNovelRuntimeStorage();
	if (originalStoragePath === undefined) delete process.env.NOVELFORK_STORAGE_DB_PATH;
	else process.env.NOVELFORK_STORAGE_DB_PATH = originalStoragePath;
	if (originalSessionStoreDir === undefined) delete process.env.NOVELFORK_SESSION_STORE_DIR;
	else process.env.NOVELFORK_SESSION_STORE_DIR = originalSessionStoreDir;
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Novel Runtime storage bootstrap", () => {
	test("uses an explicit domain database path and runs Core migrations", async () => {
		const root = await mkdtemp(join(tmpdir(), "novel-runtime-storage-"));
		roots.push(root);
		const databaseDir = join(root, "domain-store");
		await mkdir(databaseDir, { recursive: true });
		const databasePath = join(databaseDir, "novelfork.db");
		process.env.NOVELFORK_STORAGE_DB_PATH = databasePath;
		process.env.NOVELFORK_SESSION_STORE_DIR = join(root, "ignored-session-store");

		expect(resolveNovelRuntimeStoragePath()).toBe(resolve(databasePath));
		const storage = initializeNovelRuntimeStorage();
		expect(storage.databasePath).toBe(resolve(databasePath));
		expect(
			storage.sqlite
				.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'books'")
				.get(),
		).toBeDefined();
	});

	test("uses the Studio-compatible session store directory when no explicit path exists", async () => {
		const root = await mkdtemp(join(tmpdir(), "novel-runtime-session-store-"));
		roots.push(root);
		delete process.env.NOVELFORK_STORAGE_DB_PATH;
		process.env.NOVELFORK_SESSION_STORE_DIR = root;

		expect(resolveNovelRuntimeStoragePath()).toBe(resolve(root, "novelfork.db"));
	});
});
