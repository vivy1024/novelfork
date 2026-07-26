/**
 * 中文 AI 味检测器。
 *
 * 输出「命中清单 + 三档分级」，不直接决定是否阻断保存。
 * 分档规则（对齐业界做法）：任一重度即重度；无重度时中度项 ≥3 判中度。
 */

import { countNarrativeChars, maskQuoted, tailWindow } from "./masking.js";
import { ADVISORY_RULES, BLOCKING_RULES, type ZhFlavorRule } from "./rules.js";

export type ZhFlavorGrade = "clean" | "light" | "moderate" | "severe";

export interface ZhFlavorHit {
  readonly ruleId: string;
  readonly label: string;
  readonly severity: "blocking" | "advisory";
  readonly count: number;
  /** advisory 规则的次/千字；blocking 不适用 */
  readonly perThousand?: number;
  /** 最多保留 5 个样例，供作者定位 */
  readonly samples: readonly string[];
  readonly suggestion: string;
}

export interface ZhFlavorReport {
  readonly grade: ZhFlavorGrade;
  readonly narrativeChars: number;
  readonly blocking: readonly ZhFlavorHit[];
  readonly advisory: readonly ZhFlavorHit[];
  /** 反向指纹：删得过头产生的电报体信号 */
  readonly overcompressed: readonly ZhFlavorHit[];
  /** 建议的删除比例上限，超过应转人工 */
  readonly maxDeleteRatio: number;
  readonly summary: string;
}

export interface ZhFlavorOptions {
  /**
   * 白名单：世界观术语、角色绰号、章名。
   * 命中片段若是白名单词的子串则不计数（例如主角绰号叫「缓缓」）。
   */
  readonly whitelist?: readonly string[];
  /** 文末窗口大小，默认 600 字 */
  readonly tailSize?: number;
}

/** 分档 → 允许的最大删除比例。超过则应标记需人工复核。 */
const MAX_DELETE_RATIO: Record<ZhFlavorGrade, number> = {
  clean: 0,
  light: 0.15,
  moderate: 0.25,
  severe: 0.35,
};

function isWhitelisted(sample: string, whitelist: readonly string[]): boolean {
  return whitelist.some((term) => term.length > 0 && term.includes(sample));
}

function collectHits(
  rule: ZhFlavorRule,
  haystack: string,
  whitelist: readonly string[],
): { count: number; samples: string[] } {
  const pattern = new RegExp(rule.pattern.source, rule.pattern.flags.includes("g")
    ? rule.pattern.flags
    : `${rule.pattern.flags}g`);
  const samples: string[] = [];
  let count = 0;
  for (const match of haystack.matchAll(pattern)) {
    const sample = match[0];
    if (!sample) continue;
    if (isWhitelisted(sample, whitelist)) continue;
    count += 1;
    if (samples.length < 5) samples.push(sample);
  }
  return { count, samples };
}

/** 弱化副词等 advisory 规则的严重度：按超阈倍数判定。 */
function advisoryGrade(perThousand: number, threshold: number): "light" | "moderate" | "severe" {
  if (perThousand >= threshold * 3) return "severe";
  if (perThousand >= threshold * 1.5) return "moderate";
  return "light";
}

export function detectZhAiFlavor(content: string, options: ZhFlavorOptions = {}): ZhFlavorReport {
  const whitelist = options.whitelist ?? [];
  const masked = maskQuoted(content);
  const narrativeChars = countNarrativeChars(masked);
  const tail = maskQuoted(tailWindow(content, options.tailSize ?? 600));
  const perK = narrativeChars > 0 ? narrativeChars / 1000 : 0;

  const blocking: ZhFlavorHit[] = [];
  for (const rule of BLOCKING_RULES) {
    const haystack = rule.tailOnly ? tail : masked;
    const { count, samples } = collectHits(rule, haystack, whitelist);
    if (count > 0) {
      blocking.push({
        ruleId: rule.id,
        label: rule.label,
        severity: "blocking",
        count,
        samples,
        suggestion: rule.suggestion,
      });
    }
  }

  const advisory: ZhFlavorHit[] = [];
  const overcompressed: ZhFlavorHit[] = [];
  const moderateOrWorse: ZhFlavorGrade[] = [];

  for (const rule of ADVISORY_RULES) {
    const { count, samples } = collectHits(rule, masked, whitelist);
    if (count === 0) continue;
    const threshold = rule.minHits ?? 3;
    const perThousand = perK > 0 ? count / perK : count;
    // 密度未达阈值时不报，避免把正常中文当问题
    if (perThousand < threshold) continue;
    const hit: ZhFlavorHit = {
      ruleId: rule.id,
      label: rule.label,
      severity: "advisory",
      count,
      perThousand: Number(perThousand.toFixed(1)),
      samples,
      suggestion: rule.suggestion,
    };
    // micro-action-tic 属于反向指纹，单独归类以免和 AI 味混谈
    if (rule.id === "micro-action-tic") overcompressed.push(hit);
    else advisory.push(hit);
    moderateOrWorse.push(advisoryGrade(perThousand, threshold));
  }

  const grade = resolveGrade(blocking.length, moderateOrWorse);
  return {
    grade,
    narrativeChars,
    blocking,
    advisory,
    overcompressed,
    maxDeleteRatio: MAX_DELETE_RATIO[grade],
    summary: buildSummary(grade, blocking, advisory, overcompressed),
  };
}

function resolveGrade(
  blockingCount: number,
  advisoryGrades: readonly ZhFlavorGrade[],
): ZhFlavorGrade {
  if (advisoryGrades.includes("severe")) return "severe";
  const moderateCount = advisoryGrades.filter((item) => item === "moderate").length;
  // 毒句式命中即至少中度：它们是确定性问题，不该被归为轻度
  if (blockingCount > 0) return moderateCount >= 2 ? "severe" : "moderate";
  if (moderateCount >= 3) return "moderate";
  if (advisoryGrades.length > 0) return "light";
  return "clean";
}

function buildSummary(
  grade: ZhFlavorGrade,
  blocking: readonly ZhFlavorHit[],
  advisory: readonly ZhFlavorHit[],
  overcompressed: readonly ZhFlavorHit[],
): string {
  if (grade === "clean") return "未检出明显 AI 味特征。";
  const parts: string[] = [];
  if (blocking.length > 0) {
    parts.push(`毒句式 ${blocking.length} 类（${blocking.map((item) => item.label).join("、")}）`);
  }
  if (advisory.length > 0) {
    parts.push(`密度超标 ${advisory.length} 项`);
  }
  if (overcompressed.length > 0) {
    parts.push("存在过度压缩（电报体）信号");
  }
  const gradeLabel = { light: "轻度", moderate: "中度", severe: "重度", clean: "干净" }[grade];
  return `${gradeLabel}：${parts.join("；")}。`;
}
