import { describe, expect, it } from "vitest";

import {
  DEFAULT_FORESHADOW_DEBT_THRESHOLDS,
  buildForeshadowDebts,
  checkForeshadowDebtThresholds,
  debtUrgency,
  resolveForeshadowDebtThresholds,
} from "./foreshadow-debts";
import { computeForeshadowingDebt } from "../jingwei/foreshadowing-debt";
import { computeNarrativeContractHitRate } from "../jingwei/context/chapter-briefing";

describe("伏笔阈值：作者按书设置", () => {
  it("合法阈值原样通过", () => {
    expect(checkForeshadowDebtThresholds({ watchChapters: 10, overdueChapters: 30 })).toEqual({
      ok: true,
      value: { watchChapters: 10, overdueChapters: 30 },
    });
  });

  it("临近提醒不小于超期、非整数、越界、缺字段都被拒绝，并说明原因", () => {
    const cases: unknown[] = [
      { watchChapters: 12, overdueChapters: 12 },
      { watchChapters: 20, overdueChapters: 12 },
      { watchChapters: 2.5, overdueChapters: 12 },
      { watchChapters: 0, overdueChapters: 12 },
      { watchChapters: 5, overdueChapters: 5000 },
      { watchChapters: 5 },
      "12",
      null,
      undefined,
    ];
    for (const raw of cases) {
      const checked = checkForeshadowDebtThresholds(raw);
      expect(checked.ok).toBe(false);
      if (!checked.ok) expect(checked.explanation.length).toBeGreaterThan(10);
    }
    const inverted = checkForeshadowDebtThresholds({ watchChapters: 20, overdueChapters: 12 });
    expect(!inverted.ok && inverted.explanation).toContain("必须小于");
  });

  it("解析时坏配置回到默认值，不让它关掉提醒", () => {
    expect(resolveForeshadowDebtThresholds(undefined)).toEqual(DEFAULT_FORESHADOW_DEBT_THRESHOLDS);
    expect(resolveForeshadowDebtThresholds({ watchChapters: 9, overdueChapters: 3 })).toEqual(DEFAULT_FORESHADOW_DEBT_THRESHOLDS);
    expect(resolveForeshadowDebtThresholds({ watchChapters: 3, overdueChapters: 9 })).toEqual({ watchChapters: 3, overdueChapters: 9 });
  });

  it("三个入口在自定义阈值下仍给出同一结论", () => {
    const thresholds = { watchChapters: 10, overdueChapters: 30 };
    for (const gap of [0, 9, 10, 29, 30, 31]) {
      const urgency = debtUrgency("planted", gap, thresholds);
      const level = computeForeshadowingDebt({ plantedChapter: 1, currentChapter: 1 + gap, thresholds }).level;
      const [debt] = buildForeshadowDebts(
        [{ id: "fs", title: "断剑之谜", fields: { plantedChapter: 1, status: "planted" } }],
        1 + gap,
        thresholds,
      );
      const expected = gap >= 30 ? "overdue" : gap >= 10 ? "watch" : "ok";
      expect(urgency).toBe(expected);
      expect(debt!.urgency).toBe(expected);
      expect(level).toBe(expected === "overdue" ? "overdue" : expected === "watch" ? "due-soon" : "fresh");
    }
  });

  it("超期说明文案报出本书的超期线，而不是默认值", () => {
    const debt = computeForeshadowingDebt({
      plantedChapter: 1,
      currentChapter: 41,
      thresholds: { watchChapters: 10, overdueChapters: 40 },
    });
    expect(debt.level).toBe("overdue");
    expect(debt.explanation).toContain("40 章阈值");
  });

  it("写前简报的叙事契约命中率按本书阈值判超期", () => {
    // 只用到 sqlite.prepare(...).all(...)：契约链表为空，经纬里一条悬置 20 章的伏笔。
    const storage = {
      sqlite: {
        prepare: (sql: string) => ({
          all: () => sql.includes("jingwei_causal_chains")
            ? []
            : [{ fields_json: JSON.stringify({ plantedChapter: 1, status: "planted" }), lifecycle: "active" }],
        }),
      },
    } as unknown as Parameters<typeof computeNarrativeContractHitRate>[0];
    // 默认超期线 12 章 → 超期，命中率 0；这本书设成 30 章 → 未超期，分母为 0 返回 null。
    expect(computeNarrativeContractHitRate(storage, "book-1", 21)).toBe(0);
    expect(computeNarrativeContractHitRate(storage, "book-1", 21, { watchChapters: 10, overdueChapters: 30 })).toBeNull();
  });
});
