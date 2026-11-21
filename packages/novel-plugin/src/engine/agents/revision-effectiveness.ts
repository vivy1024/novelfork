/**
 * 改稿实效评估与事实守恒校验（零 Token 确定性检查）。
 *
 * 1. `evaluateRevisionEffectiveness`：对比改前/改后的确定性病灶总数（中文 AI 味 + 元叙事泄漏 + 有限视角自我不可见穿帮）
 *    以及文本真实变动幅度，识别「原地换词」（只换近义词或微调标点，病灶不减反增或改动微乎其微）。
 * 2. `checkFactConservation`：校验改写是否把原文中的关键数字序列、受保护专名（角色名/器物名等）以及关键对白片段洗掉。
 */

import { scanMetaLeaks, scanPovSelfSightLeaks } from "../compliance/prose-lenses.js";
import { detectZhAiFlavor, type ZhFlavorOptions } from "./zh-ai-flavor/index.js";

export interface RevisionIssueSummary {
  readonly source: "zh-ai-flavor" | "meta-leak" | "pov-self-sight";
  readonly id: string;
  readonly label: string;
  readonly count: number;
  readonly samples: readonly string[];
}

export interface RevisionEffectivenessOptions {
  readonly flavorOptions?: ZhFlavorOptions;
  readonly povCharacter?: string;
  /** 判定文本变动微乎其微的阈值，默认 0.03（3%）。 */
  readonly minChangeRatio?: number;
}

export interface RevisionEffectivenessReport {
  readonly beforeIssueCount: number;
  readonly afterIssueCount: number;
  readonly resolvedCount: number;
  readonly remainingIssues: readonly RevisionIssueSummary[];
  /** 0~1，文本字符级差异比例。 */
  readonly changeRatio: number;
  readonly stagnantRevision: boolean;
  readonly recommendedStrategy: "rewrite-paragraph" | "keep";
  readonly advisoryNote?: string;
}

export interface FactConservationReport {
  readonly ok: boolean;
  readonly lostNumbers: readonly string[];
  readonly lostNames: readonly string[];
  readonly lostDialogueCount: number;
  readonly warnings: readonly string[];
}

export const STAGNANT_REVISION_PROMPT_WARNING =
  "原地换词告警：目标病灶未消除，请勿同义词微调，直接保留事件结果整段换骨架重写";

function collectDeterministicIssues(
  text: string,
  options?: RevisionEffectivenessOptions,
): { total: number; issues: RevisionIssueSummary[] } {
  const issues: RevisionIssueSummary[] = [];

  const flavor = detectZhAiFlavor(text, options?.flavorOptions);
  for (const hit of [...flavor.blocking, ...flavor.advisory, ...flavor.overcompressed]) {
    issues.push({
      source: "zh-ai-flavor",
      id: hit.ruleId,
      label: hit.label,
      count: hit.count,
      samples: hit.samples,
    });
  }

  const metaLeaks = scanMetaLeaks(text);
  if (metaLeaks.length > 0) {
    const grouped = new Map<string, string[]>();
    for (const hit of metaLeaks) {
      const list = grouped.get(hit.term) ?? [];
      if (list.length < 5) list.push(hit.quote);
      grouped.set(hit.term, list);
    }
    for (const [term, samples] of grouped) {
      const count = metaLeaks.filter((h) => h.term === term).length;
      issues.push({
        source: "meta-leak",
        id: `meta-leak:${term}`,
        label: `元叙事穿帮「${term}」`,
        count,
        samples,
      });
    }
  }

  const povLeaks = scanPovSelfSightLeaks(text, options?.povCharacter);
  if (povLeaks.length > 0) {
    issues.push({
      source: "pov-self-sight",
      id: "pov-self-sight",
      label: "有限视角自我不可见描写",
      count: povLeaks.length,
      samples: povLeaks.slice(0, 5).map((h) => h.quote),
    });
  }

  const total = issues.reduce((sum, item) => sum + item.count, 0);
  return { total, issues };
}

/**
 * 计算两段文本的字符差异比例（0~1）。
 * 短文本直接用精确 Levenshtein 编辑距离；长文本按常见首尾剥离 + 2-gram 多重集对称差计算，兼顾精度与性能。
 */
