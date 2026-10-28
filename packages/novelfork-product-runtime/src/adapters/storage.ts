import { closeStorageDatabase, initializeStorageDatabase, runStorageMigrations } from "@vivy1024/novelfork-core";
import { getDbDir } from "@vivy1024/narrafork-runtime-bridge/runtime-db";
import { transferRuntimeProductData } from "../db/compatibility-transfer";
import {
	initializeNovelForkProductDatabase,
	resetNovelForkProductDatabase,
} from "../db/database";
import { runNovelForkProductMigrations } from "../db/migrations";
import { basename, resolve } from "node:path";
import { logger } from "@vivy1024/narrafork-runtime-bridge";
import {
	checkStartupStorageIntegrity,
	type StorageIntegrityAlert,
	type StorageIntegrityExplanation,
} from "../services/storage-integrity";

/** 本次进程启动时对产品库做完整性检查得到的告警（健康时为 null）。启动只记录一次。 */
let storageIntegrityAlert: StorageIntegrityAlert | null = null;

export function getStorageIntegrityAlert(): StorageIntegrityAlert | null {
	return storageIntegrityAlert;
}

/**
 * 记下本次启动的完整性检查结论；损坏时写一条错误日志。
 * Runtime logger 同时写 stderr 与 server.log，排查时能在日志文件里找到这条告警；
 * 界面侧经 GET /api/novelfork/bootstrap 的 storageIntegrity 字段展示（见 getPublicStorageIntegrityAlert）。
 */
export function recordStorageIntegrityAlert(alert: StorageIntegrityAlert | null): void {
	storageIntegrityAlert = alert;
	if (!alert) return;
	logger.error("[storage] 产品库完整性检查未通过", {
		code: alert.code,
		storagePath: alert.storagePath,
		report: alert.report,
		whatHappened: alert.explanation.whatHappened,
		whyItMatters: alert.explanation.whyItMatters,
		suggestedAction: alert.explanation.suggestedAction,
	});
}

/** 交给前端的告警：只带说明与简短报告摘要，库文件只给文件名，不暴露本机绝对路径。 */
export interface PublicStorageIntegrityAlert {
	readonly code: StorageIntegrityAlert["code"];
	readonly kind: StorageIntegrityAlert["kind"];
	readonly storageFile: string;
	readonly reportSummary: string;
	readonly explanation: StorageIntegrityExplanation;
}

const REPORT_SUMMARY_MAX_CHARS = 200;

function redactPath(text: string, storagePath: string, storageFile: string): string {
	// SQLite 报告与说明里都可能带库的绝对路径：统一换成文件名。
	return [storagePath, storagePath.replaceAll("\\", "/"), storagePath.replaceAll("/", "\\")]
		.filter((candidate) => candidate.length > 0)
		.reduce((current, candidate) => current.split(candidate).join(storageFile), text);
}

/** 把启动告警整理成可以放进 bootstrap 响应的形态；健康时为 null。 */
export function getPublicStorageIntegrityAlert(): PublicStorageIntegrityAlert | null {
	const alert = storageIntegrityAlert;
	if (!alert) return null;
	const storageFile = basename(alert.storagePath) || "novelfork.db";
	const redact = (text: string) => redactPath(text, alert.storagePath, storageFile);
	const firstLine = redact(alert.report).split(/\r?\n/u).find((line) => line.trim() !== "")?.trim() ?? "";
	const reportSummary =
		firstLine.length > REPORT_SUMMARY_MAX_CHARS ? `${firstLine.slice(0, REPORT_SUMMARY_MAX_CHARS)}…` : firstLine;
	return {
		code: alert.code,
		kind: alert.kind,
		storageFile,
		reportSummary,
		explanation: {
			whatHappened: redact(alert.explanation.whatHappened),
			whyItMatters: redact(alert.explanation.whyItMatters),
			suggestedAction: redact(alert.explanation.suggestedAction),
		},
	};
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
	recordStorageIntegrityAlert(checkStartupStorageIntegrity(storage));
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
