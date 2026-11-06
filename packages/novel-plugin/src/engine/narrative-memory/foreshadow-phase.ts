/**
 * T2 · 伏笔收敛沙漏与到期窗口（墨枢方案移植，纯函数零副作用）。
 *
 * - 收敛沙漏：按 current/targetChapters 推导叙事阶段；
 *   CONVERGENCE（≥75%）禁止开新伏笔，FINALE（≥95%）应集中回收。
 * - 到期窗口：targetChapter ≤ 当前+2 的未回收伏笔即「本章应推进」，
 *   按到期章号升序取 top3 注入写前上下文（激活 runtime/hook_debt 死管道）。
 */

import { HOOK_IMPORTANCE_MULTIPLIER, resolveHookImportance, type HookImportance } from "./foreshadow-ledger.js";

export type ForeshadowPhase = "development" | "convergence" | "finale";

const CONVERGENCE_THRESHOLD = 0.75;
const FINALE_THRESHOLD = 0.95;

export function foreshadowPhase(currentChapter: number, targetChapters: number | undefined | null): ForeshadowPhase {
  if (!targetChapters || targetChapters <= 0 || currentChapter <= 0) return "development";
  const progress = currentChapter / targetChapters;
  if (progress >= FINALE_THRESHOLD) return "finale";
  if (progress >= CONVERGENCE_THRESHOLD) return "convergence";
  return "development";
}

/** 未回收状态集合（含 CFPG triggered / 经纬「唤醒中」）。 */
export const ACTIVE_HOOK_STATUSES: readonly string[] = [
  "已埋设",
  "部分揭示",
  "唤醒中",
  "triggered",
  "paying_off",
  "planted",
  "reinforced",
  "open",
  "progressing",
];

export interface DueHookInput {
  readonly title: string;
  readonly status: string;
  /** 预期回收章号（fields.targetChapter）；0/缺省视为未排期。 */
  readonly targetChapter?: number;
  /** 种子文本（条目正文首段），注入时给写手具体承诺原文。 */
  readonly seedText?: string;
}

export interface DueHook extends DueHookInput {
  readonly dueChapter: number;
}

/**
 * 到期窗口筛选：未回收 且 targetChapter ∈ [1, current+窗口]。
 * 排序：先过期（target < current）在前，再按 target 升序；截取 limit。
 */
export function selectDueHooks(
  entries: readonly DueHookInput[],
  currentChapter: number,
  options: { readonly window?: number; readonly limit?: number } = {},
): DueHook[] {
  const window = options.window ?? 2;
  const limit = options.limit ?? 3;
  return entries
    .filter((entry): entry is DueHookInput & { targetChapter: number } => {
      if (!ACTIVE_HOOK_STATUSES.includes(entry.status)) return false;
      const target = entry.targetChapter;
      return typeof target === "number" && Number.isInteger(target) && target >= 1 && target <= currentChapter + window;
    })
    .sort((a, b) => a.targetChapter - b.targetChapter)
    .slice(0, limit)
    .map((entry) => ({ ...entry, dueChapter: entry.targetChapter }));
}

/** 长线伏笔休眠阈值：超过这么多章没被推进的未回收伏笔，写前提醒作者别忘了。 */
// 提醒按「多久没被想起」轮转，见 selectDormantHooks。
export const DEFAULT_DORMANT_HOOK_CHAPTERS = 30;
export const DEFAULT_DORMANT_HOOK_LIMIT = 3;

/** 已回收 / 已废弃的状态写法（中英两套），不进休眠提醒。 */
const TERMINAL_HOOK_STATUSES: readonly string[] = ["已回收", "已兑现", "已废弃", "paid_off", "paid-off", "resolved", "abandoned", "contradicted"];

