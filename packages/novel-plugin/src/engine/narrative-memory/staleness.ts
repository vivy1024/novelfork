/**
 * 陈旧 fact 归档提示的唯一判定口径（P5 规模化 · 子项1）。
 *
 * 场景：写到第 100 章时，叙事记忆里堆着一批「很多章都没再变动」的动态状态
 * （角色处境、关系、冲突、位置等）。它们仍占注入配额、仍可能误导 agent，但
 * 早已与当前剧情脱节。这里给出「可能已过时」的提示，供作者复查。
 *
 * 三条硬纪律（对应 CLAUDE.md）：
 *   1. 这是「提示」不是「自动删除」。本模块只产出派生的判定结果，绝不作废、
 *      隐藏或改写任何 fact；是否处理由作者决定。
 *   2. 「易变类」的判定基于分类元数据表态（layer），不靠内容正则猜测。只有
 *      `layer=dynamic`（章后可变的当前状态）才可能陈旧；canon 是不随时间失效
 *      的真相，reference 是按需查阅，两者都不适用陈旧判定。
 *   3. 陈旧程度是派生量：由「最后变动章 + 当前章」现算，不新增存储列。
 *
 * 另外，作者手写来源（manual / import）的 fact 不判陈旧——那是作者的明确表态，
 * 不该被系统当成「过期」来催促；只有机器抽取（jingwei / runtime-state / event）
 * 的动态状态才纳入提示。
 */

import type { DiagnosticExplanation } from "../../handlers/diagnostic-explanation.js";
import { isDynamicProgressCategory } from "../jingwei/unified-categories.js";
import type { NarrativeFact, NarrativeFactLayer, NarrativeFactSourceType } from "./types.js";

/**
 * 动态状态超过这个章数未变动，即提示「可能已过时」。
 *
 * 取 30 章：网文一章约 3000 字，30 章≈9 万字。伏笔债务（foreshadowing-debt.ts）
 * 取 20 章超期，是因为悬而未收的钩子越拖越难圆、直接影响读者体验；而这里判定
 * 的是「动态状态是否可能过时」——它只是一个复查提示，误报成本远高于漏报（错误
 * 地催作者去改一条其实仍成立的状态，比漏提一条更烦人），所以阈值定得比伏笔更
 * 宽松。一条动态状态若连续 30 章没有被任何结算事件刷新，多半已与当前剧情脱节，
 * 值得作者扫一眼确认。
 *
 * 拿不到当前章号或最后变动章号时必须返回 `unknown`，绝不用默认章号算出负数或
 * 虚假的陈旧结论。
 */
export const STALE_FACT_THRESHOLD = 30;

/** 判定不适用陈旧提示的 fact 来源：作者手写/导入是明确表态，不催促。 */
const AUTHOR_SOURCE_TYPES: ReadonlySet<NarrativeFactSourceType> = new Set(["manual", "import"]);

export type FactStalenessLevel = "unknown" | "not-applicable" | "fresh" | "stale";

export interface FactStaleness {
  readonly level: FactStalenessLevel;
  /** 未变动章数；无法计算时为 null（绝不为负）。 */
  readonly staleChapters: number | null;
  /** 供 UI 直接展示的短标签。 */
  readonly label: string;
  /** 发生了什么 / 为什么要看 / 建议怎么做。前端与叙述者不得按 level 自造文案。 */
  readonly explanation: DiagnosticExplanation;
}

export interface FactStalenessInput {
  /** fact 的层级表态；只有 dynamic 才可能陈旧。 */
  readonly layer: NarrativeFactLayer;
  /** fact 来源；manual / import 不判陈旧。 */
  readonly sourceType: NarrativeFactSourceType;
  /** fact 分类，用于校验是否为章后动态推进类。 */
  readonly category: string;
  /**
   * 最后变动章号。对当前视图（ledger）里的 open fact，即 `validFromChapter`；
   * 缺失时回退 `sourceChapter`。缺失或 <=0 视为未记录。
   */
  readonly lastChangedChapter?: number | null;
  /** 本书当前（最大已完成）章号；拿不到时传 undefined，不要伪造默认值。 */
  readonly currentChapter?: number | null;
}

