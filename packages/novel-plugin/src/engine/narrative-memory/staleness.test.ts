import { describe, expect, it } from "vitest";

import {
  collectStaleFacts,
  computeFactStaleness,
  computeFactStalenessFromFact,
  isMachineExtractedFactSource,
  isStalenessCandidate,
  STALE_FACT_THRESHOLD,
} from "./staleness.js";
import type { NarrativeFact } from "./types.js";

function fact(input: Partial<NarrativeFact> & Pick<NarrativeFact, "id">): NarrativeFact {
  return {
    id: input.id,
    bookId: input.bookId ?? "book-1",
    subject: input.subject ?? "林凡",
    predicate: input.predicate ?? "处境",
    object: input.object ?? "被困秘境",
    category: input.category ?? "conflicts",
    layer: input.layer ?? "dynamic",
    confidence: input.confidence ?? 0.9,
    sourceType: input.sourceType ?? "event",
    sourceId: input.sourceId,
    sourceChapter: input.sourceChapter,
    evidenceText: input.evidenceText,
    validFromChapter: input.validFromChapter,
    validUntilChapter: input.validUntilChapter,
    createdAt: input.createdAt ?? "2024-01-01T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2024-01-01T00:00:00.000Z",
  };
}

describe("isStalenessCandidate", () => {
  it("只把机器抽取的 dynamic 动态分类纳入陈旧判定", () => {
    // conflicts 是 dynamic 分类，event 是机器来源 → 纳入
    expect(isStalenessCandidate({ layer: "dynamic", sourceType: "event", category: "conflicts" })).toBe(true);
    expect(isStalenessCandidate({ layer: "dynamic", sourceType: "jingwei", category: "relationships" })).toBe(true);
  });

  it("排除 canon / reference 层（不随时间失效）", () => {
    expect(isStalenessCandidate({ layer: "canon", sourceType: "event", category: "characters" })).toBe(false);
    expect(isStalenessCandidate({ layer: "reference", sourceType: "event", category: "reference" })).toBe(false);
  });

  it("排除作者手写/导入来源（明确表态不催促）", () => {
    expect(isStalenessCandidate({ layer: "dynamic", sourceType: "manual", category: "conflicts" })).toBe(false);
    expect(isStalenessCandidate({ layer: "dynamic", sourceType: "import", category: "conflicts" })).toBe(false);
  });

  it("排除非动态推进分类（即便标了 dynamic 层）", () => {
    // characters 的 defaultLayer 是 canon，不属于章后动态推进类
    expect(isStalenessCandidate({ layer: "dynamic", sourceType: "event", category: "characters" })).toBe(false);
  });
});

describe("isMachineExtractedFactSource", () => {
  it("manual/import 为作者来源，其余为机器来源", () => {
    expect(isMachineExtractedFactSource("manual")).toBe(false);
    expect(isMachineExtractedFactSource("import")).toBe(false);
    expect(isMachineExtractedFactSource("event")).toBe(true);
    expect(isMachineExtractedFactSource("jingwei")).toBe(true);
    expect(isMachineExtractedFactSource("runtime-state")).toBe(true);
  });
});

