import { describe, expect, it } from "vitest";

import {
  computeForeshadowingDebt,
  FORESHADOWING_DEBT_THRESHOLD,
  FORESHADOWING_DUE_SOON_THRESHOLD,
  toCockpitHookRisk,
} from "./foreshadowing-debt";

describe("computeForeshadowingDebt", () => {
  it("用真实当前章号算出正的悬置章数", () => {
    const debt = computeForeshadowingDebt({ plantedChapter: 12, currentChapter: 30 });
    expect(debt.suspenseChapters).toBe(18);
    expect(debt.level).toBe("due-soon");
    expect(debt.explanation).toContain("第 12 章");
    expect(debt.explanation).toContain("已悬置 18 章");
  });

  it("超期文案同时点出埋设章与当前章，方便作者定位", () => {
    const debt = computeForeshadowingDebt({ plantedChapter: 12, currentChapter: 60 });
    expect(debt.level).toBe("overdue");
    expect(debt.explanation).toContain("第 12 章");
    expect(debt.explanation).toContain("第 60 章");
  });

  it("绝不产生负数悬念（当前章号早于埋设章号时归零）", () => {
    const debt = computeForeshadowingDebt({ plantedChapter: 40, currentChapter: 5 });
    expect(debt.suspenseChapters).toBe(0);
    expect(debt.level).toBe("fresh");
  });

  it("阈值边界：等于阈值不算超期，超过一章才超期", () => {
    const atThreshold = computeForeshadowingDebt({
      plantedChapter: 1,
      currentChapter: 1 + FORESHADOWING_DEBT_THRESHOLD,
    });
    expect(atThreshold.suspenseChapters).toBe(FORESHADOWING_DEBT_THRESHOLD);
    expect(atThreshold.level).toBe("due-soon");

    const overThreshold = computeForeshadowingDebt({
      plantedChapter: 1,
      currentChapter: 2 + FORESHADOWING_DEBT_THRESHOLD,
    });
    expect(overThreshold.suspenseChapters).toBe(FORESHADOWING_DEBT_THRESHOLD + 1);
    expect(overThreshold.level).toBe("overdue");
    expect(overThreshold.label).toContain("超期");
  });

  it("临近到期边界：低一章仍是 fresh，达到即 due-soon", () => {
    const justBefore = computeForeshadowingDebt({
      plantedChapter: 10,
      currentChapter: 10 + FORESHADOWING_DUE_SOON_THRESHOLD - 1,
    });
    expect(justBefore.level).toBe("fresh");

    const atDueSoon = computeForeshadowingDebt({
      plantedChapter: 10,
      currentChapter: 10 + FORESHADOWING_DUE_SOON_THRESHOLD,
    });
    expect(atDueSoon.level).toBe("due-soon");
  });

  it("拿不到当前章号时显式返回 unknown，不猜也不算负数", () => {
    for (const currentChapter of [undefined, null]) {
      const debt = computeForeshadowingDebt({ plantedChapter: 12, currentChapter });
      expect(debt.level).toBe("unknown");
      expect(debt.suspenseChapters).toBeNull();
      expect(debt.label).toBe("悬念未知");
      expect(debt.explanation).toContain("读不到本书当前章号");
    }
  });

  it("没记录埋设章号时同样是 unknown 而非 0 章悬念", () => {
    const debt = computeForeshadowingDebt({ plantedChapter: 0, currentChapter: 88 });
    expect(debt.level).toBe("unknown");
    expect(debt.suspenseChapters).toBeNull();
    expect(debt.explanation).toContain("plantedChapter");
  });

  it("已回收/已废弃的伏笔即使早已超期也不再计债", () => {
    const debt = computeForeshadowingDebt({ plantedChapter: 1, currentChapter: 500, settled: true });
    expect(debt.level).toBe("settled");
    expect(debt.suspenseChapters).toBe(499);
  });

  it("每种状态都带 explanation（发生了什么 / 为什么看 / 怎么做）", () => {
    const cases = [
      computeForeshadowingDebt({ plantedChapter: 1, currentChapter: 2 }),
      computeForeshadowingDebt({ plantedChapter: 1, currentChapter: 16 }),
      computeForeshadowingDebt({ plantedChapter: 1, currentChapter: 60 }),
      computeForeshadowingDebt({ plantedChapter: 1, currentChapter: undefined }),
      computeForeshadowingDebt({ plantedChapter: 1, currentChapter: 60, settled: true }),
    ];
    for (const debt of cases) {
      expect(debt.explanation.length).toBeGreaterThan(20);
    }
  });

  it("非整数/负数章号被规范化，不产生 NaN 悬念", () => {
    const debt = computeForeshadowingDebt({ plantedChapter: 3.7, currentChapter: 20.9 });
    expect(debt.suspenseChapters).toBe(17);

    const negative = computeForeshadowingDebt({ plantedChapter: -3, currentChapter: 20 });
    expect(negative.level).toBe("unknown");
  });
});

describe("toCockpitHookRisk", () => {
  it("驾驶舱三态与看板阈值同源", () => {
    expect(toCockpitHookRisk(computeForeshadowingDebt({ plantedChapter: 1, currentChapter: 5 }))).toBe("open");
    expect(
      toCockpitHookRisk(computeForeshadowingDebt({ plantedChapter: 1, currentChapter: 1 + FORESHADOWING_DUE_SOON_THRESHOLD })),
    ).toBe("payoff-due");
    expect(
      toCockpitHookRisk(computeForeshadowingDebt({ plantedChapter: 1, currentChapter: 2 + FORESHADOWING_DEBT_THRESHOLD })),
    ).toBe("expired-risk");
  });

  it("未知与已结清都不进风险统计", () => {
    expect(toCockpitHookRisk(computeForeshadowingDebt({ plantedChapter: 1, currentChapter: undefined }))).toBe("open");
    expect(toCockpitHookRisk(computeForeshadowingDebt({ plantedChapter: 1, currentChapter: 999, settled: true }))).toBe("open");
  });
});
