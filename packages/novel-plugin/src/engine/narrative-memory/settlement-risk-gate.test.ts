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
    expect(decision.reason).toContain("低风险");
  });

  it("keeps medium-risk relationship and important character changes pending", () => {
    expect(decideSettlementRisk(draft({ eventType: "relationship_changed", subject: "韩立", predicate: "信任", object: "厉飞雨" }))).toMatchObject({ decision: "pending", riskLevel: "medium" });
    expect(decideSettlementRisk(draft({ eventType: "character_state_changed", subject: "韩立", predicate: "决定", object: "离开山门" }))).toMatchObject({ decision: "pending", riskLevel: "medium" });
  });

  it("keeps high-risk irreversible or canon-level events pending", () => {
    expect(decideSettlementRisk(draft({ eventType: "character_state_changed", subject: "厉飞雨", predicate: "死亡", object: "战斗中身亡" }))).toMatchObject({ decision: "pending", riskLevel: "high" });
    expect(decideSettlementRisk(draft({ eventType: "world_fact_introduced", subject: "世界规则", predicate: "改变", object: "灵根可被后天逆转" }))).toMatchObject({ decision: "pending", riskLevel: "high" });
    expect(decideSettlementRisk(draft({ eventType: "hook_resolved", subject: "小瓶", predicate: "核心伏笔回收", object: "证明能催熟药草" }))).toMatchObject({ decision: "pending", riskLevel: "high" });
  });

  it("rejects incomplete drafts without evidence before persistence", () => {
    expect(decideSettlementRisk(draft({ evidenceText: "" }))).toMatchObject({ decision: "reject", reason: expect.stringContaining("evidenceText") });
    expect(decideSettlementRisk(draft({ subject: "" }))).toMatchObject({ decision: "reject", reason: expect.stringContaining("subject") });
  });

  it("exports settlement result shape used by chapter settlement service", () => {
    const result: ChapterSettlementResult = {
      status: "completed",
      bookId: "book-1",
      chapterNumber: 12,
      extracted: 3,
      autoApplied: 1,
      pending: 2,
      highRiskPending: 1,
      warnings: ["LLM 抽取失败，已使用规则兜底。"],
      events: [],
    };

    expect(result).toMatchObject({ status: "completed", extracted: 3, autoApplied: 1, pending: 2, highRiskPending: 1 });
  });
});
