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
