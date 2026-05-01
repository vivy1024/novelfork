/** 驾驶舱类型定义 */

/** 数据来源标识 */
export interface CockpitSourceRef {
  kind: "truth-file" | "bible-entry" | "bible-event" | "bible-setting" | "chapter" | "provider";
  id: string;
  label: string;
  file?: string;
}

/** 统一信号模型 — 每条数据项的状态 */
export type CockpitSignal<T> =
  | { status: "available"; value: T; sources: CockpitSourceRef[] }
  | { status: "empty"; reason: string }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "unsupported"; reason: string };

/** 伏笔条目 */
export interface CockpitHookEntry {
  id: string;
  text: string;
  sourceChapter: number;
  status: HookRiskLevel | "resolved" | "frozen";
  sourceFile: string;
  sourceKind: "bible-event" | "pending-hooks";
}

/** 伏笔过期风险等级 */
export type HookRiskLevel = "open" | "payoff-due" | "expired-risk";

/** 设定条目 */
export interface CockpitSettingEntry {
  id: string;
  title: string;
  category: string;
  content: string;
  sourceFile?: string;
}

/** 风险卡片 */
export interface CockpitRiskCard {
  id: string;
  kind: "expired-hook" | "audit-failure" | "tone-drift";
  title: string;
  detail: string;
  chapterNumber?: number;
  navigateTo: string;
  level: "warning" | "danger";
}

/** 日更进度 */
export interface CockpitProgress {
  todayWords: number;
  dailyTarget: number;
  streak: number;
  weeklyWords: number;
}

/** 章节摘要条目 */
export interface CockpitChapterSummary {
  number: number;
  summary: string;
}
