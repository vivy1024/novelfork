/**
 * 伏笔债务多入口一致性收敛测试 (Task A2)
 *
 * 验证：
 * 1. 领域纯函数 `foreshadow-debts.ts`
 * 2. 经纬兼容层 `foreshadowing-debt.ts`
 * 3. 故事推进看板 `story-progress-board.ts`
 *
 * 三个入口针对相同伏笔 fixture 给出完全一致的判定结果（不存在阈值割裂）。
 */

import { describe, expect, it } from "vitest";

import {
  buildForeshadowDebts,
  debtUrgency,
  DEBT_OVERDUE_CHAPTERS,
  DEBT_WATCH_CHAPTERS,
  type ForeshadowDebtUrgency,
} from "./foreshadow-debts";

import {
  computeForeshadowingDebt,
  FORESHADOWING_DEBT_THRESHOLD,
  FORESHADOWING_DUE_SOON_THRESHOLD,
  type ForeshadowingDebtLevel,
} from "../jingwei/foreshadowing-debt";

describe("伏笔债务统一口径一致性验证", () => {
  it("常量阈值定义 100% 同步", () => {
    expect(FORESHADOWING_DEBT_THRESHOLD).toBe(DEBT_OVERDUE_CHAPTERS);
    expect(FORESHADOWING_DUE_SOON_THRESHOLD).toBe(DEBT_WATCH_CHAPTERS);
    expect(DEBT_WATCH_CHAPTERS).toBe(5);
    expect(DEBT_OVERDUE_CHAPTERS).toBe(12);
  });

  const levelToUrgency = (level: ForeshadowingDebtLevel): ForeshadowDebtUrgency => {
    switch (level) {
      case "overdue":
        return "overdue";
      case "due-soon":
        return "watch";
      case "fresh":
      case "settled":
      case "unknown":
      default:
        return "ok";
    }
  };

  it("不同悬置章数下，foreshadow-debts 与 computeForeshadowingDebt 判定完全一致", () => {
    const currentChapter = 30;

    const testFixtures = [
      { id: "1", title: "刚刚埋下", planted: 28, expectedUrgency: "ok" as const },
      { id: "2", title: "安全区间", planted: 26, expectedUrgency: "ok" as const },
      { id: "3", title: "刚触达提醒线", planted: 25, expectedUrgency: "watch" as const }, // 30 - 25 = 5
      { id: "4", title: "临期提醒区间", planted: 20, expectedUrgency: "watch" as const }, // 30 - 20 = 10
      { id: "5", title: "刚超期", planted: 18, expectedUrgency: "overdue" as const },     // 30 - 18 = 12
      { id: "6", title: "深度超期", planted: 5, expectedUrgency: "overdue" as const },      // 30 - 5 = 25
    ];

    for (const fixture of testFixtures) {
      // 1. 领域纯函数判定
      const gap = currentChapter - fixture.planted;
      const urgency1 = debtUrgency("planted", gap);

      // 2. 经纬适配层判定
      const debt2 = computeForeshadowingDebt({
        plantedChapter: fixture.planted,
        currentChapter,
      });
      const urgency2 = levelToUrgency(debt2.level);

      // 3. 全局 buildForeshadowDebts 判定
      const debts3 = buildForeshadowDebts(
        [
          {
            id: fixture.id,
            title: fixture.title,
            fields: { plantedChapter: fixture.planted, status: "planted" },
          },
        ],
        currentChapter,
      );
      const urgency3 = debts3[0]!.urgency;

      expect(urgency1).toBe(fixture.expectedUrgency);
      expect(urgency2).toBe(fixture.expectedUrgency);
      expect(urgency3).toBe(fixture.expectedUrgency);
    }
  });

  it("已回收伏笔在所有入口均判定为安全无债务", () => {
    const currentChapter = 50;
    const planted = 10; // 悬置 40 章，但已回收

    const urgency1 = debtUrgency("paid_off", currentChapter - planted);
    const debt2 = computeForeshadowingDebt({
      plantedChapter: planted,
      currentChapter,
      settled: true,
    });
    const debts3 = buildForeshadowDebts(
      [
        {
          id: "settled-1",
          title: "旧伏笔",
          fields: { plantedChapter: planted, payoffChapter: 25, status: "paid_off" },
        },
      ],
      currentChapter,
    );

    expect(urgency1).toBe("ok");
    expect(debt2.level).toBe("settled");
    expect(levelToUrgency(debt2.level)).toBe("ok");
    expect(debts3[0]!.urgency).toBe("ok");
  });
});
