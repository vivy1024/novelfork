/**
 * 伏笔条目的可选结构化字段（存在经纬条目 fields_json，无需迁移）与召回相关度打分（纯函数）。
 *
 * 参考 CFPG 的「伏笔—触发—兑现」三元组与 NstAgent 的带键承诺：伏笔条目可以带
 * - triggerCondition：触发条件（自由文本）
 * - triggerKeywords：触发词（人物 / 物件 / 地点等），本章出现时优先想起它
 * - targetRange（或旧字段 targetChapter）：预定回收章 / 区间
 * - payoffConstraint：回收时必须成立的事
 * - importance：low / med / high（伏笔自身的分量，与条目的 0–100 注入重要度分开）
 * - remindedChapters：系统记录的最近几次休眠提醒章（升序，最多 REMINDED_HISTORY_LIMIT 个），供轮转用（不在编辑器里展示）。
 *   存一小段历史而不是单个「上次提醒章」：轮转只看当前章之前的提醒，同一章重跑召回（写前检查与保存前
 *   各跑一次）或回头修旧章时结果不变。
 * 老条目没有这些字段时一律按空处理，行为退回到只看文本相关度。
 */

export type HookImportance = "low" | "med" | "high";

export interface ChapterRange {
  readonly from: number;
  readonly to: number;
}

export interface ForeshadowLedgerFields {
  readonly triggerCondition?: string;
  readonly triggerKeywords: readonly string[];
  readonly targetRange?: ChapterRange;
  readonly payoffConstraint?: string;
  readonly importance?: HookImportance;
  readonly remindedChapters: readonly number[];
}

export const REMINDED_HISTORY_LIMIT = 6;

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
}

function toChapter(value: unknown): number | undefined {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && /^\s*\d+\s*$/u.test(value) ? Number(value) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function rangeOf(a: number | undefined, b: number | undefined): ChapterRange | undefined {
  if (a === undefined && b === undefined) return undefined;
  const from = a ?? b!;
  const to = b ?? a!;
  return from <= to ? { from, to } : { from: to, to: from };
}

/**
 * 预定回收章：接受 "120-140" / "120~140" / "120—140" / "第120到140章" / "120" / 数字 / [120,140] / {from,to}。
 * 解析不了返回 undefined（不猜）。
 */
export function parseChapterRange(value: unknown): ChapterRange | undefined {
  if (typeof value === "number") return rangeOf(toChapter(value), undefined);
  if (Array.isArray(value)) return rangeOf(toChapter(value[0]), toChapter(value[1]));
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return rangeOf(toChapter(record.from ?? record.start), toChapter(record.to ?? record.end));
  }
  if (typeof value !== "string") return undefined;
  const numbers = value.match(/\d+/gu);
  if (!numbers || numbers.length === 0 || numbers.length > 2) return undefined;
  return rangeOf(toChapter(numbers[0]), toChapter(numbers[1]));
}

export function parseHookImportance(value: unknown): HookImportance | undefined {
  const raw = clean(value).toLowerCase();
  if (["high", "h", "高", "重要", "核心"].includes(raw)) return "high";
  if (["med", "medium", "mid", "m", "中", "普通"].includes(raw)) return "med";
  if (["low", "l", "低", "次要"].includes(raw)) return "low";
  return undefined;
}

function parseKeywords(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : typeof value === "string" ? value.split(/[,，、;；\n]/u) : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of raw) {
    const keyword = item.trim();
    if (!keyword || seen.has(keyword)) continue;
    seen.add(keyword);
    result.push(keyword);
  }
  return result;
}

