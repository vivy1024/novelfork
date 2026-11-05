import { beforeAll, describe, expect, test } from "bun:test";
import {
	db as runtimeDb,
	narratorMessages,
	narrators,
	narratorToolCalls,
} from "@vivy1024/narrafork-runtime-bridge";
import { eq, sql } from "@vivy1024/narrafork-runtime-bridge/runtime-db";
import type { StorageDatabase } from "@vivy1024/novelfork-core";
import { initializeNovelRuntimeStorage } from "../adapters/storage";
import {
	LEGACY_TOOL_OUTPUT_REPAIR_MARKER,
	repairLegacyToolCallOutputJson,
} from "./legacy-tool-output-repair";

/**
 * 旧版 Runtime 把工具结果纯文本直接存进 output_json；0.9 历史读取逐行 JSON.parse，
 * 一行坏数据就让整个叙述者的历史打不开。启动修复必须把这些行无损包成 JSON 字符串，
 * 且不碰任何本来合法的行。
 */

const narratorId = `legacy-repair-narrator-${Date.now()}`;
const messageId = `legacy-repair-message-${Date.now()}`;
const createdAt = new Date().toISOString();

let storage: StorageDatabase;

const legacyRows = [
	{ id: "tc-skill", text: '<skill_content name="去AI味">\n# Skill: 去AI味\n"引号" \\ 反斜杠' },
	{ id: "tc-unknown", text: "Unknown tool: cockpit_snapshot" },
	{ id: "tc-invalid", text: 'Invalid parameters: [\n  {\n    "code": "unrecognized_keys"' },
];
const validRows = [
	{ id: "tc-object", json: JSON.stringify({ _text: "ok" }) },
	{ id: "tc-string", json: JSON.stringify("The server restarted before this tool's final result") },
];

function storedOutput(id: string): string | null {
	const [row] = runtimeDb.all<{ output_json: string | null }>(
		sql`SELECT output_json FROM narrator_tool_calls WHERE id = ${id}`,
	);
	return row?.output_json ?? null;
}

function insertRawToolCall(id: string, rawOutput: string | null): void {
	// 绕过 Drizzle 的 JSON 序列化，按旧版的实际落库形态写入原文。
	runtimeDb.run(
		sql`INSERT INTO narrator_tool_calls (id, narrator_id, message_id, tool_use_id, tool_name, output_json, status, created_at)
		    VALUES (${id}, ${narratorId}, ${messageId}, ${`use-${id}`}, ${"Skill"}, ${rawOutput}, ${"success"}, ${createdAt})`,
	);
}

beforeAll(() => {
	storage = initializeNovelRuntimeStorage();
	runtimeDb
		.insert(narrators)
		.values({
			id: narratorId,
			type: "primary",
			variant: "primary",
			traits: ["standalone"],
			title: "legacy repair",
			permissionMode: "default",
			inheritMode: "fresh",
			status: "idle",
			createdAt,
			updatedAt: createdAt,
		})
		.run();
	runtimeDb
		.insert(narratorMessages)
		.values({
			id: messageId,
			narratorId,
			role: "assistant",
			contentJson: [{ type: "text", text: "x" }],
			contentText: "x",
			createdAt,
		})
		.run();
	for (const row of legacyRows) insertRawToolCall(row.id, row.text);
	for (const row of validRows) insertRawToolCall(row.id, row.json);
	insertRawToolCall("tc-null", null);
	storage.sqlite.prepare(`DELETE FROM "kv_store" WHERE "key" = ?`).run(LEGACY_TOOL_OUTPUT_REPAIR_MARKER);
});

describe("repairLegacyToolCallOutputJson", () => {
	test("把旧版纯文本无损包成 JSON 字符串，合法行与 NULL 原样保留", () => {
		const result = repairLegacyToolCallOutputJson(storage);
		expect(result).toEqual({ scanned: true, repaired: legacyRows.length });

		for (const row of legacyRows) {
			const stored = storedOutput(row.id);
			expect(stored).not.toBeNull();
			expect(JSON.parse(stored as string)).toBe(row.text);
		}
		for (const row of validRows) expect(storedOutput(row.id)).toBe(row.json);
		expect(storedOutput("tc-null")).toBeNull();

		// Drizzle 读取（mode: "json"）不再抛错，拿到的就是原文。
		const parsed = runtimeDb.query.narratorToolCalls.findFirst({
			where: eq(narratorToolCalls.id, "tc-unknown"),
			columns: { outputJson: true },
		}).sync();
		expect(parsed?.outputJson).toBe("Unknown tool: cockpit_snapshot");

		const [invalid] = runtimeDb.all<{ n: number }>(
			sql`SELECT count(*) AS n FROM narrator_tool_calls WHERE output_json IS NOT NULL AND json_valid(output_json) = 0`,
		);
		expect(Number(invalid?.n)).toBe(0);
	});

	test("修过一次即记标记，之后启动不再扫描", () => {
		const marker = storage.sqlite
			.prepare(`SELECT "value" FROM "kv_store" WHERE "key" = ?`)
			.get(LEGACY_TOOL_OUTPUT_REPAIR_MARKER) as { value: string } | undefined;
		expect(marker && JSON.parse(marker.value)).toEqual({ repaired: legacyRows.length });

		// 标记存在时即使再出现坏行也不扫描：修复只针对旧版写入，现行写入路径不会产生坏行。
		insertRawToolCall("tc-after-marker", "plain text");
		expect(repairLegacyToolCallOutputJson(storage)).toEqual({ scanned: false, repaired: 0 });
		expect(storedOutput("tc-after-marker")).toBe("plain text");
	});

	test("没有标记时重复执行是空操作", () => {
		runtimeDb.run(sql`DELETE FROM narrator_tool_calls WHERE id = ${"tc-after-marker"}`);
		storage.sqlite.prepare(`DELETE FROM "kv_store" WHERE "key" = ?`).run(LEGACY_TOOL_OUTPUT_REPAIR_MARKER);
		const snapshot = legacyRows.map((row) => storedOutput(row.id));
		expect(repairLegacyToolCallOutputJson(storage)).toEqual({ scanned: true, repaired: 0 });
		expect(legacyRows.map((row) => storedOutput(row.id))).toEqual(snapshot);
	});
});
