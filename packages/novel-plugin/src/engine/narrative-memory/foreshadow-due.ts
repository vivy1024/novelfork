/**
 * 本章到期伏笔：预定回收区间（fields.targetRange / 旧 targetChapter）覆盖或临近本章、且尚未回收的经纬伏笔。
 * write.preflight 的「本章到期伏笔」段、pipeline.write 的 hook_debt 与 hooks 通道共用这一份筛选口径。
 */

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { loadForeshadowEntries, loadForeshadowStates, type ForeshadowPhase } from "../narrative-taxonomy/foreshadow-states.js";
import {
  formatChapterRange,
  HOOK_IMPORTANCE_RANK,
  parseForeshadowLedgerFields,
  resolveHookImportance,
  targetRangeStatus,
  type ChapterRange,
  type HookImportance,
} from "./foreshadow-ledger.js";

export const DUE_FORESHADOW_SECTION_TITLE = "本章到期伏笔";
export const DEFAULT_DUE_FORESHADOW_LIMIT = 6;
/** 区间起点在本章之后几章内也算「即将到期」，给写手留出铺垫空间。 */
export const DUE_APPROACH_WINDOW = 2;

export interface DueForeshadowInput {
  readonly entryId: string;
  readonly title: string;
  readonly phase: ForeshadowPhase;
  readonly fields: Record<string, unknown>;
  readonly seedText?: string;
}

export interface DueForeshadow {
  readonly entryId: string;
  readonly title: string;
  readonly range: ChapterRange;
  readonly status: "approaching" | "in-range" | "overdue";
  readonly overdueBy: number;
  readonly importance: HookImportance;
  readonly triggerCondition?: string;
  readonly payoffConstraint?: string;
  readonly seedText?: string;
}

/** 纯函数：未回收、有预定回收区间、本章在区间内 / 已过 / 起点在 2 章内。排序：截止章升序 → 分量 → 标题。 */
export function selectDueForeshadows(
  entries: readonly DueForeshadowInput[],
  currentChapter: number,
  options: { readonly limit?: number } = {},
): DueForeshadow[] {
  const limit = Math.max(0, options.limit ?? DEFAULT_DUE_FORESHADOW_LIMIT);
  return entries
    .flatMap((entry): DueForeshadow[] => {
      if (entry.phase === "paid_off" || entry.phase === "abandoned") return [];
      const ledger = parseForeshadowLedgerFields(entry.fields);
      if (!ledger.targetRange) return [];
      const { status, overdueBy } = targetRangeStatus(ledger.targetRange, currentChapter, DUE_APPROACH_WINDOW);
      if (status !== "approaching" && status !== "in-range" && status !== "overdue") return [];
      return [{
        entryId: entry.entryId,
        title: entry.title,
        range: ledger.targetRange,
        status,
        overdueBy,
        importance: resolveHookImportance(ledger),
        ...(ledger.triggerCondition ? { triggerCondition: ledger.triggerCondition } : {}),
        ...(ledger.payoffConstraint ? { payoffConstraint: ledger.payoffConstraint } : {}),
        ...(entry.seedText ? { seedText: entry.seedText } : {}),
      }];
    })
    .sort((a, b) => a.range.to - b.range.to
      || HOOK_IMPORTANCE_RANK[b.importance] - HOOK_IMPORTANCE_RANK[a.importance]
      || a.title.localeCompare(b.title))
    .slice(0, limit);
}

/** 读库：经纬伏笔条目 + 派生阶段（只看本章之前的事件）。读不到返回空。 */
export function loadDueForeshadows(
  storage: StorageDatabase,
  bookId: string,
  currentChapter: number,
  options: { readonly limit?: number } = {},
): DueForeshadow[] {
  try {
    const entries = loadForeshadowEntries(storage, bookId);
    if (entries.length === 0) return [];
    const phaseById = new Map(loadForeshadowStates(storage, bookId, { beforeChapter: currentChapter }).map((state) => [state.entryId, state]));
    const contentById = loadContentById(storage, bookId, entries.map((entry) => entry.id));
    return selectDueForeshadows(entries.flatMap((entry) => {
      const state = phaseById.get(entry.id);
      if (!state) return [];
      const seed = (contentById.get(entry.id) ?? "").replace(/\s+/gu, " ").trim().slice(0, 120);
      return [{ entryId: entry.id, title: state.label, phase: state.phase, fields: entry.fields, ...(seed ? { seedText: seed } : {}) }];
    }), currentChapter, options);
  } catch {
    return [];
  }
}

function loadContentById(storage: StorageDatabase, bookId: string, ids: readonly string[]): Map<string, string> {
  if (ids.length === 0) return new Map();
  const rows = storage.sqlite.prepare<{ id: string; content: string | null }>(`
    SELECT id, content_md AS content FROM story_jingwei_entry WHERE book_id = ? AND deleted_at IS NULL
  `).all(bookId);
  const wanted = new Set(ids);
  return new Map(rows.filter((row) => wanted.has(row.id)).map((row) => [row.id, row.content ?? ""]));
}

export function dueForeshadowStatusText(hook: DueForeshadow): string {
  const range = formatChapterRange(hook.range);
  if (hook.status === "overdue") return `预定${range}回收，已超出 ${hook.overdueBy} 章`;
  if (hook.status === "in-range") return `预定${range}回收，本章在区间内`;
  return `预定${range}回收，即将到期`;
}

/** 单条到期伏笔的一行说明（不含标题）。 */
export function describeDueForeshadow(hook: DueForeshadow): string {
  return [
    dueForeshadowStatusText(hook),
    hook.payoffConstraint ? `回收要求：${hook.payoffConstraint}` : "",
    hook.triggerCondition ? `触发条件：${hook.triggerCondition}` : "",
    !hook.payoffConstraint && !hook.triggerCondition && hook.seedText ? `原文承诺：${hook.seedText}` : "",
  ].filter(Boolean).join("；");
}

/** write.preflight 召回文本里的「本章到期伏笔」段；没有到期伏笔返回空串。 */
export function renderDueForeshadowSection(hooks: readonly DueForeshadow[]): string {
  if (hooks.length === 0) return "";
  return [
    `【${DUE_FORESHADOW_SECTION_TITLE}】这些伏笔的预定回收区间已到本章附近：本章安排回收或明确推进；确实要推迟，先跟作者说明。`,
    ...hooks.map((hook) => `- 「${hook.title}」${describeDueForeshadow(hook)}`),
  ].join("\n");
}
