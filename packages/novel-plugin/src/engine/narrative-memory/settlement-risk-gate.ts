import type { DiagnosticExplanation } from "../../handlers/diagnostic-explanation.js";
import type { NarrativeEvent, NarrativeEventRiskLevel, NarrativeEventType } from "./types.js";

export type ChapterSettlementInput = Readonly<{
  bookId: string;
  chapterId?: string;
  chapterNumber: number;
  title?: string;
  content: string;
  confirmedAt?: string;
  /**
   * 正文未变时强制重新结算（P5 幂等的逃生口）。
   * 上一次抽取漏抽/抽错时用它重跑；默认 false，即同章同内容会被幂等跳过。
   */
  force?: boolean;
}>;

export type NarrativeEventDraft = Readonly<{
  eventType: NarrativeEventType;
  subject: string;
  predicate: string;
  object: string;
  evidenceText: string;
  confidence: number;
  riskLevel?: NarrativeEventRiskLevel;
  source: "settle";
}>;

export type SettlementRiskDecision = Readonly<{
  decision: "auto_apply" | "pending" | "reject";
  riskLevel: NarrativeEventRiskLevel;
  reason: string;
}>;

/**
 * 结算被跳过的原因。
 *
 * `already-settled` 是 P5 幂等的正常结果，不是错误：同一章 + 正文未变的重复结算
 * （agent 重试、管线发起后又手动补一次、settle_range 扫到已结算章）都收敛到它。
 * 其余两个是既有的配置/空正文跳过原因。
 */
export type ChapterSettlementSkipReason = "already-settled" | "settlement-disabled" | "empty-content";

/**
 * 本次结算与幂等台账的关系，供面板与 agent 判断「这次到底做了什么」。
 * - first: 该章首次结算
 * - resettled: 正文已改写（或被 force 要求），重新抽取
 * - skipped-duplicate: 同章同内容，本次未写入任何东西
 */
export type ChapterSettlementIdempotencyOutcome = "first" | "resettled" | "skipped-duplicate";

export type ChapterSettlementIdempotency = Readonly<{
  outcome: ChapterSettlementIdempotencyOutcome;
  /** 本次正文的内容指纹；幂等键是 (bookId, chapterNumber, contentFingerprint)。 */
  contentFingerprint: string;
  /** 该章累计结算次数（含本次）。 */
  settlementCount: number;
  /** 上一次结算时间（首次结算时无）。 */
  previouslySettledAt?: string;
  /** outcome=resettled 时，上一次结算所依据的正文指纹。 */
  previousContentFingerprint?: string;
  /** outcome=resettled 且由 force 触发（正文本身没变）时为 true。 */
  forced?: boolean;
  /** outcome=resettled 时，被保护而未再次归约的、作者已裁决事件数。 */
  authorDecidedPreserved?: number;
}>;

export type ChapterSettlementResult = Readonly<{
  status: "skipped" | "completed" | "failed";
  bookId: string;
  chapterId?: string;
  chapterNumber: number;
  extracted: number;
  autoApplied: number;
  pending: number;
  highRiskPending: number;
  warnings: readonly string[];
  events: readonly NarrativeEvent[];
  /** status=skipped 时的机器可读原因；只用于去重与分流，展示一律读 explanation。 */
  skipReason?: ChapterSettlementSkipReason;
  /** 跳过/重结算的人话解释（发生了什么 / 为什么要看 / 建议怎么做）。 */
  explanation?: DiagnosticExplanation;
  /** 本次结算与幂等台账的关系；skipped-duplicate 时说明「已结算过，本次跳过」。 */
  idempotency?: ChapterSettlementIdempotency;
}>;

const REQUIRED_FIELDS: readonly (keyof Pick<NarrativeEventDraft, "subject" | "predicate" | "object" | "evidenceText">)[] = ["subject", "predicate", "object", "evidenceText"];

const HIGH_RISK_TERMS = [
  "死亡",
  "身亡",
  "牺牲",
  "背叛",
  "反叛",
  "决裂",
  "重大关系翻转",
  "世界规则",
  "规则改变",
  "规则变更",
  "核心伏笔回收",
  "核心伏笔兑现",
  "时间线冲突",
  "canon",
  "rules",
] as const;

function textOf(draft: NarrativeEventDraft): string {
  return [draft.subject, draft.predicate, draft.object, draft.evidenceText].join("\n");
}

function hasHighRiskTerm(draft: NarrativeEventDraft): boolean {
  const text = textOf(draft).toLowerCase();
  return HIGH_RISK_TERMS.some((term) => text.includes(term.toLowerCase()));
}

function isLowRiskEventType(eventType: NarrativeEventType): boolean {
  return eventType === "location_changed"
    || eventType === "hook_planted"
    || eventType === "hook_progressed"
    || eventType === "timeline_advanced";
}

export type SettlementRiskOptions = Readonly<{
  minConfidence?: number;
  autoApplyLowRisk?: boolean;
  autoApplyMediumRisk?: boolean;
  highRiskAlwaysPending?: boolean;
}>;

export function decideSettlementRisk(
  draft: NarrativeEventDraft,
  options: SettlementRiskOptions = {},
): SettlementRiskDecision {
  const minConfidence = options.minConfidence ?? 0.75;
  const autoApplyLowRisk = options.autoApplyLowRisk ?? true;
  const autoApplyMediumRisk = options.autoApplyMediumRisk ?? true;
  const highRiskAlwaysPending = options.highRiskAlwaysPending ?? true;

  for (const field of REQUIRED_FIELDS) {
    if (!draft[field]?.trim()) {
      return { decision: "reject", riskLevel: "high", reason: `缺少必填字段 ${field}，不得进入结算落库。` };
    }
  }

  if (draft.source !== "settle") {
    return { decision: "reject", riskLevel: "high", reason: "Chapter Settlement 只接受 source=settle 的事件草案。" };
  }

  if (draft.confidence < 0 || draft.confidence > 1 || !Number.isFinite(draft.confidence)) {
    return { decision: "reject", riskLevel: "high", reason: "confidence 必须是 0 到 1 之间的数字。" };
  }

  if (highRiskAlwaysPending && (draft.eventType === "world_fact_introduced" || hasHighRiskTerm(draft))) {
    return { decision: "pending", riskLevel: "high", reason: "高风险事件：可能改变 canon/rules、核心伏笔、时间线或不可逆角色/关系状态；默认进入历史待审队列，不阻断 agent 后续写作。" };
  }

  if (draft.confidence < minConfidence) {
    return {
      decision: "pending",
      riskLevel: "medium",
      reason: `置信度不足 ${minConfidence}，暂不自动沉淀，进入历史待审。`,
    };
  }

  const low = isLowRiskEventType(draft.eventType);
  const riskLevel: NarrativeEventRiskLevel = low ? "low" : "medium";

  if (low && !autoApplyLowRisk) {
    return { decision: "pending", riskLevel: "low", reason: "配置关闭了低风险自动应用，事件进入待审。" };
  }
  if (!low && !autoApplyMediumRisk) {
    return { decision: "pending", riskLevel: "medium", reason: "配置关闭了中风险自动应用，事件进入待审。" };
  }

  return {
    decision: "auto_apply",
    riskLevel,
    reason: "章后结算自动应用：有正文证据且置信度足够；作者可在叙事记忆历史中回看。",
  };
}