export function parseForeshadowLedgerFields(fields: Record<string, unknown> | null | undefined): ForeshadowLedgerFields {
  const values = fields ?? {};
  const triggerCondition = clean(values.triggerCondition);
  const payoffConstraint = clean(values.payoffConstraint);
  const targetRange = parseChapterRange(values.targetRange) ?? parseChapterRange(values.targetChapter);
  const importance = parseHookImportance(values.importance);
  const reminded = Array.isArray(values.remindedChapters)
    ? values.remindedChapters.map(toChapter).filter((chapter): chapter is number => chapter !== undefined)
    : [];
  return {
    ...(triggerCondition ? { triggerCondition } : {}),
    triggerKeywords: parseKeywords(values.triggerKeywords),
    ...(targetRange ? { targetRange } : {}),
    ...(payoffConstraint ? { payoffConstraint } : {}),
    ...(importance ? { importance } : {}),
    remindedChapters: [...new Set(reminded)].sort((a, b) => a - b),
  };
}

/** 当前章之前最近一次提醒的章号；本章及以后的记录不算（重跑本章或修旧章时轮转不变）。 */
export function lastRemindedBefore(remindedChapters: readonly number[], currentChapter: number): number | undefined {
  let last: number | undefined;
  for (const chapter of remindedChapters) {
    if (chapter < currentChapter && (last === undefined || chapter > last)) last = chapter;
  }
  return last;
}

/** 记一次提醒：并入本章、去重升序、只留最近 REMINDED_HISTORY_LIMIT 个。已记过返回原数组（调用方据此跳过写库）。 */
export function appendRemindedChapter(remindedChapters: readonly number[], chapter: number): readonly number[] {
  if (remindedChapters.includes(chapter)) return remindedChapters;
  return [...remindedChapters, chapter].sort((a, b) => a - b).slice(-REMINDED_HISTORY_LIMIT);
}

/** 伏笔分量：条目上填了 importance 就用它，否则按条目 0–100 注入重要度粗分（≥70 高、≤25 低）。 */
export function resolveHookImportance(ledger: ForeshadowLedgerFields, entryImportance?: number | null): HookImportance {
  if (ledger.importance) return ledger.importance;
  const value = typeof entryImportance === "number" ? entryImportance : 40;
  if (value >= 70) return "high";
  if (value <= 25) return "low";
  return "med";
}

export const HOOK_IMPORTANCE_MULTIPLIER: Readonly<Record<HookImportance, number>> = { low: 0.7, med: 1, high: 1.4 };
export const HOOK_IMPORTANCE_RANK: Readonly<Record<HookImportance, number>> = { low: 0, med: 1, high: 2 };

export function formatChapterRange(range: ChapterRange): string {
  return range.from === range.to ? `第 ${range.from} 章` : `第 ${range.from}–${range.to} 章`;
}

export type TargetRangeStatus = "none" | "future" | "approaching" | "in-range" | "overdue";

/** 本章相对预定回收区间的位置：approaching = 区间起点在 2 章内；overdue 时带超出章数。 */
export function targetRangeStatus(range: ChapterRange | undefined, currentChapter: number | undefined, approachWindow = 2): { status: TargetRangeStatus; overdueBy: number } {
  if (!range || currentChapter === undefined) return { status: "none", overdueBy: 0 };
  if (currentChapter > range.to) return { status: "overdue", overdueBy: currentChapter - range.to };
  if (currentChapter >= range.from) return { status: "in-range", overdueBy: 0 };
  if (range.from - currentChapter <= approachWindow) return { status: "approaching", overdueBy: 0 };
  return { status: "future", overdueBy: 0 };
}

export interface HookQuery {
  /** 本章拼起来的查询文本：章题、场景冲突/结果、节拍、召回指示等。 */
  readonly text: string;
  /** 本章点名的实体（出场人物、地点、场景声明用到的伏笔）。 */
  readonly entities: readonly string[];
}

/** 触发词命中：等于某个点名实体，或（≥2 字时）出现在本章查询文本里。 */
export function matchTriggerKeywords(keywords: readonly string[], query: HookQuery): string[] {
  const entities = new Set(query.entities.map((entity) => entity.trim()).filter(Boolean));
  return keywords.filter((keyword) => entities.has(keyword) || (keyword.length >= 2 && query.text.includes(keyword)));
}

export const HOOK_SCORE = {
  base: 45,
  keywordHit: 30,
  keywordCap: 60,
  textCap: 32,
  approaching: 15,
  inRange: 40,
  overduePerChapter: 3,
  overdueCap: 30,
  dormancyPerChapters: 10,
  dormancyCap: 10,
} as const;

