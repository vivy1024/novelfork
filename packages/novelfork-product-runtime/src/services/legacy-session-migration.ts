import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { eq } from "@vivy1024/narrafork-runtime-bridge/runtime-db";
import { getNovelForkProductDatabase } from "../db/database";
import { novelforkLegacySessionImports } from "../db/schema";

const SUMMARY_MAX_CHARS = 48 * 1024;
const SUMMARY_HEAD_CHARS = 28 * 1024;
const SUMMARY_TAIL_CHARS = 16 * 1024;
const SUMMARY_MESSAGE_ID_PREFIX = "novelfork-legacy-summary-";
const SUMMARY_REF_ID_PREFIX = "novelfork-legacy-summary-ref-";

type RuntimeLegacyMigrationDependencies = {
	readonly runtimeDb: typeof import("@vivy1024/narrafork-runtime-bridge").db;
	readonly narratorMessageRefs: typeof import("@vivy1024/narrafork-runtime-bridge").narratorMessageRefs;
	readonly narratorMessages: typeof import("@vivy1024/narrafork-runtime-bridge").narratorMessages;
	readonly narrators: typeof import("@vivy1024/narrafork-runtime-bridge").narrators;
	readonly logger: typeof import("@vivy1024/narrafork-runtime-bridge").logger;
	readonly followDefaultModel: typeof import("@vivy1024/narrafork-runtime-bridge").FOLLOW_DEFAULT_MODEL;
};

async function getRuntimeLegacyMigrationDependencies(): Promise<RuntimeLegacyMigrationDependencies> {
	const runtime = await import("@vivy1024/narrafork-runtime-bridge");
	return {
		runtimeDb: runtime.db,
		narratorMessageRefs: runtime.narratorMessageRefs,
		narratorMessages: runtime.narratorMessages,
		narrators: runtime.narrators,
		logger: runtime.logger,
		followDefaultModel: runtime.FOLLOW_DEFAULT_MODEL,
	};
}

export interface LegacySessionRow {
	id: string;
	created_at: number;
	updated_at: number;
	message_count: number;
	config_json: string;
	metadata_json: string;
	deleted_at: number | null;
}

export interface LegacyMessageRow {
	seq: number;
	role: "user" | "assistant" | "system";
	content: string;
	timestamp: number;
	metadata_json: string;
}

interface LegacySessionMetadata {
	title?: string;
	status?: "active" | "archived";
	projectId?: string;
	chapterId?: string;
	worktree?: string;
}

export interface LegacySessionMigrationResult {
	readonly imported: number;
	readonly skipped: number;
	readonly failed: number;
}

export interface LegacySessionMigrationOptions {
	readonly sourceDir?: string;
}

