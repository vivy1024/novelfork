/**
 * 旧工具调用记录的定期瘦身（Runtime 的「工具调用载荷」清理，默认 180 天）。
 *
 * Runtime 只在「设置 › 存储」里由管理员手动触发这项清理，从不自动执行，所以真实库里
 * 写章 / 读章的工具输入输出（含整章正文）会无限累积。这里由产品按天调度同一个清理：
 *
 * - 范围：只把超过保留期的 narrator_tool_calls 的 input_json / output_json 置空，行本身保留
 *   （执行日志里仍能看到调用过什么，只是看不到旧参数与输出）；文件历史回放用的检查点行不动。
 * - 不碰：会话与消息、章节文件、产品库（章节正文原件在书根的 chapters/ 下，与此无关）。
 * - 节奏：启动后延迟一会儿跑一次，之后每 24 小时检查一次；上次成功时间记在产品库 kv_store，
 *   一天内重启不会重复执行。失败只告警，下次再试。
 */

import { clearAgedToolCallPayloads, logger } from "@vivy1024/narrafork-runtime-bridge";
import type { StorageDatabase } from "@vivy1024/novelfork-core";

export const TOOL_PAYLOAD_RETENTION_DAYS = 180;
export const TOOL_PAYLOAD_RETENTION_MARKER = "maintenance:tool-call-payload-retention:last-run";
const RUN_INTERVAL_MS = 24 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 2 * 60 * 1000;

export interface ToolPayloadRetentionDeps {
	readonly storage: StorageDatabase;
	readonly clear?: typeof clearAgedToolCallPayloads;
	readonly now?: () => number;
	readonly retentionDays?: number;
}

function lastRunAt(storage: StorageDatabase): number | null {
	const row = storage.sqlite
		.prepare<{ value: string }>(`SELECT "value" FROM "kv_store" WHERE "key" = ?`)
		.get(TOOL_PAYLOAD_RETENTION_MARKER);
	if (!row) return null;
	try {
		const at = (JSON.parse(row.value) as { at?: unknown }).at;
		return typeof at === "number" ? at : null;
	} catch {
		return null;
	}
}

function writeLastRun(storage: StorageDatabase, value: Record<string, unknown>, at: number): void {
	storage.sqlite
		.prepare(
			`INSERT INTO "kv_store" ("key", "value", "updated_at") VALUES (?, ?, ?)
			 ON CONFLICT("key") DO UPDATE SET "value" = excluded."value", "updated_at" = excluded."updated_at"`,
		)
		.run(TOOL_PAYLOAD_RETENTION_MARKER, JSON.stringify({ ...value, at }), at);
}

export type ToolPayloadRetentionOutcome =
	| { readonly ran: false; readonly reason: "recent" }
	| { readonly ran: true; readonly toolCalls: number; readonly approxBytes: number }
	| { readonly ran: false; readonly reason: "failed"; readonly error: string };

/** 距上次成功不足 24 小时就跳过；否则执行一次清理并记下时间。 */
export async function runToolPayloadRetentionIfDue(deps: ToolPayloadRetentionDeps): Promise<ToolPayloadRetentionOutcome> {
	const now = deps.now ?? Date.now;
	const previous = lastRunAt(deps.storage);
	if (previous !== null && now() - previous < RUN_INTERVAL_MS) return { ran: false, reason: "recent" };
	const days = deps.retentionDays ?? TOOL_PAYLOAD_RETENTION_DAYS;
	try {
		const result = await (deps.clear ?? clearAgedToolCallPayloads)(days);
		writeLastRun(deps.storage, { retentionDays: days, toolCalls: result.toolCalls, approxBytes: result.approxBytes }, now());
		if (result.toolCalls > 0) {
			logger.info("Cleared aged tool call payloads", {
				retentionDays: days,
				toolCalls: result.toolCalls,
				approxBytes: result.approxBytes,
			});
		}
		return { ran: true, toolCalls: result.toolCalls, approxBytes: result.approxBytes };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.warn("Aged tool call payload cleanup failed; will retry later", { error: message });
		return { ran: false, reason: "failed", error: message };
	}
}

let timers: { startup?: ReturnType<typeof setTimeout>; interval?: ReturnType<typeof setInterval> } = {};

/** 启动调度（重复调用只保留一套定时器）。定时器不阻止进程退出。 */
export function startToolPayloadRetention(deps: ToolPayloadRetentionDeps): void {
	stopToolPayloadRetention();
	const tick = () => {
		void runToolPayloadRetentionIfDue(deps);
	};
	timers.startup = setTimeout(tick, STARTUP_DELAY_MS);
	timers.interval = setInterval(tick, RUN_INTERVAL_MS);
	timers.startup.unref?.();
	timers.interval.unref?.();
}

export function stopToolPayloadRetention(): void {
	if (timers.startup) clearTimeout(timers.startup);
	if (timers.interval) clearInterval(timers.interval);
	timers = {};
}
