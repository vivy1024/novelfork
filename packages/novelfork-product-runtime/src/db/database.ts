import type { Database } from "bun:sqlite";
import type { StorageDatabase } from "@vivy1024/novelfork-core";
import { getStorageDatabase } from "@vivy1024/novelfork-core";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";

export type NovelForkProductDatabase = BunSQLiteDatabase<typeof schema>;

let current:
	| { readonly storage: StorageDatabase; readonly db: NovelForkProductDatabase }
	| undefined;

export function createNovelForkProductDatabase(
	storage: StorageDatabase,
): NovelForkProductDatabase {
	return drizzle({
		client: storage.sqlite as unknown as Database,
		schema,
	});
}

export function initializeNovelForkProductDatabase(
	storage: StorageDatabase,
): NovelForkProductDatabase {
	if (current?.storage === storage && storage.sqlite.open) return current.db;
	const db = createNovelForkProductDatabase(storage);
	current = { storage, db };
	return db;
}

export function getNovelForkProductDatabase(): NovelForkProductDatabase {
	const storage = getStorageDatabase();
	return initializeNovelForkProductDatabase(storage);
}

export function resetNovelForkProductDatabase(): void {
	current = undefined;
}
