import { closeStorageDatabase, initializeStorageDatabase, runStorageMigrations } from "@vivy1024/novelfork-core";
import { resolve } from "node:path";
import { getDbDir } from "@vivy1024/narrafork-runtime-bridge/runtime-db";
import { transferRuntimeProductData } from "../db/compatibility-transfer";
import {
	initializeNovelForkProductDatabase,
	resetNovelForkProductDatabase,
} from "../db/database";
import { runNovelForkProductMigrations } from "../db/migrations";
import { checkStartupStorageIntegrity, type StorageIntegrityAlert } from "../services/storage-integrity";

/** 本次进程启动时对产品库做完整性检查得到的告警（健康时为 null）。启动只记录一次。 */
let storageIntegrityAlert: StorageIntegrityAlert | null = null;

export function getStorageIntegrityAlert(): StorageIntegrityAlert | null {
	return storageIntegrityAlert;
}

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
	// B2：消费 core 在建连时算出的启动完整性检查结果。损坏时如实记录并暴露给上层告警，
	// 但**不阻断启动**——库损坏时作者最需要的是进得来把书导出去（见 storage-integrity.ts）。
	storageIntegrityAlert = checkStartupStorageIntegrity(storage);
	if (storageIntegrityAlert) {
		console.error(
			`[storage] 产品库完整性检查未通过：${storageIntegrityAlert.storagePath}\n${storageIntegrityAlert.report}\n` +
				`${storageIntegrityAlert.explanation.whatHappened}\n${storageIntegrityAlert.explanation.whyItMatters}\n${storageIntegrityAlert.explanation.suggestedAction}`,
		);
	}
	runStorageMigrations(storage);
	runNovelForkProductMigrations(storage);
	initializeNovelForkProductDatabase(storage);
	transferRuntimeProductData(storage);
	return storage;
}

export function closeNovelRuntimeStorage(): void {
	storageIntegrityAlert = null;
	resetNovelForkProductDatabase();
	closeStorageDatabase();
}