export interface DormantHookInput {
  readonly title: string;
  readonly status: string;
  /** 埋设章（派生：条目 plantedChapter 或首条 hook_planted 事件）。 */
  readonly setupChapter?: number;
  /** 最近一次被推进的章（派生：见 foreshadow-states 的 lastProgressChapter）；缺省按埋设章算。 */
  readonly lastProgressChapter?: number;
  /** 预期回收章；落在到期窗口内的交给 selectDueHooks，这里不重复提醒。 */
  readonly targetChapter?: number;
  /** 经纬条目重要度（0–100，默认 40）。 */
  readonly importance?: number;
  /** 伏笔分量（条目 fields.importance：low/med/high）；填了优先于 importance 数值。 */
  readonly hookImportance?: HookImportance;
  /** 当前章之前最近一次被休眠提醒的章（条目 fields.remindedChapters 派生）。 */
  readonly lastRemindedChapter?: number;
  readonly seedText?: string;
}

export interface DormantHook extends DormantHookInput {
  readonly setupChapter: number;
  /** 距最近一次推进（无推进记录则距埋设）已过去的章数。 */
  readonly idleChapters: number;
}

function validChapter(value: number | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

/**
 * 休眠长线伏笔：未回收、埋设章 < currentChapter，且距最近一次推进 ≥ thresholdChapters 章。
 * 轮转排序：按「多久没被想起」——距 max(最近一次提醒, 最近一次推进, 埋设章) 的章数 × 分量系数
 *   （低 0.7 / 中 1 / 高 1.4）；同分按埋设章升序、标题。截取 limit。
 * 被提醒过的伏笔等待章数归零、排到队尾，于是池子里每条都会轮到：N 条休眠、每章 k 条时，
 * 同分量的伏笔大约每 N/k 章出现一次，高分量的更勤。
 * 只看 currentChapter 之前的推进与提醒记录（修旧章 / 同章重跑召回时结果不变）。
 */
export function selectDormantHooks(
  entries: readonly DormantHookInput[],
  currentChapter: number,
  options: { readonly thresholdChapters?: number; readonly limit?: number; readonly dueWindow?: number } = {},
): DormantHook[] {
  const threshold = Math.max(1, options.thresholdChapters ?? DEFAULT_DORMANT_HOOK_CHAPTERS);
  const limit = Math.max(0, options.limit ?? DEFAULT_DORMANT_HOOK_LIMIT);
  const dueWindow = options.dueWindow ?? 2;
  if (!validChapter(currentChapter) || limit === 0) return [];
  return entries
    .flatMap((entry): Array<DormantHook & { readonly rank: number }> => {
      if (TERMINAL_HOOK_STATUSES.includes(entry.status.trim().toLowerCase()) || TERMINAL_HOOK_STATUSES.includes(entry.status.trim())) return [];
      if (!validChapter(entry.setupChapter) || entry.setupChapter >= currentChapter) return [];
      if (validChapter(entry.targetChapter) && entry.targetChapter <= currentChapter + dueWindow) return [];
      const progress = validChapter(entry.lastProgressChapter) && entry.lastProgressChapter < currentChapter
        ? Math.max(entry.lastProgressChapter, entry.setupChapter)
        : entry.setupChapter;
      const idleChapters = currentChapter - progress;
      if (idleChapters < threshold) return [];
      const reminded = validChapter(entry.lastRemindedChapter) && entry.lastRemindedChapter < currentChapter ? entry.lastRemindedChapter : 0;
      const waited = currentChapter - Math.max(progress, reminded);
      const tier = entry.hookImportance ?? resolveHookImportance({ triggerKeywords: [], remindedChapters: [] }, entry.importance);
      const rank = waited * HOOK_IMPORTANCE_MULTIPLIER[tier];
      return [{ ...entry, setupChapter: entry.setupChapter, idleChapters, rank }];
    })
    .sort((a, b) => b.rank - a.rank || a.setupChapter - b.setupChapter || a.title.localeCompare(b.title))
    .slice(0, limit)
    .map(({ rank: _rank, ...hook }) => hook);
}
