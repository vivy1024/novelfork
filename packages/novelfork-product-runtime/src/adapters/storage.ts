import { closeStorageDatabase, initializeStorageDatabase, runStorageMigrations } from "@vivy1024/novelfork-core";
import { resolve } from "node:path";
import { getDbDir } from "@vivy1024/narrafork-runtime-bridge/runtime-db";
import { transferRuntimeProductData } from "../db/compatibility-transfer";
import {
	initializeNovelForkProductDatabase,
	resetNovelForkProductDatabase,
} from "../db/database";
import { runNovelForkProductMigrations } from "../db/migrations";

/** Resolve the NovelFork domain database without ever sharing Runtime's narrafork.db. */
export function resolveNovelRuntimeStoragePath(): string {
	const configuredPath = process.env.NOVELFORK_STORAGE_DB_PATH?.trim();
	if (configuredPath) return resolve(configuredPath);

	const sessionStoreDir = process.env.NOVELFORK_SESSION_STORE_DIR?.trim();
	if (sessionStoreDir) return resolve(sessionStoreDir, "novelfork.db");

	return resolve(getDbDir(), "novelfork.db");
}

export function initializeNovelRuntimeStorage() {
	const storage = initializeStorageDatabase({ databasePath: resolveNovelRuntimeStoragePath() });
	runStorageMigrations(storage);
	runNovelForkProductMigrations(storage);
	initializeNovelForkProductDatabase(storage);
	transferRuntimeProductData(storage);
	return storage;
}

export function closeNovelRuntimeStorage(): void {
	resetNovelForkProductDatabase();
	closeStorageDatabase();
}
