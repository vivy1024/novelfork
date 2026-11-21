/**
 * 执笔 / 返修草稿写盘审计（产品侧，零 fork 改动）。
 *
 * Runtime 自带的 Write / Edit 不经过产品适配器，产品没有内置工具的执行前否决点
 * （product-host SPI 只有贡献工具的 execute / 可见性；PreToolUse 是用户配置的命令 / HTTP 钩子，
 * fail-open，不能当权威约束）。这里退而做事后核对：交稿（workflow.step submit kind=prose）
 * 与落盘（chapter.commit）之前，读 Runtime 自己记录的工具调用（narrator_tool_calls），
 * 核对本运行的领导者及其派出的执笔 / 返修子代理在本轮工序里用原生写文件工具写过的路径；
 * 越出本章草稿范围的，拒绝本次交稿 / 落盘并给出三段式说明。
 *
 * 判定规则在插件的 draft-write-scope 模块；这里只负责取证与编排。
 * 只读 Runtime 记录的路径列与 input_json 里的 file_path，不读写入正文（大字段）。
 */

import { realpath } from "node:fs/promises";

import { getStorageDatabase } from "@vivy1024/novelfork-core";
import { db as runtimeDb, narrators, narratorToolCalls } from "@vivy1024/narrafork-runtime-bridge";
import { and, desc, eq, inArray, sql } from "@vivy1024/narrafork-runtime-bridge/runtime-db";
import {
	classifyWorkflowNativeWrite,
	explainOutOfScopeNativeWrites,
	listWorkflowRunEvents,
	NATIVE_FILE_WRITE_TOOLS,
	ROSTER_DRAFT_WRITER_TEMPLATE_IDS,
	workflowDraftRoundStart,
	type WorkflowExplanation,
	type WorkflowNativeWriteViolation,
	type WorkflowRunRecord,
} from "@vivy1024/novelfork-novel-plugin/engine";

/** Runtime 记录的一次原生写文件调用（只含路径与时间）。 */
export interface NativeFileWriteRecord {
	readonly toolName: string;
	/** Runtime 解析后的路径（canonical 优先，其次 resolved，最后是 input 里的 file_path）。 */
	readonly filePath: string | null;
	readonly cwd: string | null;
	readonly createdAt: string | null;
}

export interface DraftWriteAuditSeams {
	/** 这些叙述者在 sinceMs 之后的原生写文件调用。 */
	readonly listNativeWrites?: (narratorIds: readonly string[], sinceMs: number) => Promise<readonly NativeFileWriteRecord[]>;
	/** 领导者派出的、带原生写文件工具的内置子代理。 */
	readonly listDraftWriterChildren?: (leaderNarratorId: string) => Promise<readonly string[]>;
	/** 本轮工序的起点（毫秒）。 */
	readonly roundStart?: (run: WorkflowRunRecord) => number;
	/** 书根的真实路径（联接 / 符号链接）；取不到时为 null。 */
	readonly realpath?: (path: string) => Promise<string | null>;
}

export type DraftWriteAuditPhase = "submit" | "commit";

/** 哪些调用要先过审计：正文交稿与落盘。其它工具不查。 */
export function draftWriteAuditPhase(
	canonicalToolName: string,
	input: Readonly<Record<string, unknown>>,
): DraftWriteAuditPhase | null {
	if (canonicalToolName === "chapter.commit") return "commit";
	if (canonicalToolName !== "workflow.step") return null;
	const action = typeof input.action === "string" ? input.action.trim().toLowerCase() : "current";
	return action === "submit" && input.kind === "prose" ? "submit" : null;
}

const MAX_AUDITED_CALLS = 500;

interface NativeWriteRow {
	readonly toolName: string;
	readonly canonicalFilePath: unknown;
	readonly resolvedFilePath: unknown;
	readonly inputFilePath: unknown;
	readonly executionCwd: unknown;
	readonly createdAt: unknown;
}
const MAX_CHILDREN = 50;

async function defaultListNativeWrites(
	narratorIds: readonly string[],
	sinceMs: number,
): Promise<readonly NativeFileWriteRecord[]> {
	if (narratorIds.length === 0) return [];
	const rows = await runtimeDb
		.select({
			toolName: narratorToolCalls.toolName,
			canonicalFilePath: narratorToolCalls.canonicalFilePath,
			resolvedFilePath: narratorToolCalls.resolvedFilePath,
			inputFilePath: sql<string | null>`json_extract(${narratorToolCalls.inputJson}, '$.file_path')`,
			executionCwd: narratorToolCalls.executionCwd,
			createdAt: narratorToolCalls.createdAt,
		})
		.from(narratorToolCalls)
		.where(and(
			inArray(narratorToolCalls.narratorId, [...narratorIds]),
			inArray(narratorToolCalls.toolName, [...NATIVE_FILE_WRITE_TOOLS]),
			// 只认真正执行过 / 正在执行的；待批准、初始化中的还没写，失败的没写成。
			inArray(narratorToolCalls.status, ["success", "running"]),
		))
		.orderBy(desc(narratorToolCalls.createdAt))
		.limit(MAX_AUDITED_CALLS);
	const typedRows = rows as readonly NativeWriteRow[];
	return typedRows
		.map((row) => ({
			toolName: row.toolName,
			filePath: firstText(row.canonicalFilePath, row.resolvedFilePath, row.inputFilePath),
			cwd: firstText(row.executionCwd),
			createdAt: firstText(row.createdAt),
		}))
		.filter((row: NativeFileWriteRecord) => isAtOrAfter(row.createdAt, sinceMs));
}

