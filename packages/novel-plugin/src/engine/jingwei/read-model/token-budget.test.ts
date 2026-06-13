import { describe, expect, it } from "vitest";
import { applyTokenBudget, applyTokenBudgetWithDegradation, type DegradableItem } from "./token-budget.js";

describe("applyTokenBudget (整条丢弃，向后兼容)", () => {
  it("全部放得下时全保留", () => {
    const items = [
      { id: "a", estimatedTokens: 100, priority: 10 },
      { id: "b", estimatedTokens: 100, priority: 5 },
    ];
    const result = applyTokenBudget(items, 1000);
    expect(result.items).toHaveLength(2);
    expect(result.droppedEntryIds).toEqual([]);
  });

  it("超预算时按优先级从低到高丢弃", () => {
    const items = [
      { id: "high", estimatedTokens: 600, priority: 100 },
      { id: "low", estimatedTokens: 600, priority: 1 },
    ];
    const result = applyTokenBudget(items, 700);
    expect(result.items.map((i) => i.id)).toEqual(["high"]);
    expect(result.droppedEntryIds).toEqual(["low"]);
  });
});

describe("applyTokenBudgetWithDegradation (逐条降级)", () => {
  // 每条提供 full/normal/summary/brief 四档 token 估算
  function item(id: string, priority: number, tokens: [number, number, number, number]): DegradableItem {
    return {
      id,
      priority,
      levels: [
        { detailLevel: "full", estimatedTokens: tokens[0] },
        { detailLevel: "normal", estimatedTokens: tokens[1] },
        { detailLevel: "summary", estimatedTokens: tokens[2] },
        { detailLevel: "brief", estimatedTokens: tokens[3] },
      ],
      initialLevel: "full",
    };
  }

  it("全部全文放得下时全保留 full 级", () => {
    const items = [item("a", 10, [100, 60, 30, 10]), item("b", 5, [100, 60, 30, 10])];
    const result = applyTokenBudgetWithDegradation(items, 1000);
    expect(result.items).toHaveLength(2);
    expect(result.items.every((r) => r.detailLevel === "full")).toBe(true);
    expect(result.droppedEntryIds).toEqual([]);
  });

  it("超预算时先降级最低优先的条目，而非直接丢弃", () => {
    // full 总和 200 > 150。降级 low 到 normal(60) → 100+60=160 还超 → 降 low 到 summary(30) → 130 ok
    const items = [item("high", 100, [100, 60, 30, 10]), item("low", 1, [100, 60, 30, 10])];
    const result = applyTokenBudgetWithDegradation(items, 150);
    const high = result.items.find((r) => r.id === "high");
    const low = result.items.find((r) => r.id === "low");
    expect(high?.detailLevel).toBe("full"); // 高优先保持全文
    expect(low).toBeDefined(); // 低优先未被丢弃
    expect(low?.detailLevel).not.toBe("full"); // 但被降级了
    expect(result.droppedEntryIds).toEqual([]);
  });

  it("降到最简(brief)仍超预算才丢弃", () => {
    // 两条 brief 各 100，预算 150 → 即使全降到 brief 也是 200 > 150 → 丢弃最低优先
    const items = [item("high", 100, [300, 200, 150, 100]), item("low", 1, [300, 200, 150, 100])];
    const result = applyTokenBudgetWithDegradation(items, 150);
    expect(result.items.map((r) => r.id)).toEqual(["high"]);
    expect(result.items[0]?.detailLevel).toBe("brief"); // high 降到 brief 恰好 100<=150
    expect(result.droppedEntryIds).toEqual(["low"]);
  });

  it("预算为负时全部丢弃", () => {
    const items = [item("a", 10, [100, 60, 30, 10])];
    const result = applyTokenBudgetWithDegradation(items, -1);
    expect(result.items).toHaveLength(0);
    expect(result.droppedEntryIds).toEqual(["a"]);
  });

  it("尊重 initialLevel — 不会升级到比初始更高的档", () => {
    // low 初始就是 summary，不应升到 full
    const items: DegradableItem[] = [
      { id: "a", priority: 10, initialLevel: "summary", levels: [
        { detailLevel: "full", estimatedTokens: 100 },
        { detailLevel: "normal", estimatedTokens: 60 },
        { detailLevel: "summary", estimatedTokens: 30 },
        { detailLevel: "brief", estimatedTokens: 10 },
      ] },
    ];
    const result = applyTokenBudgetWithDegradation(items, 1000);
    expect(result.items[0]?.detailLevel).toBe("summary"); // 保持初始档，不升级
  });
});
