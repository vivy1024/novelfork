import { describe, expect, it } from "vitest";

import { decideSettlementRisk, type NarrativeEventDraft, type ChapterSettlementResult } from "./settlement-risk-gate.js";

function draft(input: Partial<NarrativeEventDraft> = {}): NarrativeEventDraft {
  return {
    eventType: "location_changed",
    subject: "韩立",
    predicate: "抵达",
    object: "药园",
    evidenceText: "韩立抵达药园。",
    confidence: 0.9,
    source: "settle",
    ...input,
  };
}

describe("settlement risk gate", () => {
  it("auto-applies low-risk local events with direct evidence", () => {
    const decision = decideSettlementRisk(draft({ eventType: "location_changed" }));

    expect(decision).toMatchObject({ decision: "auto_apply", riskLevel: "low" });
    expect(decision.reason).toContain("自动应用");
  });

  it("auto-applies medium-risk relationship and character changes when confidence is sufficient", () => {
    expect(decideSettlementRisk(draft({ eventType: "relationship_changed", subject: "韩立", predicate: "信任", object: "厉飞雨", confidence: 0.9 }))).toMatchObject({ decision: "auto_apply", riskLevel: "medium" });
    expect(decideSettlementRisk(draft({ eventType: "character_state_changed", subject: "韩立", predicate: "决定", object: "离开山门", confidence: 0.88 }))).toMatchObject({ decision: "auto_apply", riskLevel: "medium" });
    expect(decideSettlementRisk(draft({ eventType: "character_state_changed", subject: "韩立", predicate: "决定", object: "离开山门", confidence: 0.5 }))).toMatchObject({ decision: "pending", riskLevel: "medium" });
  });

  it("keeps high-risk irreversible or canon-level events pending for author history review", () => {
    expect(decideSettlementRisk(draft({ eventType: "character_state_changed", subject: "厉飞雨", predicate: "死亡", object: "战斗中身亡" }))).toMatchObject({ decision: "pending", riskLevel: "high" });
    expect(decideSettlementRisk(draft({ eventType: "world_fact_introduced", subject: "世界规则", predicate: "改变", object: "灵根可被后天逆转" }))).toMatchObject({ decision: "pending", riskLevel: "high" });
    expect(decideSettlementRisk(draft({ eventType: "hook_resolved", subject: "小瓶", predicate: "核心伏笔回收", object: "证明能催熟药草" }))).toMatchObject({ decision: "pending", riskLevel: "high" });
  });

  it("rejects incomplete drafts without evidence before persistence", () => {
    expect(decideSettlementRisk(draft({ evidenceText: "" }))).toMatchObject({ decision: "reject", reason: expect.stringContaining("evidenceText") });
    expect(decideSettlementRisk(draft({ subject: "" }))).toMatchObject({ decision: "reject", reason: expect.stringContaining("subject") });
  });

  it("exports settlement result shape used by chapter settlement service", () => {
    const completed: ChapterSettlementResult = {
      status: "completed",
      bookId: "book-1",
      chapterNumber: 12,
      extracted: 3,
      autoApplied: 1,
      pending: 2,
      highRiskPending: 1,
      warnings: ["丢弃无效事件草案：schema 不匹配。"],
      events: [],
    };
    expect(completed).toMatchObject({ status: "completed", extracted: 3, autoApplied: 1, pending: 2, highRiskPending: 1 });

    // 抽取失败形态：带 error 码，供 agent 二次调用工具重试。
    const failedResult: ChapterSettlementResult = {
      status: "failed",
      bookId: "book-1",
      chapterNumber: 12,
      extracted: 0,
      autoApplied: 0,
      pending: 0,
      highRiskPending: 0,
      warnings: ["第12章结算失败：LLM 事件抽取调用未完成。"],
      events: [],
      error: "settlement-extraction-failed",
      explanation: {
        whatHappened: "第12章结算失败：LLM 事件抽取调用未完成。",
        whyItMatters: "本次未写入任何记忆，也未登记结算。",
        suggestedAction: "重新调用结算工具重试。",
      },
    };
    expect(failedResult).toMatchObject({ status: "failed", error: "settlement-extraction-failed" });
    expect(failedResult.explanation?.suggestedAction).toBeTruthy();
  });
});
