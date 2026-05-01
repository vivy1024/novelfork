/** 伏笔过期风险计算 */
import type { CockpitHookEntry, HookRiskLevel } from "./cockpit-types";

/**
 * 计算伏笔的过期风险等级。
 * @param sourceChapter 伏笔的来源章节号
 * @param currentChapter 当前最新章节号
 * @param threshold 过期阈值（默认 15 章）
 */
export function computeHookRisk(
  sourceChapter: number,
  status: string,
  currentChapter: number,
  threshold = 15,
): HookRiskLevel | "resolved" | "frozen" {
  if (status === "resolved") return "resolved";
  if (status === "frozen") return "frozen";

  const gap = currentChapter - sourceChapter;
  if (gap > threshold) return "expired-risk";
  if (gap > threshold * 0.7) return "payoff-due";
  return "open";
}

/**
 * 为伏笔条目打上风险等级标签。
 */
export function classifyHookEntry(
  entry: Pick<CockpitHookEntry, "sourceChapter" | "status">,
  currentChapter: number,
  threshold?: number,
): CockpitHookEntry["status"] {
  return computeHookRisk(entry.sourceChapter, entry.status, currentChapter, threshold);
}