function normalizeChapter(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

/** 该来源的 fact 是否属于机器抽取（纳入陈旧判定）。 */
export function isMachineExtractedFactSource(sourceType: NarrativeFactSourceType): boolean {
  return !AUTHOR_SOURCE_TYPES.has(sourceType);
}

/**
 * 该 fact 是否适用陈旧判定：机器抽取来源 + dynamic 层 + 章后动态推进类。
 * canon / reference、作者手写、非动态分类一律不适用。
 */
export function isStalenessCandidate(input: Pick<FactStalenessInput, "layer" | "sourceType" | "category">): boolean {
  if (!isMachineExtractedFactSource(input.sourceType)) return false;
  if (input.layer !== "dynamic") return false;
  return isDynamicProgressCategory(input.category);
}

export function computeFactStaleness(input: FactStalenessInput): FactStaleness {
  if (!isStalenessCandidate(input)) {
    const reason = !isMachineExtractedFactSource(input.sourceType)
      ? "这是作者手写/导入的事实，属于明确表态，不做陈旧催促。"
      : input.layer !== "dynamic"
        ? "这是 canon/reference 层的设定，不随剧情推进而失效，因此不适用陈旧提示。"
        : "这个分类不属于章后动态推进类，其取值不随剧情天然变化，因此不做陈旧判定。";
    return {
      level: "not-applicable",
      staleChapters: null,
      label: "不适用",
      explanation: {
        whatHappened: `该事实不在陈旧提示的判定范围内：${reason}`,
        whyItMatters: "对不会随时间失效或由作者明确维护的事实做陈旧催促，只会制造噪音、干扰判断。",
        suggestedAction: "无需处理；如需管理这条事实，用 facts 相关的纠正/作废操作。",
      },
    };
  }

  const current = normalizeChapter(input.currentChapter);
  const lastChanged = normalizeChapter(input.lastChangedChapter);

  if (current === null) {
    return {
      level: "unknown",
      staleChapters: null,
      label: "陈旧未知",
      explanation: {
        whatHappened: "读不到本书当前章号，无法计算这条动态状态已经多少章没变动。",
        whyItMatters: "为避免给出错误的陈旧结论，这里不做判断。",
        suggestedAction: "先在资源树刷新章节列表（或写入正文）后再看陈旧提示。",
      },
    };
  }

  if (lastChanged === null || lastChanged <= 0) {
    return {
      level: "unknown",
      staleChapters: null,
      label: "未记录变动章",
      explanation: {
        whatHappened: "这条事实没有记录最后变动章号（validFromChapter/sourceChapter 均缺失），算不出未变动章数。",
        whyItMatters: "缺少变动章号时无法判断它是否已过时，因此不触发陈旧提示。",
        suggestedAction: "结算或纠正这条事实时补上生效章号，陈旧提示才会对它生效。",
      },
    };
  }

  const idle = Math.max(0, current - lastChanged);

  if (idle > STALE_FACT_THRESHOLD) {
    return {
      level: "stale",
      staleChapters: idle,
      label: `已 ${idle} 章未变动`,
      explanation: {
        whatHappened: `这条动态状态最后变动于第 ${lastChanged} 章，到第 ${current} 章已连续 ${idle} 章未被任何结算事件刷新，超过 ${STALE_FACT_THRESHOLD} 章阈值。`,
        whyItMatters: `长期不变动的动态状态很可能已与当前剧情脱节，却仍占用注入配额、还可能误导写手把过时设定当成现状。`,
        suggestedAction: "复查它是否仍成立：若已改变，用 facts 纠正为新值；若确实作废，用作废操作关闭它；若仍然成立，忽略此提示即可（本提示只做提醒，不会自动修改任何数据）。",
      },
    };
  }

  return {
    level: "fresh",
    staleChapters: idle,
    label: `${idle} 章未变动`,
    explanation: {
      whatHappened: `这条动态状态最后变动于第 ${lastChanged} 章，到第 ${current} 章已 ${idle} 章未变动，仍在 ${STALE_FACT_THRESHOLD} 章健康区间内。`,
      whyItMatters: "尚未达到可能过时的程度，暂时不需要处理。",
      suggestedAction: "无需处理。",
    },
  };
}

/** 从一条 NarrativeFact 计算陈旧状态。最后变动章取 validFromChapter，回退 sourceChapter。 */
export function computeFactStalenessFromFact(fact: NarrativeFact, currentChapter?: number | null): FactStaleness {
  return computeFactStaleness({
    layer: fact.layer,
    sourceType: fact.sourceType,
    category: fact.category,
    lastChangedChapter: fact.validFromChapter ?? fact.sourceChapter ?? null,
    currentChapter,
  });
}

export interface StaleFactReport {
  readonly fact: NarrativeFact;
  readonly staleness: FactStaleness;
}

/**
 * 从当前视图 ledger 里筛出「陈旧」的动态状态。
 *
 * 只返回 level=stale 的项（供归档提示端点使用）；其余 fact 一律不返回，避免
 * 把「暂时新鲜」或「不适用」的事实也塞给作者。派生自 ledger open facts，不落库。
 */
export function collectStaleFacts(
  facts: readonly NarrativeFact[],
  currentChapter?: number | null,
): StaleFactReport[] {
  const reports: StaleFactReport[] = [];
  for (const fact of facts) {
    const staleness = computeFactStalenessFromFact(fact, currentChapter);
    if (staleness.level === "stale") {
      reports.push({ fact, staleness });
    }
  }
  return reports.sort((a, b) => (b.staleness.staleChapters ?? 0) - (a.staleness.staleChapters ?? 0) || a.fact.id.localeCompare(b.fact.id));
}
