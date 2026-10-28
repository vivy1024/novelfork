/**
 * T2 · 伏笔收敛沙漏与到期窗口（墨枢方案移植，纯函数零副作用）。
 *
 * - 收敛沙漏：按 current/targetChapters 推导叙事阶段；
 *   CONVERGENCE（≥75%）禁止开新伏笔，FINALE（≥95%）应集中回收。
 * - 到期窗口：targetChapter ≤ 当前+2 的未回收伏笔即「本章应推进」，
 *   按到期章号升序取 top3 注入写前上下文（激活 runtime/hook_debt 死管道）。
 */

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
 * 排序：埋得越久（currentChapter - setupChapter）与重要度越高越优先——
 *   优先分 = 悬置章数 × (0.5 + importance/100)；同分按埋设章升序。截取 limit。
 * 只看 currentChapter 之前的推进记录（修旧章时，未来章的推进不算）。
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
      const importance = Math.min(100, Math.max(0, entry.importance ?? 40));
      const rank = (currentChapter - entry.setupChapter) * (0.5 + importance / 100);
      return [{ ...entry, setupChapter: entry.setupChapter, idleChapters, rank }];
    })
    .sort((a, b) => b.rank - a.rank || a.setupChapter - b.setupChapter || a.title.localeCompare(b.title))
    .slice(0, limit)
    .map(({ rank: _rank, ...hook }) => hook);
}
