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

export function decideSettlementRisk(draft: NarrativeEventDraft): SettlementRiskDecision {
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

  if (draft.eventType === "world_fact_introduced" || hasHighRiskTerm(draft)) {
    return { decision: "pending", riskLevel: "high", reason: "高风险事件：可能改变 canon/rules、核心伏笔、时间线或不可逆角色/关系状态，需人工审查。" };
  }

  if (draft.eventType === "relationship_changed" || draft.eventType === "character_state_changed" || draft.eventType === "hook_resolved" || draft.confidence < 0.75) {
    return { decision: "pending", riskLevel: "medium", reason: "中风险事件：会影响后续写作，先进入 pending，不自动沉淀。" };
  }

  if (isLowRiskEventType(draft.eventType)) {
    return { decision: "auto_apply", riskLevel: "low", reason: "低风险事件：局部动态变化且有正文证据，可自动沉淀。" };
  }

  return { decision: "pending", riskLevel: "medium", reason: "默认按中风险处理，避免无审查自动落库。" };
}