function computeChangeRatio(before: string, after: string): number {
  const a = before.replace(/\r\n/g, "\n").trim();
  const b = after.replace(/\r\n/g, "\n").trim();
  if (a === b) return 0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 0;

  const charsA = [...a];
  const charsB = [...b];

  // 剥去相同前后缀以缩小计算规模
  let prefix = 0;
  const minLen = Math.min(charsA.length, charsB.length);
  while (prefix < minLen && charsA[prefix] === charsB[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < minLen - prefix &&
    charsA[charsA.length - 1 - suffix] === charsB[charsB.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const midA = charsA.slice(prefix, charsA.length - suffix);
  const midB = charsB.slice(prefix, charsB.length - suffix);
  const totalLen = Math.max(charsA.length, charsB.length);

  if (midA.length === 0 || midB.length === 0) {
    return Math.min(1, Math.max(midA.length, midB.length) / totalLen);
  }

  // 差异核心区间较小时使用精确编辑距离
  if (midA.length * midB.length <= 160_000) {
    const dp = new Int32Array(midB.length + 1);
    for (let j = 0; j <= midB.length; j += 1) dp[j] = j;
    for (let i = 1; i <= midA.length; i += 1) {
      let prevDiag = dp[0]!;
      dp[0] = i;
      const chA = midA[i - 1]!;
      for (let j = 1; j <= midB.length; j += 1) {
        const temp = dp[j]!;
        const cost = chA === midB[j - 1] ? 0 : 1;
        dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prevDiag + cost);
        prevDiag = temp;
      }
    }
    return Math.min(1, dp[midB.length]! / totalLen);
  }

  // 超长差异区间回退为 2-gram 多重集距离，线性时间稳定估算
  const gramsA = buildBigramCounts(midA);
  const gramsB = buildBigramCounts(midB);
  let diff = 0;
  const keys = new Set([...gramsA.keys(), ...gramsB.keys()]);
  for (const key of keys) {
    diff += Math.abs((gramsA.get(key) ?? 0) - (gramsB.get(key) ?? 0));
  }
  const approxEdits = Math.max(Math.abs(midA.length - midB.length), Math.ceil(diff / 2));
  return Math.min(1, approxEdits / totalLen);
}

function buildBigramCounts(chars: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  if (chars.length === 1) {
    counts.set(chars[0]!, 1);
    return counts;
  }
  for (let i = 0; i < chars.length - 1; i += 1) {
    const gram = `${chars[i]!}${chars[i + 1]!}`;
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  return counts;
}

/**
 * 评估一次改稿是否真正消除了病灶，还是停留在「原地换词」。
 */
export function evaluateRevisionEffectiveness(
  before: string,
  after: string,
  options?: RevisionEffectivenessOptions,
): RevisionEffectivenessReport {
  const minChangeRatio = options?.minChangeRatio ?? 0.03;
  const beforeScan = collectDeterministicIssues(before, options);
  const afterScan = collectDeterministicIssues(after, options);

  const beforeIssueCount = beforeScan.total;
  const afterIssueCount = afterScan.total;
  const resolvedCount = Math.max(0, beforeIssueCount - afterIssueCount);
  const changeRatio = Number(computeChangeRatio(before, after).toFixed(4));

  const unresolvedStagnation = beforeIssueCount > 0 && afterIssueCount >= beforeIssueCount;
  const minimalEditStagnation = changeRatio < minChangeRatio;
  const stagnantRevision = unresolvedStagnation || minimalEditStagnation;

  const recommendedStrategy = stagnantRevision ? "rewrite-paragraph" : "keep";
  const advisoryNote = stagnantRevision
    ? `${STAGNANT_REVISION_PROMPT_WARNING}（改前病灶 ${beforeIssueCount} 处 → 改后 ${afterIssueCount} 处，文本变动 ${(changeRatio * 100).toFixed(1)}%）。`
    : undefined;

  return {
    beforeIssueCount,
    afterIssueCount,
    resolvedCount,
    remainingIssues: afterScan.issues,
    changeRatio,
    stagnantRevision,
    recommendedStrategy,
    ...(advisoryNote ? { advisoryNote } : {}),
  };
}

/** 抽取关键数字序列：阿拉伯数字（含小数/百分号/带分隔符）及带单位或两位以上的中文数字。 */
const ARABIC_NUMBER_RE = /\d+(?:[.,]\d+)?%?/gu;
const ZH_QUANTITY_NUMBER_RE =
  /[一二三四五六七八九十百千万亿两零]{1,8}(?:[万亿千百十]|[两斤钱贯文银金石枚块颗张页条座层重级阶岁年个月日天夜时辰刻分秒里丈尺寸米公里元块万千百])/gu;

function extractKeyNumbers(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const regex of [ARABIC_NUMBER_RE, ZH_QUANTITY_NUMBER_RE]) {
    for (const match of text.matchAll(regex)) {
      const token = match[0]!;
      if (!token || seen.has(token)) continue;
      seen.add(token);
      out.push(token);
    }
  }
  return out;
}

const DIALOGUE_SEGMENT_RE = /“([^”\n]+)”|「([^」\n]+)」|『([^』\n]+)』|"([^"\n]+)"/gu;

