import { describe, expect, it } from "vitest";

import { deriveForeshadowStates, resolveForeshadowPhase } from "./foreshadow-states.js";

describe("resolveForeshadowPhase", () => {
  it("认中英两套状态写法", () => {
    expect(resolveForeshadowPhase({ status: "已埋设" })).toBe("planted");
    expect(resolveForeshadowPhase({ status: "部分揭示" })).toBe("reinforced");
    expect(resolveForeshadowPhase({ status: "唤醒中" })).toBe("triggered");
    expect(resolveForeshadowPhase({ status: "已回收" })).toBe("paid_off");
    expect(resolveForeshadowPhase({ status: "已废弃" })).toBe("abandoned");
    expect(resolveForeshadowPhase({ status: "paid_off" })).toBe("paid_off");
  });

  it("脏值按章号推断，推不出记 unknown", () => {
    expect(resolveForeshadowPhase({ status: "主角迟早会发现", plantedChapter: 4 })).toBe("planted");
    expect(resolveForeshadowPhase({})).toBe("unknown");
  });
});

describe("deriveForeshadowStates", () => {
  const entry = { id: "entry-bottle", title: "小瓶", fields: { status: "已埋设" } };

  it("关联事件把阶段往前推，并补上条目没填的章号与触发条件", () => {
    const [state] = deriveForeshadowStates([entry], [
      { chapterNumber: 3, eventType: "hook_planted", subject: "小瓶", object: "绿液", subjectEntryId: "entry-bottle", status: "applied" },
      { chapterNumber: 8, eventType: "hook_triggered", subject: "小瓶", object: "药园试验开始", subjectEntryId: "entry-bottle", status: "applied" },
      { chapterNumber: 9, eventType: "hook_progressed", subject: "小瓶", object: "再次提及", subjectEntryId: "entry-bottle", status: "applied" },
    ]);
    expect(state).toEqual({
      entryId: "entry-bottle",
      label: "小瓶",
      phase: "triggered",
      setupChapter: 3,
      triggerChapter: 8,
      triggerCondition: "药园试验开始",
    });
  });

  it("回收事件只作证据：终态只看条目，作者拖回已埋设后不再显示已回收", () => {
    const [state] = deriveForeshadowStates([entry], [
      { chapterNumber: 3, eventType: "hook_planted", subject: "小瓶", subjectEntryId: "entry-bottle", status: "applied" },
      { chapterNumber: 10, eventType: "hook_resolved", subject: "小瓶", subjectEntryId: "entry-bottle", status: "applied" },
    ]);
    expect(state?.phase).toBe("planted");
    expect(state?.payoffChapter).toBeUndefined();
  });

  it("未审核或已驳回的事件不推动阶段", () => {
    const [state] = deriveForeshadowStates([entry], [
      { chapterNumber: 8, eventType: "hook_resolved", subject: "小瓶", subjectEntryId: "entry-bottle", status: "pending" },
      { chapterNumber: 9, eventType: "hook_triggered", subject: "小瓶", subjectEntryId: "entry-bottle", status: "rejected" },
    ]);
    expect(state?.phase).toBe("planted");
    expect(state?.payoffChapter).toBeUndefined();
  });

  it("作者标的已回收 / 已废弃是终态，事件不翻回去", () => {
    const states = deriveForeshadowStates(
      [
        { id: "a", title: "玉佩", fields: { status: "已废弃" } },
        { id: "b", title: "血书", fields: { status: "已回收", payoffChapter: 20 } },
      ],
      [
        { chapterNumber: 30, eventType: "hook_triggered", subject: "玉佩", subjectEntryId: "a" },
        { chapterNumber: 31, eventType: "hook_progressed", subject: "血书", subjectEntryId: "b" },
      ],
    );
    expect(states.map((state) => [state.label, state.phase])).toEqual([["玉佩", "abandoned"], ["血书", "paid_off"]]);
  });

  it("没挂 entryId 的事件按主语找条目；找不到条目的事件不构成伏笔", () => {
    const states = deriveForeshadowStates(
      [entry, { id: "archived", title: "旧线", lifecycle: "archived" }],
      [
        { chapterNumber: 5, eventType: "hook_triggered", subject: "小瓶子", object: "药园试验" },
        { chapterNumber: 6, eventType: "hook_planted", subject: "无主伏笔" },
      ],
      { resolveEntryId: (subject) => (subject === "小瓶子" ? "entry-bottle" : undefined) },
    );
    expect(states).toEqual([
      expect.objectContaining({ entryId: "entry-bottle", phase: "triggered", triggerChapter: 5 }),
    ]);
  });
});
