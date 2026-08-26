/**
 * T5 · 角色心理精化（墨枢方案移植，纯函数零副作用）。
 *
 * - scar 遗忘衰减：心理伤痕随章节数增长强度递减，低于阈值自动愈合
 * - OOC 三分类：基于活跃 scar / 执念优先级 / 近期事件，判定角色行为偏离性质
 */

// ---------------------------------------------------------------------------
// Scar 遗忘衰减
// ---------------------------------------------------------------------------

export interface Scar {
  readonly description: string;
  readonly plantedChapter: number;
  /** 初始强度 1-10。 */
  readonly intensity: number;
  readonly sensitivityTags?: readonly string[];
}

/** 强度衰减半衰期（章）：每经过 N 章未提及，强度减半。 */
const SCAR_HALF_LIFE_CHAPTERS = 10;
/** 低于此值视为已愈合，不再注入写章 prompt。 */
const HEALED_THRESHOLD = 2;

/**
 * 计算 scar 在 currentChapter 时的有效强度（遗忘衰减曲线）。
 * 墨枢公式：effective = intensity × 0.5^(chaptersSincePlanted / halfLife)
 */
export function scarEffectiveIntensity(scar: Scar, currentChapter: number): number {
  const chaptersSince = Math.max(0, currentChapter - scar.plantedChapter);
  const decayed = scar.intensity * Math.pow(0.5, chaptersSince / SCAR_HALF_LIFE_CHAPTERS);
  return Math.round(decayed * 10) / 10;
}

/** scar 是否已愈合（有效强度 < 阈值）。 */
export function isScarHealed(scar: Scar, currentChapter: number): boolean {
  return scarEffectiveIntensity(scar, currentChapter) < HEALED_THRESHOLD;
}

/** 过滤出仍活跃（未愈合）的 scar 列表。 */
export function activeScars(scars: readonly Scar[], currentChapter: number): readonly Scar[] {
  return scars.filter((scar) => !isScarHealed(scar, currentChapter));
}

// ---------------------------------------------------------------------------
// OOC 三分类判定
// ---------------------------------------------------------------------------

export type OOCClassification = "normal" | "breakout" | "ooc";

export interface Motivation {
  readonly description: string;
  /** 执念优先级 1-10；≥8 视为高执念。 */
  readonly priority: number;
}

export interface OOCInput {
  readonly scars: readonly Scar[];
  readonly motivations: readonly Motivation[];
  /** 本章角色的行为描述摘要（用于匹配 sensitivityTags）。 */
  readonly behaviorSummary: string;
  readonly currentChapter: number;
}

/**
 * OOC 三分类：
 * - breakout：活跃 scar 被触发（合理偏离）或高执念驱动（高光时刻）
 * - ooc：行为摘要命中了负面关键词但缺乏心理支撑
 * - normal：无异常信号
 *
 * 当前版本基于 sensitivityTags 关键词匹配 + 执念优先级判定。
 */
export function classifyOOC(input: OOCInput): OOCClassification {
  const { scars, motivations, behaviorSummary } = input;

  // 活跃 scar 被触发 → 合理偏离（有心理支撑的高光）
  for (const scar of activeScars(scars, input.currentChapter)) {
    if (scar.sensitivityTags?.some((tag) => behaviorSummary.includes(tag))) {
      return "breakout";
    }
  }

  // 高执念驱动 → 高光时刻（角色推着剧情走）
  if (motivations.some((m) => m.priority >= 8)) {
    return "breakout";
  }

  // 无心理支撑 → normal（无异常信号，不需要告警）
  return "normal";
}