export interface HookRelevanceInput {
  readonly ledger: ForeshadowLedgerFields;
  readonly currentChapter?: number;
  readonly query: HookQuery;
  /** 本章查询词在条目标题/正文/标签里的命中分（hooks 通道 textMatches 口径，8 分一个词）。 */
  readonly textScore: number;
  /** 距最近一次推进的章数（派生）；未知按 0。 */
  readonly idleChapters?: number;
  /** 条目 0–100 注入重要度。 */
  readonly entryImportance?: number | null;
}

export interface HookRelevanceScore {
  readonly score: number;
  /** 相关度部分（触发词 + 文本 + 到期）× 分量系数，供合并打分沿用。 */
  readonly relevance: number;
  readonly matchedKeywords: readonly string[];
  readonly rangeStatus: TargetRangeStatus;
  readonly overdueBy: number;
  readonly importance: HookImportance;
  readonly breakdown: Readonly<Record<string, number>>;
}

/**
 * 相关度加权的伏笔优先分（确定性）：
 *   score = base + (触发词 + 文本命中 + 到期) × 分量系数 + 休眠小项 + 条目重要度/10
 * - 触发词命中本章：每个 +30，封顶 60（强提升）
 * - 文本命中：沿用通道原口径，封顶 32
 * - 预定回收区间：将到 +15；区间内 +40；已过期 +40 + 每过 1 章 +3（封顶 +30）
 * - 分量系数：低 0.7 / 中 1 / 高 1.4
 * - 休眠：每 10 章 +1，封顶 +10——只够在同分时把久未推进的排前，不会把无关伏笔顶上来
 */
export function scoreHookRelevance(input: HookRelevanceInput): HookRelevanceScore {
  const matchedKeywords = matchTriggerKeywords(input.ledger.triggerKeywords, input.query);
  const keyword = Math.min(HOOK_SCORE.keywordCap, matchedKeywords.length * HOOK_SCORE.keywordHit);
  const text = Math.min(HOOK_SCORE.textCap, Math.max(0, input.textScore));
  const { status: rangeStatus, overdueBy } = targetRangeStatus(input.ledger.targetRange, input.currentChapter);
  const due = rangeStatus === "approaching"
    ? HOOK_SCORE.approaching
    : rangeStatus === "in-range"
      ? HOOK_SCORE.inRange
      : rangeStatus === "overdue"
        ? HOOK_SCORE.inRange + Math.min(HOOK_SCORE.overdueCap, overdueBy * HOOK_SCORE.overduePerChapter)
        : 0;
  const importance = resolveHookImportance(input.ledger, input.entryImportance);
  const multiplier = HOOK_IMPORTANCE_MULTIPLIER[importance];
  const relevance = (keyword + text + due) * multiplier;
  const dormancy = Math.min(HOOK_SCORE.dormancyCap, Math.floor(Math.max(0, input.idleChapters ?? 0) / HOOK_SCORE.dormancyPerChapters));
  const entryWeight = Math.min(100, Math.max(0, input.entryImportance ?? 40)) / 10;
  const score = HOOK_SCORE.base + relevance + dormancy + entryWeight;
  return {
    score,
    relevance,
    matchedKeywords,
    rangeStatus,
    overdueBy,
    importance,
    breakdown: { keyword, text, due, multiplier, dormancy, entryWeight },
  };
}

/** 卡片上给写手看的伏笔账面信息（只列填了的项）。 */
export function describeLedgerFields(ledger: ForeshadowLedgerFields): string[] {
  return [
    ledger.targetRange ? `预定回收：${formatChapterRange(ledger.targetRange)}` : "",
    ledger.triggerCondition ? `触发条件：${ledger.triggerCondition}` : "",
    ledger.triggerKeywords.length > 0 ? `触发词：${ledger.triggerKeywords.join("、")}` : "",
    ledger.payoffConstraint ? `回收要求：${ledger.payoffConstraint}` : "",
  ].filter(Boolean);
}