describe("computeFactStaleness", () => {
  it("超过阈值判 stale 并给三段式 explanation", () => {
    const result = computeFactStaleness({
      layer: "dynamic",
      sourceType: "event",
      category: "conflicts",
      lastChangedChapter: 8,
      currentChapter: 8 + STALE_FACT_THRESHOLD + 1,
    });
    expect(result.level).toBe("stale");
    expect(result.staleChapters).toBe(STALE_FACT_THRESHOLD + 1);
    expect(result.explanation.whatHappened).toContain("第 8 章");
    expect(result.explanation.whyItMatters.length).toBeGreaterThan(0);
    expect(result.explanation.suggestedAction).toContain("不会自动修改");
  });

  it("阈值内判 fresh", () => {
    const result = computeFactStaleness({
      layer: "dynamic",
      sourceType: "event",
      category: "conflicts",
      lastChangedChapter: 90,
      currentChapter: 99,
    });
    expect(result.level).toBe("fresh");
    expect(result.staleChapters).toBe(9);
  });

  it("恰好等于阈值不算 stale（严格大于才提示）", () => {
    const result = computeFactStaleness({
      layer: "dynamic",
      sourceType: "event",
      category: "conflicts",
      lastChangedChapter: 10,
      currentChapter: 10 + STALE_FACT_THRESHOLD,
    });
    expect(result.level).toBe("fresh");
    expect(result.staleChapters).toBe(STALE_FACT_THRESHOLD);
  });

  it("缺当前章号返回 unknown，不臆造", () => {
    const result = computeFactStaleness({
      layer: "dynamic",
      sourceType: "event",
      category: "conflicts",
      lastChangedChapter: 8,
      currentChapter: undefined,
    });
    expect(result.level).toBe("unknown");
    expect(result.staleChapters).toBeNull();
  });

  it("缺最后变动章号返回 unknown", () => {
    const result = computeFactStaleness({
      layer: "dynamic",
      sourceType: "event",
      category: "conflicts",
      lastChangedChapter: null,
      currentChapter: 99,
    });
    expect(result.level).toBe("unknown");
    expect(result.staleChapters).toBeNull();
  });

  it("不适用的 fact 返回 not-applicable 且不为负", () => {
    const canon = computeFactStaleness({
      layer: "canon",
      sourceType: "event",
      category: "characters",
      lastChangedChapter: 1,
      currentChapter: 999,
    });
    expect(canon.level).toBe("not-applicable");
    expect(canon.staleChapters).toBeNull();

    const manual = computeFactStaleness({
      layer: "dynamic",
      sourceType: "manual",
      category: "conflicts",
      lastChangedChapter: 1,
      currentChapter: 999,
    });
    expect(manual.level).toBe("not-applicable");
  });

  it("变动章晚于当前章（未来生效）不产生负陈旧", () => {
    const result = computeFactStaleness({
      layer: "dynamic",
      sourceType: "event",
      category: "conflicts",
      lastChangedChapter: 120,
      currentChapter: 100,
    });
    expect(result.level).toBe("fresh");
    expect(result.staleChapters).toBe(0);
  });
});

describe("computeFactStalenessFromFact", () => {
  it("最后变动章优先取 validFromChapter，回退 sourceChapter", () => {
    const withValidFrom = computeFactStalenessFromFact(
      fact({ id: "f1", validFromChapter: 5, sourceChapter: 50 }),
      5 + STALE_FACT_THRESHOLD + 1,
    );
    expect(withValidFrom.staleChapters).toBe(STALE_FACT_THRESHOLD + 1);

    const fallbackSource = computeFactStalenessFromFact(
      fact({ id: "f2", sourceChapter: 5 }),
      5 + STALE_FACT_THRESHOLD + 1,
    );
    expect(fallbackSource.staleChapters).toBe(STALE_FACT_THRESHOLD + 1);
  });
});

describe("collectStaleFacts", () => {
  it("只返回 stale 项，按未变动章数降序", () => {
    const facts = [
      fact({ id: "old", validFromChapter: 5 }), // 95 章未变动
      fact({ id: "older", validFromChapter: 2 }), // 98 章未变动
      fact({ id: "fresh", validFromChapter: 95 }), // 5 章
      fact({ id: "canon", layer: "canon", category: "characters", validFromChapter: 1 }), // 不适用
      fact({ id: "manual", sourceType: "manual", validFromChapter: 1 }), // 不适用
    ];
    const reports = collectStaleFacts(facts, 100);
    expect(reports.map((r) => r.fact.id)).toEqual(["older", "old"]);
    expect(reports.every((r) => r.staleness.level === "stale")).toBe(true);
  });

  it("无当前章号时返回空（无法判定不臆造）", () => {
    const reports = collectStaleFacts([fact({ id: "x", validFromChapter: 1 })], undefined);
    expect(reports).toHaveLength(0);
  });
});
