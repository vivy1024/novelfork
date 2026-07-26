import { describe, expect, it } from "vitest";

import { checkOverdraft, parseEndgameReserve, type EndgameReserve } from "./endgame-reserve";

const reserve: EndgameReserve = {
  trumpCards: [
    { id: "t1", kind: "arch-enemy", name: "血河老祖", unlockAtVolume: 4, spentAtVolume: null },
    { id: "t2", kind: "ultimate-truth", name: "灭门真凶", unlockAtVolume: 3, spentAtVolume: null },
    { id: "t3", kind: "power-ceiling", name: "第九重雷劫", unlockAtVolume: 5, spentAtVolume: null },
  ],
  ladders: [
    { id: "l1", name: "境界", totalSteps: 9, currentStep: 2, maxStepThisVolume: 3 },
  ],
};

describe("checkOverdraft — 两问", () => {
  it("储备健康时无 finding，并报出剩余底牌数", () => {
    const report = checkOverdraft(reserve, 1);
    expect(report.spentLockedTrump).toBe(false);
    expect(report.ladderExhausted).toBe(false);
    expect(report.findings).toEqual([]);
    expect(report.remainingTrumps).toBe(3);
    expect(report.summary).toContain("剩余底牌 3 张");
  });

  it("第一问：底牌提前动用判 block", () => {
    const report = checkOverdraft({
      ...reserve,
      trumpCards: [{ ...reserve.trumpCards[0]!, spentAtVolume: 2 }],
    }, 2);
    expect(report.spentLockedTrump).toBe(true);
    const finding = report.findings.find((item) => item.code === "trump-spent-too-early");
    expect(finding?.severity).toBe("block");
    expect(finding?.subject).toBe("血河老祖");
    expect(finding?.whatHappened).toContain("第 4 卷才解锁");
    expect(finding?.whatHappened).toContain("第 2 卷动用");
    expect(finding?.suggestedAction).toBeTruthy();
  });

  it("按计划解锁后动用不算透支", () => {
    const report = checkOverdraft({
      ...reserve,
      // 三张牌里动用第一张（第 4 卷解锁，第 4 卷动用），剩两张未动用
      trumpCards: [
        { ...reserve.trumpCards[0]!, spentAtVolume: 4 },
        reserve.trumpCards[1]!,
        reserve.trumpCards[2]!,
      ],
    }, 4);
    expect(report.spentLockedTrump).toBe(false);
    expect(report.remainingTrumps).toBe(2);
  });

  it("第二问：越级判 block", () => {
    const report = checkOverdraft({
      ...reserve,
      ladders: [{ id: "l1", name: "境界", totalSteps: 9, currentStep: 6, maxStepThisVolume: 3 }],
    }, 1);
    expect(report.ladderExhausted).toBe(true);
    const finding = report.findings.find((item) => item.code === "ladder-step-skipped");
    expect(finding?.severity).toBe("block");
    expect(finding?.whatHappened).toContain("本卷上限是第 3 档");
  });

  it("升级线到顶判 block", () => {
    const report = checkOverdraft({
      trumpCards: [],
      ladders: [{ id: "l1", name: "境界", totalSteps: 9, currentStep: 9 }],
    }, 8);
    expect(report.ladderExhausted).toBe(true);
    expect(report.findings.some((item) => item.code === "ladder-near-ceiling" && item.severity === "block")).toBe(true);
  });

  it("逼近天花板只 warn 不 block", () => {
    const report = checkOverdraft({
      trumpCards: [],
      ladders: [{ id: "l1", name: "境界", totalSteps: 9, currentStep: 8 }],
    }, 7);
    const finding = report.findings.find((item) => item.code === "ladder-near-ceiling");
    expect(finding?.severity).toBe("warn");
    expect(report.ladderExhausted).toBe(false);
  });

  it("未声明储备时给 warn 并说明后果", () => {
    const report = checkOverdraft(null, 1);
    const finding = report.findings.find((item) => item.code === "no-reserve-declared");
    expect(finding?.severity).toBe("warn");
    expect(finding?.whyItMatters).toContain("无牌可打");
    expect(report.summary).toContain("未声明");
  });

  it("空储备等同未声明", () => {
    expect(checkOverdraft({ trumpCards: [], ladders: [] }, 1).findings[0]?.code).toBe("no-reserve-declared");
  });

  it("每条 finding 都带完整人话三段式", () => {
    const report = checkOverdraft({
      trumpCards: [{ id: "t", kind: "arch-enemy", name: "宿敌", unlockAtVolume: 5, spentAtVolume: 1 }],
      ladders: [{ id: "l", name: "境界", totalSteps: 4, currentStep: 4 }],
    }, 1);
    expect(report.findings.length).toBeGreaterThanOrEqual(2);
    for (const finding of report.findings) {
      expect(finding.whatHappened.length).toBeGreaterThan(5);
      expect(finding.whyItMatters.length).toBeGreaterThan(5);
      expect(finding.suggestedAction.length).toBeGreaterThan(5);
    }
  });
});

describe("parseEndgameReserve", () => {
  it("解析合法结构", () => {
    const parsed = parseEndgameReserve({
      trumpCards: [{ id: "a", kind: "ultimate-truth", name: "真相", unlockAtVolume: 3 }],
      ladders: [{ name: "境界", totalSteps: 9, currentStep: 2, maxStepThisVolume: 3 }],
    });
    expect(parsed?.trumpCards[0]?.name).toBe("真相");
    expect(parsed?.trumpCards[0]?.spentAtVolume).toBeNull();
    expect(parsed?.ladders[0]?.id).toBe("境界");
  });

  it("丢弃无名条目，容忍脏字段", () => {
    const parsed = parseEndgameReserve({
      trumpCards: [{ name: "" }, { name: "有效", unlockAtVolume: "x" }],
      ladders: [{ name: "线", totalSteps: -3, currentStep: "y" }],
    });
    expect(parsed?.trumpCards).toHaveLength(1);
    expect(parsed?.trumpCards[0]?.unlockAtVolume).toBe(1);
    expect(parsed?.ladders[0]?.totalSteps).toBe(1);
    expect(parsed?.ladders[0]?.currentStep).toBe(0);
  });

  it("未知 kind 归一为 ultimate-truth", () => {
    const parsed = parseEndgameReserve({ trumpCards: [{ name: "x", kind: "不存在" }] });
    expect(parsed?.trumpCards[0]?.kind).toBe("ultimate-truth");
  });

  it("非对象或全空返回 null", () => {
    expect(parseEndgameReserve(null)).toBeNull();
    expect(parseEndgameReserve("x")).toBeNull();
    expect(parseEndgameReserve({ trumpCards: [], ladders: [] })).toBeNull();
  });
});
