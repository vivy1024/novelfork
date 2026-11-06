import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { db as runtimeDb, narratorMessages, narrators } from "@vivy1024/narrafork-runtime-bridge";
import { sql } from "@vivy1024/narrafork-runtime-bridge/runtime-db";
import type { StorageDatabase } from "@vivy1024/novelfork-core";
import { initializeNovelRuntimeStorage } from "../adapters/storage";
import {
	runToolPayloadRetentionIfDue,
	TOOL_PAYLOAD_RETENTION_MARKER,
} from "./tool-payload-retention";

/**
 * Runtime 的 180 天工具调用载荷清理只有手动入口，从未自动跑过。产品按天调度它：
 * 只置空过期行的 input/output，行保留，检查点行不动，一天内不重复执行。
 */

const stamp = Date.now();
const narratorId = `retention-narrator-${stamp}`;
const messageId = `retention-message-${stamp}`;
const DAY = 24 * 60 * 60 * 1000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

let storage: StorageDatabase;

function insertToolCall(id: string, createdAt: string, checkpoint = false): void {
	runtimeDb.run(
		sql`INSERT INTO narrator_tool_calls
		      (id, narrator_id, message_id, tool_use_id, tool_name, input_json, output_json, status, created_at, is_file_history_checkpoint)
		    VALUES (${id}, ${narratorId}, ${messageId}, ${`use-${id}`}, ${"chapter.write"},
		            ${JSON.stringify({ content: "整章正文".repeat(50) })}, ${JSON.stringify({ ok: true })},
		            ${"success"}, ${createdAt}, ${checkpoint ? 1 : 0})`,
	);
}

function payloadOf(id: string): { input_json: string | null; output_json: string | null } | undefined {
	return runtimeDb.all<{ input_json: string | null; output_json: string | null }>(
		sql`SELECT input_json, output_json FROM narrator_tool_calls WHERE id = ${id}`,
	)[0];
}

beforeAll(() => {
	storage = initializeNovelRuntimeStorage();
	const createdAt = new Date().toISOString();
	runtimeDb
		.insert(narrators)
		.values({
			id: narratorId,
			type: "primary",
			variant: "primary",
			traits: ["standalone"],
			title: "retention",
			permissionMode: "default",
			inheritMode: "fresh",
			status: "idle",
			createdAt,
			updatedAt: createdAt,
		})
		.run();
	runtimeDb
		.insert(narratorMessages)
		.values({ id: messageId, narratorId, role: "assistant", contentJson: [{ type: "text", text: "x" }], contentText: "x", createdAt })
		.run();
	insertToolCall(`${stamp}-old`, iso(200 * DAY));
	insertToolCall(`${stamp}-old-checkpoint`, iso(200 * DAY), true);
	insertToolCall(`${stamp}-recent`, iso(10 * DAY));
});

beforeEach(() => {
	storage.sqlite.prepare(`DELETE FROM "kv_store" WHERE "key" = ?`).run(TOOL_PAYLOAD_RETENTION_MARKER);
});

describe("工具调用载荷的定期清理", () => {
	test("真实执行 Runtime 清理：过期行置空、行保留，检查点与近期行不动", async () => {
		const outcome = await runToolPayloadRetentionIfDue({ storage });
		expect(outcome.ran).toBe(true);
		if (outcome.ran) expect(outcome.toolCalls).toBeGreaterThanOrEqual(1);

		expect(payloadOf(`${stamp}-old`)).toEqual({ input_json: null, output_json: null });
		expect(payloadOf(`${stamp}-old-checkpoint`)?.input_json).not.toBeNull();
		expect(payloadOf(`${stamp}-recent`)?.input_json).not.toBeNull();
	});

	test("一天内只跑一次；超过一天再跑；失败不记时间、下次重试", async () => {
		let calls = 0;
		let now = 1_000_000;
		const clear = async (days: number) => {
			calls += 1;
			expect(days).toBe(180);
			return { changed: false, toolCalls: 0, approxBytes: 0, freedBytes: 0 };
		};
		expect((await runToolPayloadRetentionIfDue({ storage, clear, now: () => now })).ran).toBe(true);
		now += DAY - 1;
		expect(await runToolPayloadRetentionIfDue({ storage, clear, now: () => now })).toEqual({ ran: false, reason: "recent" });
		now += 2;
		expect((await runToolPayloadRetentionIfDue({ storage, clear, now: () => now })).ran).toBe(true);
		expect(calls).toBe(2);

		storage.sqlite.prepare(`DELETE FROM "kv_store" WHERE "key" = ?`).run(TOOL_PAYLOAD_RETENTION_MARKER);
		const failing = async () => {
			throw new Error("busy");
		};
		expect(await runToolPayloadRetentionIfDue({ storage, clear: failing, now: () => now })).toMatchObject({ ran: false, reason: "failed" });
		expect((await runToolPayloadRetentionIfDue({ storage, clear, now: () => now })).ran).toBe(true);
	});
});
