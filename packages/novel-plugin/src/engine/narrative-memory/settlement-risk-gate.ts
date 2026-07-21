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
    return { decision: "pending", riskLevel: "high", reason: "高风险事件：可能改变 canon/rules、核心伏笔、时间线或不可逆角色/关系状态；默认进入历史待审队列，不阻断 agent 后续写作。" };
  }

  // 产品口径：章后结算默认自动；中低风险且证据充分时直接沉淀，作者以历史面板查看。
  if (draft.confidence < 0.75) {
    return { decision: "pending", riskLevel: "medium", reason: "置信度不足 0.75，暂不自动沉淀，进入历史待审。" };
  }

  if (
    isLowRiskEventType(draft.eventType)
    || draft.eventType === "relationship_changed"
    || draft.eventType === "character_state_changed"
    || draft.eventType === "hook_resolved"
  ) {
    return {
      decision: "auto_apply",
      riskLevel: isLowRiskEventType(draft.eventType) ? "low" : "medium",
      reason: "章后结算自动应用：有正文证据且置信度足够；作者可在叙事记忆历史中回看。",
    };
  }

  return { decision: "auto_apply", riskLevel: "medium", reason: "默认自动结算；高风险词与 world_fact 仍保持 pending。" };
}
