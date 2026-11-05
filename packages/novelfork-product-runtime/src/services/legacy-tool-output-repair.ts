/**
 * 修复旧版 Runtime 写进 `narrator_tool_calls.output_json` 的非 JSON 纯文本。
 *
 * 0.9 之前的 Runtime 会把部分工具结果（Skill 原文、`Unknown tool: …`、`Invalid parameters: …`
 * 等）原样存进这个 JSON 列。旧读取路径能容忍；0.9 的历史显示 worker 逐行 `JSON.parse`，
 * 遇到一行就整页报 `Invalid stored display JSON: outputJson`，该叙述者的对话历史整体打不开。
 *
 * 修法是 `json_quote(output_json)`：把纯文本包成 JSON 字符串。这与现行写入路径存字符串结果
 * 的形态完全一致（同库里已有大量 `"..."` 形态的合法行），往返无损，不丢任何内容。
 *
 * 只动 `json_valid = 0` 的行，所以重复执行是空操作。全表扫描按库大小线性增长（30 MB 输出约
 * 160 ms），因此成功一次后在产品库 kv_store 记标记，之后启动直接跳过；失败不记标记，下次重试，
 * 也不阻断启动——修不好时用户至少还能进来导出书。
 */

import { db as runtimeDb, logger } from "@vivy1024/narrafork-runtime-bridge";
import { sql } from "@vivy1024/narrafork-runtime-bridge/runtime-db";
import type { StorageDatabase } from "@vivy1024/novelfork-core";

export const LEGACY_TOOL_OUTPUT_REPAIR_MARKER = "runtime-repair:narrator-tool-calls-output-json:v1";

export interface LegacyToolOutputRepairResult {
	/** 本次是否实际执行了扫描（已有标记时为 false）。 */
	readonly scanned: boolean;
	/** 被改写的工具调用行数（不含触发器连带改动的其他表）。 */
	readonly repaired: number;
}

function hasMarker(storage: StorageDatabase): boolean {
	const row = storage.sqlite
		.prepare(`SELECT 1 AS present FROM "kv_store" WHERE "key" = ?`)
		.get(LEGACY_TOOL_OUTPUT_REPAIR_MARKER);
	return Boolean(row);
}

function writeMarker(storage: StorageDatabase, repaired: number): void {
	storage.sqlite
		.prepare(
			`INSERT INTO "kv_store" ("key", "value", "updated_at") VALUES (?, ?, ?)
			 ON CONFLICT("key") DO UPDATE SET "value" = excluded."value", "updated_at" = excluded."updated_at"`,
		)
		.run(LEGACY_TOOL_OUTPUT_REPAIR_MARKER, JSON.stringify({ repaired }), Date.now());
}

export function repairLegacyToolCallOutputJson(storage: StorageDatabase): LegacyToolOutputRepairResult {
	if (hasMarker(storage)) return { scanned: false, repaired: 0 };
	try {
		// 先数再改：UPDATE 的 changes 会把行触发器连带写的块状态也算进去，不能拿来报数。
		const counted = runtimeDb.transaction((tx) => {
			const [row] = tx.all<{ n: number }>(
				sql`SELECT count(*) AS n FROM narrator_tool_calls
				    WHERE output_json IS NOT NULL AND json_valid(output_json) = 0`,
			);
			const invalid = Number(row?.n ?? 0);
			if (invalid > 0) {
				tx.run(
					sql`UPDATE narrator_tool_calls SET output_json = json_quote(output_json)
					    WHERE output_json IS NOT NULL AND json_valid(output_json) = 0`,
				);
			}
			return invalid;
		});
		writeMarker(storage, counted);
		if (counted > 0) {
			logger.info("Repaired legacy non-JSON tool call outputs", { count: counted });
		}
		return { scanned: true, repaired: counted };
	} catch (error) {
		logger.warn("Could not repair legacy tool call outputs; will retry next startup", {
			error: String(error),
		});
		return { scanned: true, repaired: 0 };
	}
}
