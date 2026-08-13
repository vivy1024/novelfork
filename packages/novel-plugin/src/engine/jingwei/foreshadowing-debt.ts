/**
 * 伏笔债务（悬置多久 / 是否超期）的唯一判定口径。
 *
 * 伏笔的权威源是经纬 `foreshadowing` 条目；「悬置了多少章」「是否超期」都是
 * 由「埋设章号 + 当前章号」派生出来的状态，不存库、不在各处各写一遍字面量。
 * 历史上前端伏笔看板写 30 章、叙事记忆伏笔板写 20 章、驾驶舱 open-hooks 写
 * 15 章，三套阈值互相打架；这里收敛成一处。
 *
 * 阈值取 20 章：网文一章约 3000 字，20 章≈6 万字，读者对未推进的钩子基本已
 * 经淡忘，此时告警仍有补救余地；30 章（≈9 万字）往往已经晚了，15 章又过于
 * 频繁。DUE_SOON 取 14 章（阈值的 70%），保留「临近到期」的提前提醒。
 *
 * 拿不到当前章号时必须返回 `unknown`，而不是用默认章号算出负数悬念 —— 那会
 * 让超期预警静默失效。
 */

/** 悬置超过这个章数即判定为超期未回收。 */
export const FORESHADOWING_DEBT_THRESHOLD = 20;

/** 悬置达到这个章数即进入「临近到期」提醒区间。 */
export const FORESHADOWING_DUE_SOON_THRESHOLD = 14;

export type ForeshadowingDebtLevel = "unknown" | "fresh" | "due-soon" | "overdue" | "settled";

export interface ForeshadowingDebt {
  readonly level: ForeshadowingDebtLevel;
  /** 悬置章数；无法计算时为 null（绝不为负）。 */
  readonly suspenseChapters: number | null;
  /** 供 UI 直接展示的短标签。 */
  readonly label: string;
  /** 发生了什么 / 为什么要看 / 建议怎么做。前端与叙述者不得按 level 自造文案。 */
  readonly explanation: string;
}

export interface ForeshadowingDebtInput {
  /** 经纬伏笔条目的埋设章号；缺失或 <=0 视为未记录。 */
  readonly plantedChapter?: number | null;
  /** 本书当前（最大已完成）章号；拿不到时传 undefined，不要伪造默认值。 */
  readonly currentChapter?: number | null;
  /** 已回收 / 已废弃的伏笔不再计债。 */
  readonly settled?: boolean;
}

function normalizeChapter(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

export function computeForeshadowingDebt(input: ForeshadowingDebtInput): ForeshadowingDebt {
  const planted = normalizeChapter(input.plantedChapter);
  const current = normalizeChapter(input.currentChapter);
  const gap = planted !== null && planted > 0 && current !== null ? Math.max(0, current - planted) : null;

  if (input.settled) {
    return {
      level: "settled",
      suspenseChapters: gap,
      label: "已结清",
      explanation: "这条伏笔已回收或已废弃，不再计入超期债务；如果剧情又把它拉回来，把状态拖回「已埋设」即可重新计债。",
    };
  }

  if (current === null) {
    return {
      level: "unknown",
      suspenseChapters: null,
      label: "悬念未知",
      explanation:
        "读不到本书当前章号，因此无法计算这条伏笔悬置了多少章。为避免给出错误的超期结论，这里不做判断；先在资源树里刷新章节列表（或写入第一章）后再看超期预警。",
    };
  }

  if (planted === null || planted <= 0) {
    return {
      level: "unknown",
      suspenseChapters: null,
      label: "未记录埋设章",
      explanation:
        "这条经纬伏笔条目没有记录埋设章号，因此算不出悬置章数，也不会触发超期预警。建议编辑该条目补上 plantedChapter，超期告警才会对它生效。",
    };
  }

  const suspense = gap ?? 0;

  if (suspense > FORESHADOWING_DEBT_THRESHOLD) {
    return {
      level: "overdue",
      suspenseChapters: suspense,
      label: `超期 ${suspense} 章`,
      explanation:
        `这条伏笔埋于第 ${planted} 章，到第 ${current} 章已悬置 ${suspense} 章，超过 ${FORESHADOWING_DEBT_THRESHOLD} 章阈值。读者对它的记忆基本已经消散，继续拖会变成弃坑点。建议在接下来几章内推进或明确回收，实在不要了就把状态改为「已废弃」以结清债务。`,
    };
  }

  if (suspense >= FORESHADOWING_DUE_SOON_THRESHOLD) {
    return {
      level: "due-soon",
      suspenseChapters: suspense,
      label: `临近到期 ${suspense} 章`,
      explanation:
        `这条伏笔埋于第 ${planted} 章，已悬置 ${suspense} 章，距离 ${FORESHADOWING_DEBT_THRESHOLD} 章超期线不远。建议在规划下一卷/下几章时安排一次推进或部分揭示，别等到超期再补。`,
    };
  }

  return {
    level: "fresh",
    suspenseChapters: suspense,
    label: `悬念 ${suspense} 章`,
    explanation:
      `这条伏笔埋于第 ${planted} 章，已悬置 ${suspense} 章，仍在 ${FORESHADOWING_DEBT_THRESHOLD} 章健康区间内，暂时不需要处理。`,
  };
}

/** 驾驶舱 open-hooks 的三态统计口径，复用同一阈值。 */
export type CockpitHookRisk = "open" | "payoff-due" | "expired-risk";

export function toCockpitHookRisk(debt: ForeshadowingDebt): CockpitHookRisk {
  if (debt.level === "overdue") return "expired-risk";
  if (debt.level === "due-soon") return "payoff-due";
  return "open";
}
