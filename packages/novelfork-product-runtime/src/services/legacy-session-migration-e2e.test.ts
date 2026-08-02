import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { inArray } from "@vivy1024/narrafork-runtime-bridge/runtime-db";
import {
	db,
	narratorMessageRefs,
	narratorMessages,
	narrators,
} from "@vivy1024/narrafork-runtime-bridge";
import { initializeNovelRuntimeStorage } from "../adapters/storage";
import { getNovelForkProductDatabase } from "../db/database";
import { novelforkLegacySessionImports } from "../db/schema";
import { migrateLegacySessions } from "./legacy-session-migration";

const suffix = crypto.randomUUID();
const activeId = `active-${suffix}`;
const archivedId = `archived-${suffix}`;
const sourceIds = [activeId, archivedId];
const narratorIds = sourceIds.map((id) => `novelfork-legacy-${id}`);
const messageIds = sourceIds.map((id) => `novelfork-legacy-summary-${id}`);
const refIds = sourceIds.map((id) => `novelfork-legacy-summary-ref-${id}`);
let sourceDir = "";
let sourcePath = "";
let sourceBefore: { size: number; mtimeMs: number };

beforeAll(async () => {
	initializeNovelRuntimeStorage();
	sourceDir = await mkdtemp(join(tmpdir(), "novelfork-legacy-source-"));
	sourcePath = join(sourceDir, "novelfork.db");
	const source = new Database(sourcePath);
	source.run(`CREATE TABLE session (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, message_count INTEGER NOT NULL, config_json TEXT NOT NULL, metadata_json TEXT NOT NULL, deleted_at INTEGER)`);
	source.run(`CREATE TABLE session_message (session_id TEXT NOT NULL, seq INTEGER NOT NULL, id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, timestamp INTEGER NOT NULL, metadata_json TEXT NOT NULL, PRIMARY KEY (session_id, seq))`);
	const insertSession = source.prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?, ?, NULL)");
	const insertMessage = source.prepare("INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?, ?)");
	insertSession.run(activeId, 1_700_000_000_000, 1_700_000_100_000, 3, "{}", JSON.stringify({ title: "活跃旧会话", status: "active", projectId: "旧书籍" }));
	insertMessage.run(activeId, 1, "m1", "user", "请规划世界观", 1_700_000_000_001, "{}");
	insertMessage.run(activeId, 2, "m2", "assistant", "正在调用工具", 1_700_000_000_002, JSON.stringify({ type: "tool_progress" }));
	insertMessage.run(activeId, 3, "m3", "assistant", "已完成世界观规划，核心冲突是灵潮与秩序。", 1_700_000_000_003, "{}");
	insertSession.run(archivedId, 1_700_000_200_000, 1_700_000_300_000, 20, "{}", JSON.stringify({ title: "归档旧会话", status: "archived" }));
	for (let index = 1; index <= 20; index += 1) {
		insertMessage.run(archivedId, index, `a${index}`, index % 2 ? "user" : "assistant", `${index % 2 ? "用户目标" : "助手结论"}${index}：${"长文本".repeat(2_000)}`, 1_700_000_200_000 + index, "{}");
	}
	source.close();
	sourceBefore = await stat(sourcePath);
});

afterAll(async () => {
	await db.delete(narratorMessageRefs).where(inArray(narratorMessageRefs.id, refIds));
	await db.delete(narratorMessages).where(inArray(narratorMessages.id, messageIds));
	await db.delete(narrators).where(inArray(narrators.id, narratorIds));
	await getNovelForkProductDatabase().delete(novelforkLegacySessionImports).where(inArray(novelforkLegacySessionImports.sourceSessionId, sourceIds));
	await rm(sourceDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => undefined);
});

describe("legacy NovelFork session migration", () => {
	test("imports content sessions once, preserves archive state, and leaves the legacy source unchanged", async () => {
		const first = await migrateLegacySessions({ sourceDir });
		const second = await migrateLegacySessions({ sourceDir });
		expect(first).toEqual({ imported: 2, skipped: 0, failed: 0 });
		expect(second).toEqual({ imported: 0, skipped: 2, failed: 0 });

		const migrated = await db.query.narrators.findMany({
			where: (table, { inArray: inRows }) => inRows(table.id, narratorIds),
			columns: { id: true, title: true, status: true, messageCount: true },
		});
		expect(migrated).toHaveLength(2);
		expect(migrated.find((row) => row.id.endsWith(activeId))).toMatchObject({ status: "idle", title: "活跃旧会话", messageCount: 1 });
		expect(migrated.find((row) => row.id.endsWith(archivedId))).toMatchObject({ status: "archived", title: "归档旧会话", messageCount: 1 });
		const summaries = await db.query.narratorMessages.findMany({
			where: (table, { inArray: inRows }) => inRows(table.id, messageIds),
			columns: { contentText: true },
		});
		expect(summaries).toHaveLength(2);
		expect(
			summaries.every((row) => {
				const content = row.contentText ?? "";
				return content.includes("旧 NovelFork 会话迁移摘要")
					&& !content.includes("正在调用工具")
					&& content.length <= 48 * 1024;
			}),
		).toBe(true);
		expect(await getNovelForkProductDatabase().query.novelforkLegacySessionImports.findMany({ where: (table, { inArray: inRows }) => inRows(table.sourceSessionId, sourceIds) })).toHaveLength(2);
		const sourceAfter = await stat(sourcePath);
		expect({ size: sourceAfter.size, mtimeMs: sourceAfter.mtimeMs }).toEqual({ size: sourceBefore.size, mtimeMs: sourceBefore.mtimeMs });
	}, 60_000);
});