function parseJsonRecord(value: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(value);
		return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

function readLegacyMetadata(session: LegacySessionRow): LegacySessionMetadata {
	const metadata = parseJsonRecord(session.metadata_json);
	return {
		...(typeof metadata.title === "string" ? { title: metadata.title } : {}),
		...(metadata.status === "active" || metadata.status === "archived"
			? { status: metadata.status }
			: {}),
		...(typeof metadata.projectId === "string" ? { projectId: metadata.projectId } : {}),
		...(typeof metadata.chapterId === "string" ? { chapterId: metadata.chapterId } : {}),
		...(typeof metadata.worktree === "string" ? { worktree: metadata.worktree } : {}),
	};
}

function isoFromLegacyTimestamp(value: number, fallback: string): string {
	const date = new Date(value);
	return Number.isFinite(value) && !Number.isNaN(date.getTime()) ? date.toISOString() : fallback;
}

function normalizeText(value: string): string {
	return value.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
}

function isProgressNoise(text: string, metadataJson: string): boolean {
	const metadata = parseJsonRecord(metadataJson);
	const kind = [metadata.type, metadata.eventType, metadata.kind]
		.filter((value): value is string => typeof value === "string")
		.join(" ")
		.toLowerCase();
	if (/tool[_ -]?(use|result)|progress|stream|delta|heartbeat|status/.test(kind)) return true;
	return /^(?:\[?(?:tool|progress|status)\]?[:：]|正在(?:调用|执行|读取|搜索)|tool (?:use|result))/i.test(text);
}

function selectDigestEntries(messages: readonly LegacyMessageRow[]): string[] {
	const entries: string[] = [];
	const seen = new Set<string>();
	let lastAssistant = "";

	const append = (label: string, text: string) => {
		const normalized = normalizeText(text);
		if (!normalized) return;
		const key = `${label}:${normalized}`;
		if (seen.has(key)) return;
		seen.add(key);
		entries.push(`${label}：${normalized.slice(0, 4_000)}`);
	};
	const flushAssistant = () => {
		if (lastAssistant) append("助手结论", lastAssistant);
		lastAssistant = "";
	};

	for (const message of messages) {
		const text = normalizeText(message.content ?? "");
		if (!text) continue;
		if (message.role === "user") {
			flushAssistant();
			append("用户", text);
			continue;
		}
		if (message.role === "system") {
			if (!isProgressNoise(text, message.metadata_json)) append("系统说明", text.slice(0, 2_000));
			continue;
		}
		if (!isProgressNoise(text, message.metadata_json)) lastAssistant = text;
	}
	flushAssistant();
	return entries;
}

function limitSummary(summary: string): string {
	if (summary.length <= SUMMARY_MAX_CHARS) return summary;
	return `${summary.slice(0, SUMMARY_HEAD_CHARS)}\n\n……中间迁移摘要已截断……\n\n${summary.slice(-SUMMARY_TAIL_CHARS)}`;
}

export function buildLegacySessionSummary(
	session: LegacySessionRow,
	messages: readonly LegacyMessageRow[],
): string {
	const metadata = readLegacyMetadata(session);
	const now = new Date().toISOString();
	const createdAt = isoFromLegacyTimestamp(session.created_at, now);
	const updatedAt = isoFromLegacyTimestamp(session.updated_at, createdAt);
	const lines = [
		"# 旧 NovelFork 会话迁移摘要",
		"",
		"> 此内容是旧 Session 的确定性文字摘要，不是逐消息、工具调用或运行状态恢复。",
		"",
		`- 标题：${metadata.title?.trim() || "未命名旧会话"}`,
		`- 旧 Session ID：${session.id}`,
		`- 原状态：${metadata.status === "archived" ? "已归档" : "活跃"}`,
		`- 创建时间：${createdAt}`,
		`- 更新时间：${updatedAt}`,
		`- 原书籍/项目：${metadata.projectId ?? "无"}`,
		`- 原章节：${metadata.chapterId ?? "无"}`,
		`- 原工作目录：${metadata.worktree ?? "无"}`,
		`- 原消息记录：${messages.length} 条`,
		"",
		"## 对话摘要",
		"",
		...selectDigestEntries(messages).flatMap((entry) => [entry, ""]),
	];
	return limitSummary(lines.join("\n").trim());
}

function summaryHash(summary: string): string {
	return createHash("sha256").update(summary, "utf8").digest("hex");
}

function resolveLegacySourceDbPath(sourceDir?: string): string {
	if (sourceDir) return join(resolve(sourceDir), "novelfork.db");
	return resolve(
		process.env.NOVELFORK_LEGACY_SESSION_DB_PATH
			?? process.env.NOVELFORK_STORAGE_DB_PATH
			?? join(homedir(), ".novelfork", "novelfork.db"),
	);
}

function validLegacyCwd(value: string | undefined): string | undefined {
	if (!value?.trim()) return undefined;
	const cwd = value.trim();
	return isAbsolute(cwd) && existsSync(cwd) ? cwd : undefined;
}

function sourceTablesExist(legacyDb: Database): boolean {
	const rows = legacyDb
		.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('session', 'session_message')")
		.all() as Array<{ name: string }>;
	return rows.some((row) => row.name === "session") && rows.some((row) => row.name === "session_message");
}

async function setLedgerStatus(
	session: LegacySessionRow,
	narratorId: string,
	hash: string,
	status: "pending" | "done" | "error",
	errorMessage?: string,
): Promise<void> {
	await getNovelForkProductDatabase()
		.insert(novelforkLegacySessionImports)
		.values({
			sourceSessionId: session.id,
			narratorId,
			sourceUpdatedAt: isoFromLegacyTimestamp(session.updated_at, new Date().toISOString()),
			summaryHash: hash,
			status,
			importedAt: status === "done" ? new Date().toISOString() : null,
			errorMessage: errorMessage ?? null,
		})
		.onConflictDoUpdate({
			target: novelforkLegacySessionImports.sourceSessionId,
			set: {
				narratorId,
				sourceUpdatedAt: isoFromLegacyTimestamp(session.updated_at, new Date().toISOString()),
				summaryHash: hash,
				status,
				importedAt: status === "done" ? new Date().toISOString() : null,
				errorMessage: errorMessage ?? null,
			},
		});
}

async function migrateOneSession(
	session: LegacySessionRow,
	messages: readonly LegacyMessageRow[],
): Promise<"imported" | "skipped"> {
	const {
		runtimeDb,
		narratorMessageRefs,
		narratorMessages,
		narrators,
		followDefaultModel,
	} = await getRuntimeLegacyMigrationDependencies();
	const existing = await getNovelForkProductDatabase().query.novelforkLegacySessionImports.findFirst({
		where: eq(novelforkLegacySessionImports.sourceSessionId, session.id),
	});
	if (existing?.status === "done") return "skipped";

	const narratorId = `novelfork-legacy-${session.id}`;
	const messageId = `${SUMMARY_MESSAGE_ID_PREFIX}${session.id}`;
	const refId = `${SUMMARY_REF_ID_PREFIX}${session.id}`;
	const summary = buildLegacySessionSummary(session, messages);
	const hash = summaryHash(summary);
	const metadata = readLegacyMetadata(session);
	const now = new Date().toISOString();
	const createdAt = isoFromLegacyTimestamp(session.created_at, now);
	const updatedAt = isoFromLegacyTimestamp(session.updated_at, createdAt);
	const cwd = validLegacyCwd(metadata.worktree);
	const title = metadata.title?.trim() || "旧会话摘要";
	const status = metadata.status === "archived" ? "archived" : "idle";
	await setLedgerStatus(session, narratorId, hash, "pending");

	runtimeDb.transaction((tx) => {
		const narrator = tx.query.narrators.findFirst({ where: eq(narrators.id, narratorId) }).sync();
		if (!narrator) {
			tx.insert(narrators)
				.values({
					id: narratorId,
					chapterId: null,
					type: "primary",
					variant: "primary",
					traits: ["standalone"],
					title,
					model: followDefaultModel,
					permissionMode: "default",
					inheritMode: "fresh",
					status,
					...(cwd ? { cwd } : {}),
					createdAt,
					updatedAt,
				})
				.run();
		}

		const summaryMessage = tx.query.narratorMessages.findFirst({
			where: eq(narratorMessages.id, messageId),
		}).sync();
		if (!summaryMessage) {
			tx.insert(narratorMessages)
				.values({
					id: messageId,
					narratorId,
					role: "sys",
					contentJson: [{ type: "text", text: summary }],
					contentText: summary,
					createdAt: updatedAt,
				})
				.run();
		}

		const summaryRef = tx.query.narratorMessageRefs.findFirst({
			where: eq(narratorMessageRefs.id, refId),
		}).sync();
		if (!summaryRef) {
			tx.insert(narratorMessageRefs)
				.values({ id: refId, narratorId, messageId, seq: 1, isCompact: 0 })
				.run();
		}

		tx.update(narrators)
			.set({
				title,
				status,
				...(cwd ? { cwd } : {}),
				messageCount: 1,
				messageVersion: 1,
				createdAt,
				updatedAt,
				lastMessageAt: updatedAt,
			})
			.where(eq(narrators.id, narratorId))
			.run();
	});

	await setLedgerStatus(session, narratorId, hash, "done");
	return "imported";
}

export async function migrateLegacySessions(
	options: LegacySessionMigrationOptions = {},
): Promise<LegacySessionMigrationResult> {
	const sourceDbPath = resolveLegacySourceDbPath(options.sourceDir);
	if (!existsSync(sourceDbPath)) return { imported: 0, skipped: 0, failed: 0 };

	const legacyDb = new Database(sourceDbPath, { readonly: true });
	const { logger } = await getRuntimeLegacyMigrationDependencies();
	const result = { imported: 0, skipped: 0, failed: 0 };
	try {
		if (!sourceTablesExist(legacyDb)) {
			logger.warn("Legacy NovelFork session tables not found; skipping migration", { sourceDbPath });
			return result;
		}
		const sessions = legacyDb
			.query(`
				SELECT id, created_at, updated_at, message_count, config_json, metadata_json, deleted_at
				FROM session
				WHERE deleted_at IS NULL AND message_count > 0
				ORDER BY updated_at ASC
			`)
			.all() as LegacySessionRow[];
		const messageQuery = legacyDb.query(`
			SELECT seq, role, content, timestamp, metadata_json
			FROM session_message
			WHERE session_id = ?
			ORDER BY seq ASC
		`);

		for (const session of sessions) {
			try {
				const messages = messageQuery.all(session.id) as LegacyMessageRow[];
				if (messages.length === 0) {
					result.skipped += 1;
					continue;
				}
				const state = await migrateOneSession(session, messages);
				result[state] += 1;
			} catch (cause) {
				result.failed += 1;
				const message = cause instanceof Error ? cause.message : String(cause);
				await setLedgerStatus(
					session,
					`novelfork-legacy-${session.id}`,
					"",
					"error",
					message.slice(0, 1_000),
				).catch(() => undefined);
				logger.error("Failed to migrate legacy NovelFork session", {
					sessionId: session.id,
					error: message,
				});
			}
		}
	} finally {
		legacyDb.close();
	}

	logger.info("Legacy NovelFork session migration complete", result);
	return result;
}
