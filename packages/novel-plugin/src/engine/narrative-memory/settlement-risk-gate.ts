import type { NarrativeEvent, NarrativeEventRiskLevel, NarrativeEventType } from "./types.js";

export type ChapterSettlementInput = Readonly<{
  bookId: string;
  chapterId?: string;
  chapterNumber: number;
  title?: string;
  content: string;
  confirmedAt?: string;
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