function firstText(...values: readonly unknown[]): string | null {
	for (const value of values) {
		if (typeof value === "string" && value.trim()) return value;
	}
	return null;
}

/** 时间读不出来时按「在本轮内」处理：宁可多查，不放过。 */
function isAtOrAfter(createdAt: string | null, sinceMs: number): boolean {
	if (!createdAt) return true;
	const at = Date.parse(createdAt);
	return Number.isNaN(at) || at >= sinceMs;
}

async function defaultListDraftWriterChildren(leaderNarratorId: string): Promise<readonly string[]> {
	if (ROSTER_DRAFT_WRITER_TEMPLATE_IDS.length === 0) return [];
	const rows = await runtimeDb
		.select({ id: narrators.id })
		.from(narrators)
		.where(and(
			eq(narrators.parentNarratorId, leaderNarratorId),
			eq(narrators.type, "subagent"),
			inArray(narrators.subagentType, [...ROSTER_DRAFT_WRITER_TEMPLATE_IDS]),
		))
		.orderBy(desc(narrators.createdAt))
		.limit(MAX_CHILDREN);
	return (rows as readonly { id: string }[]).map((row) => row.id);
}

function defaultRoundStart(run: WorkflowRunRecord): number {
	return workflowDraftRoundStart(run.createdAt, listWorkflowRunEvents(getStorageDatabase(), run.id));
}

async function defaultRealpath(path: string): Promise<string | null> {
	return realpath(path).catch(() => null);
}

export type DraftWriteAuditResult =
	| { readonly ok: true }
	| { readonly ok: false; readonly code: string; readonly explanation: WorkflowExplanation; readonly violations: readonly WorkflowNativeWriteViolation[] };

/**
 * 核对本运行在本轮工序里的原生写盘。
 * 取证失败（Runtime 库或工作流存储读不出来）时 fail-closed：交稿 / 落盘是正文进入作者审阅
 * 与书籍数据的唯一入口，核对做不了就不能放行。
 */
export async function auditWorkflowDraftWrites(
	input: Readonly<{
		run: WorkflowRunRecord;
		/** 运行的领导者叙述者（委派子代理调用时传它的领导者）。 */
		leaderNarratorId: string;
		/** 发起本次调用的叙述者（子代理自己或领导者）。 */
		callerNarratorId: string;
		bookRoot: string;
		phase: DraftWriteAuditPhase;
	}>,
	seams: DraftWriteAuditSeams = {},
): Promise<DraftWriteAuditResult> {
	let records: readonly NativeFileWriteRecord[];
	let bookRoots: string[];
	try {
		const since = (seams.roundStart ?? defaultRoundStart)(input.run);
		const children = await (seams.listDraftWriterChildren ?? defaultListDraftWriterChildren)(input.leaderNarratorId);
		const narratorIds = [...new Set([input.leaderNarratorId, input.callerNarratorId, ...children])];
		records = await (seams.listNativeWrites ?? defaultListNativeWrites)(narratorIds, since);
		const canonicalRoot = await (seams.realpath ?? defaultRealpath)(input.bookRoot);
		bookRoots = [...new Set([input.bookRoot, ...(canonicalRoot ? [canonicalRoot] : [])])];
	} catch {
		return {
			ok: false,
			code: "workflow-draft-audit-unavailable",
			explanation: {
				what: `${input.phase === "submit" ? "交稿" : "落盘"}被拦下：无法核对本轮工序的原生写盘记录`,
				why: "执笔 / 返修用原生 Write / Edit 写草稿，产品只能按 Runtime 的工具调用记录核对有没有写到草稿之外；记录读不出来时放行，可能让越界写入随正文一起进入作者审阅与书籍数据",
				action: "稍后重试；若反复失败，重启产品、确认运行状态后再执行",
			},
			violations: [],
		};
	}
	const violations: WorkflowNativeWriteViolation[] = [];
	for (const record of records) {
		if (!record.filePath) {
			// 写文件却没有路径：没法证明它写在草稿内，按越界处理。
			violations.push({ toolName: record.toolName, display: "（路径未知）" });
			continue;
		}
		const verdict = classifyWorkflowNativeWrite(bookRoots, input.run.chapterNumber, record.filePath, record.cwd);
		if (verdict.kind === "violation") {
			violations.push({ toolName: record.toolName, display: verdict.relativePath ?? verdict.path });
		}
	}
	const explanation = explainOutOfScopeNativeWrites(input.run.chapterNumber, violations, input.phase);
	return explanation
		? { ok: false, code: "workflow-draft-write-out-of-scope", explanation, violations }
		: { ok: true };
}