function extractKeyDialogues(text: string): string[] {
  const segments: string[] = [];
  for (const match of text.matchAll(DIALOGUE_SEGMENT_RE)) {
    const inner = (match[1] ?? match[2] ?? match[3] ?? match[4] ?? "").trim();
    const contentChars = inner.replace(/[\s，。、；：！？,.!?;:~—…]/gu, "");
    if (contentChars.length >= 6) {
      segments.push(inner);
    }
  }
  return segments;
}

function normalizeDialogueForMatch(text: string): string {
  return text.replace(/[\s，。、；：！？,.!?;:~—…]/gu, "");
}

/** 判断某句关键对白在改写后是否仍有核心保留（完整命中或高字符重合）。 */
function dialoguePreserved(segment: string, afterNormalizedDialogues: readonly string[], afterFullNormalized: string): boolean {
  const norm = normalizeDialogueForMatch(segment);
  if (!norm) return true;
  if (afterFullNormalized.includes(norm)) return true;

  const chars = [...norm];
  const minOverlap = Math.ceil(chars.length * 0.55);
  for (const candidate of afterNormalizedDialogues) {
    let overlap = 0;
    const pool = new Map<string, number>();
    for (const ch of candidate) {
      pool.set(ch, (pool.get(ch) ?? 0) + 1);
    }
    for (const ch of chars) {
      const remain = pool.get(ch) ?? 0;
      if (remain > 0) {
        overlap += 1;
        pool.set(ch, remain - 1);
      }
    }
    if (overlap >= minOverlap) return true;
  }
  return false;
}

/**
 * 校验改写前后是否意外洗掉关键事实锚点（数字、受保护专名、关键对白）。
 */
export function checkFactConservation(
  before: string,
  after: string,
  protectedNames: readonly string[] = [],
): FactConservationReport {
  const beforeNumbers = extractKeyNumbers(before);
  const lostNumbers = beforeNumbers.filter((num) => !after.includes(num));

  const uniqueNames = [...new Set(protectedNames.map((n) => n.trim()).filter(Boolean))];
  const lostNames = uniqueNames.filter((name) => before.includes(name) && !after.includes(name));

  const beforeDialogues = extractKeyDialogues(before);
  const afterDialogues = extractKeyDialogues(after);
  const afterNormalizedDialogues = afterDialogues.map(normalizeDialogueForMatch);
  const afterFullNormalized = normalizeDialogueForMatch(after);

  let lostDialogueCount = 0;
  for (const seg of beforeDialogues) {
    if (!dialoguePreserved(seg, afterNormalizedDialogues, afterFullNormalized)) {
      lostDialogueCount += 1;
    }
  }

  const warnings: string[] = [];
  if (lostNumbers.length > 0) {
    warnings.push(`改写丢失关键数字：${lostNumbers.join("、")}。请核对账目、时限与数量锚点是否被误删。`);
  }
  if (lostNames.length > 0) {
    warnings.push(`改写丢失受保护专名：${lostNames.join("、")}。请确认出场人物或关键器物名未被洗掉。`);
  }
  if (lostDialogueCount > 0) {
    warnings.push(`改写丢失 ${lostDialogueCount} 处关键对白片段（长度 ≥ 6 字），请确认核心台词与压迫来源仍保留。`);
  }

  return {
    ok: warnings.length === 0,
    lostNumbers,
    lostNames,
    lostDialogueCount,
    warnings,
  };
}
