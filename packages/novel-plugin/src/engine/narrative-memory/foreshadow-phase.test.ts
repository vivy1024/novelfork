import { describe, expect, it } from "vitest";

import { foreshadowPhase, selectDueHooks, type DueHookInput } from "./foreshadow-phase.js";

describe("foreshadowPhase（T2 收敛沙漏）", () => {
  it("按 current/targetChapters 推导三阶段", () => {
    expect(foreshadowPhase(50, 200)).toBe("development");
    expect(foreshadowPhase(150, 200)).toBe("convergence"); // 75%
    expect(foreshadowPhase(190, 200)).toBe("finale"); // 95%
    expect(foreshadowPhase(200, 200)).toBe("finale");
  });

  it("无基线（target 缺失/非法/章号非法）按 development 跳过守卫", () => {
    expect(foreshadowPhase(180, undefined)).toBe("development");
    expect(foreshadowPhase(180, 0)).toBe("development");
    expect(foreshadowPhase(-1, 200)).toBe("development");
  });
});

describe("selectDueHooks（T2 到期窗口 top3）", () => {
  const base: DueHookInput = { title: "x", status: "已埋设" };

  it("只收未回收且 targetChapter ∈ [1, current+2]，过期在前升序，截取 top3", () => {
    const entries: DueHookInput[] = [
      { ...base, title: "未来太远", targetChapter: 50 },
      { ...base, title: "已过期最久", targetChapter: 3 },
      { ...base, title: "窗口边缘", targetChapter: 12 }, // current10+2
      { ...base, title: "已回收不算", status: "已回收", targetChapter: 2 },
      { ...base, title: "无排期不算" },
      { ...base, title: "过期次之", targetChapter: 5 },
      { ...base, title: "窗口内第一", targetChapter: 11 },
    ];
    const due = selectDueHooks(entries, 10);
    expect(due.map((hook) => hook.title)).toEqual(["已过期最久", "过期次之", "窗口内第一"]);
    expect(due[0]?.dueChapter).toBe(3);
  });

  it("第五态唤醒中参与召回；废弃不参与", () => {
    const entries: DueHookInput[] = [
      { ...base, title: "唤醒甲", status: "唤醒中", targetChapter: 11 },
      { ...base, title: "废弃乙", status: "已废弃", targetChapter: 10 },
    ];
    const due = selectDueHooks(entries, 10);
    expect(due.map((hook) => hook.title)).toEqual(["唤醒甲"]);
  });

  it("includes CFPG triggered status in the due window", () => {
    const due = selectDueHooks([
      { title: "上膛", status: "triggered", targetChapter: 10 },
      { title: "已收", status: "paid_off", targetChapter: 9 },
    ], 10);
    expect(due.map((hook) => hook.title)).toEqual(["上膛"]);
  });

  it("current 很小（即将写第 1 章）时窗口 [1,3] 正常召回开篇钩子", () => {
    const due = selectDueHooks([{ ...base, title: "a", targetChapter: 1 }], 0);
    // current=0 语义是「即将写第 1 章」：窗口 = 0+2，target 1 命中。
    expect(due.map((hook) => hook.title)).toEqual(["a"]);
  });
});
