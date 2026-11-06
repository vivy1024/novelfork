import { describe, expect, it } from "vitest";

import {
  appendRemindedChapter,
  lastRemindedBefore,
  parseChapterRange,
  parseForeshadowLedgerFields,
  REMINDED_HISTORY_LIMIT,
  scoreHookRelevance,
  targetRangeStatus,
} from "./foreshadow-ledger.js";
import { renderDueForeshadowSection, selectDueForeshadows } from "./foreshadow-due.js";
import { selectDormantHooks, type DormantHookInput } from "./foreshadow-phase.js";

describe("伏笔结构化字段解析", () => {
  it("老条目没有新字段：全部为空，不报错", () => {
    expect(parseForeshadowLedgerFields({ status: "已埋设", plantedChapter: 5 })).toEqual({ triggerKeywords: [], remindedChapters: [] });
    expect(parseForeshadowLedgerFields(null)).toEqual({ triggerKeywords: [], remindedChapters: [] });
    expect(parseForeshadowLedgerFields({ triggerKeywords: 42, targetRange: "很久以后", importance: "随便", remindedChapters: "x" }))
      .toEqual({ triggerKeywords: [], remindedChapters: [] });
  });

  it("新字段：区间多种写法、触发词数组或逗号串、分量中英写法", () => {
    expect(parseChapterRange("120-140")).toEqual({ from: 120, to: 140 });
    expect(parseChapterRange("第140到120章")).toEqual({ from: 120, to: 140 });
    expect(parseChapterRange(88)).toEqual({ from: 88, to: 88 });
    expect(parseChapterRange({ from: 3, to: 9 })).toEqual({ from: 3, to: 9 });
    expect(parseChapterRange("1-2-3")).toBeUndefined();
    const ledger = parseForeshadowLedgerFields({
      triggerCondition: " 主角回到青石镇 ",
      triggerKeywords: "青石镇，老槐树、 青石镇",
      targetRange: "120~140",
      payoffConstraint: "玉佩必须在场",
      importance: "高",
      remindedChapters: [40, 10, 40, "25"],
    });
    expect(ledger).toEqual({
      triggerCondition: "主角回到青石镇",
      triggerKeywords: ["青石镇", "老槐树"],
      targetRange: { from: 120, to: 140 },
      payoffConstraint: "玉佩必须在场",
      importance: "high",
      remindedChapters: [10, 25, 40],
    });
  });

  it("旧 targetChapter 字段视作单章区间", () => {
    expect(parseForeshadowLedgerFields({ targetChapter: 50 }).targetRange).toEqual({ from: 50, to: 50 });
    expect(parseForeshadowLedgerFields({ targetChapter: 50, targetRange: "60-70" }).targetRange).toEqual({ from: 60, to: 70 });
  });

  it("提醒历史：只看当前章之前；去重、只留最近几次", () => {
    expect(lastRemindedBefore([10, 20, 30], 30)).toBe(20);
    expect(lastRemindedBefore([10, 20, 30], 5)).toBeUndefined();
    const history = [1, 2, 3, 4, 5, 6];
    expect(appendRemindedChapter(history, 3)).toBe(history);
    expect(appendRemindedChapter(history, 9)).toEqual([2, 3, 4, 5, 6, 9]);
    expect(appendRemindedChapter(history, 9)).toHaveLength(REMINDED_HISTORY_LIMIT);
  });
});

describe("相关度打分", () => {
  const empty = parseForeshadowLedgerFields({});
  const query = { text: "韩立回到青石镇，在老槐树下等人。", entities: ["韩立"] };

  it("触发词命中本章远高于只是休眠很久", () => {
    const relevant = scoreHookRelevance({ ledger: parseForeshadowLedgerFields({ triggerKeywords: ["青石镇"] }), currentChapter: 300, query, textScore: 0, idleChapters: 5 });
    const dormant = scoreHookRelevance({ ledger: empty, currentChapter: 300, query, textScore: 0, idleChapters: 295 });
    expect(relevant.matchedKeywords).toEqual(["青石镇"]);
    expect(relevant.score - dormant.score).toBeGreaterThanOrEqual(20);
    // 休眠项有上限
    expect(dormant.breakdown.dormancy).toBe(10);
  });

  it("区间内与过期加分，过期越久越高（有上限）；分量放大相关度", () => {
    const ledger = parseForeshadowLedgerFields({ targetRange: "100-110" });
    const before = scoreHookRelevance({ ledger, currentChapter: 90, query, textScore: 0 });
    const approaching = scoreHookRelevance({ ledger, currentChapter: 98, query, textScore: 0 });
    const inRange = scoreHookRelevance({ ledger, currentChapter: 105, query, textScore: 0 });
    const overdue = scoreHookRelevance({ ledger, currentChapter: 115, query, textScore: 0 });
    const longOverdue = scoreHookRelevance({ ledger, currentChapter: 300, query, textScore: 0 });
    expect(before.rangeStatus).toBe("future");
    expect(approaching.rangeStatus).toBe("approaching");
    expect(before.score).toBeLessThan(approaching.score);
    expect(approaching.score).toBeLessThan(inRange.score);
    expect(inRange.score).toBeLessThan(overdue.score);
    expect(overdue.score).toBeLessThan(longOverdue.score);
    expect(longOverdue.breakdown.due).toBe(70);

    const high = scoreHookRelevance({ ledger: parseForeshadowLedgerFields({ targetRange: "100-110", importance: "high" }), currentChapter: 105, query, textScore: 0 });
    const low = scoreHookRelevance({ ledger: parseForeshadowLedgerFields({ targetRange: "100-110", importance: "low" }), currentChapter: 105, query, textScore: 0 });
    expect(high.score).toBeGreaterThan(inRange.score);
    expect(low.score).toBeLessThan(inRange.score);
  });

  it("确定性：同输入同输出", () => {
    const input = { ledger: parseForeshadowLedgerFields({ triggerKeywords: ["老槐树"], targetRange: "280-320", importance: "med" }), currentChapter: 300, query, textScore: 8, idleChapters: 40 };
    expect(scoreHookRelevance(input)).toEqual(scoreHookRelevance(input));
  });

  it("区间状态", () => {
    expect(targetRangeStatus(undefined, 10)).toEqual({ status: "none", overdueBy: 0 });
    expect(targetRangeStatus({ from: 10, to: 12 }, 13)).toEqual({ status: "overdue", overdueBy: 1 });
  });
});

describe("本章到期伏笔筛选", () => {
  const entry = (title: string, fields: Record<string, unknown>, phase: "planted" | "paid_off" = "planted") => ({ entryId: title, title, phase, fields });

  it("区间覆盖本章、已过、起点在 2 章内的进；未来、已回收、无区间的不进；按截止章排序", () => {
    const due = selectDueForeshadows([
      entry("远期", { targetRange: "200-220" }),
      entry("区间内", { targetRange: "95-105", payoffConstraint: "必须由师父亲口说出" }),
      entry("已过", { targetRange: "80-90" }),
      entry("快到", { targetRange: "102-110" }),
      entry("已回收", { targetRange: "95-105" }, "paid_off"),
      entry("老条目", { plantedChapter: 3 }),
      entry("旧字段", { targetChapter: 100 }),
    ], 100);
    expect(due.map((hook) => hook.title)).toEqual(["已过", "旧字段", "区间内", "快到"]);
    expect(due.map((hook) => hook.status)).toEqual(["overdue", "in-range", "in-range", "approaching"]);
    const text = renderDueForeshadowSection(due);
    expect(text).toContain("【本章到期伏笔】");
    expect(text).toContain("「已过」预定第 80–90 章回收，已超出 10 章");
    expect(text).toContain("回收要求：必须由师父亲口说出");
    expect(renderDueForeshadowSection([])).toBe("");
  });
});

describe("休眠提醒轮转（纯函数）", () => {
  /** 模拟逐章写作：每章挑 limit 条，挑中的记一次提醒。 */
  function simulate(pool: Array<DormantHookInput & { reminded: number[] }>, from: number, to: number, limit: number): Map<string, number[]> {
    const shown = new Map<string, number[]>(pool.map((hook) => [hook.title, []]));
    for (let chapter = from; chapter <= to; chapter += 1) {
      const inputs = pool.map((hook) => {
        const last = hook.reminded.filter((value) => value < chapter).at(-1);
        return { ...hook, ...(last !== undefined ? { lastRemindedChapter: last } : {}) };
      });
      for (const picked of selectDormantHooks(inputs, chapter, { limit })) {
        shown.get(picked.title)!.push(chapter);
        pool.find((hook) => hook.title === picked.title)!.reminded.push(chapter);
      }
    }
    return shown;
  }

  it("30 条同分量的休眠伏笔、每章 3 条：60 章里每条都被提醒，次数均匀，间隔约 10 章", () => {
    const pool = Array.from({ length: 30 }, (_, index) => ({ title: `线${String(index).padStart(2, "0")}`, status: "已埋设", setupChapter: 1 + index, reminded: [] as number[] }));
    const shown = simulate(pool, 100, 159, 3);
    const counts = [...shown.values()].map((chapters) => chapters.length);
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(5);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    for (const chapters of shown.values()) {
      for (let index = 1; index < chapters.length; index += 1) {
        expect(chapters[index]! - chapters[index - 1]!).toBeGreaterThanOrEqual(9);
      }
    }
  });

  it("高分量的提醒更勤，但低分量的也不会永远轮不到", () => {
    const pool = [
      ...Array.from({ length: 10 }, (_, index) => ({ title: `高${index}`, status: "已埋设", setupChapter: 5, hookImportance: "high" as const, reminded: [] as number[] })),
      ...Array.from({ length: 10 }, (_, index) => ({ title: `低${index}`, status: "已埋设", setupChapter: 5, hookImportance: "low" as const, reminded: [] as number[] })),
    ];
    const shown = simulate(pool, 100, 199, 2);
    const total = (prefix: string) => [...shown.entries()].filter(([title]) => title.startsWith(prefix)).reduce((sum, [, chapters]) => sum + chapters.length, 0);
    expect(total("高")).toBeGreaterThan(total("低"));
    for (const [title, chapters] of shown) {
      if (title.startsWith("低")) expect(chapters.length).toBeGreaterThan(0);
    }
  });

  it("同一章重复召回结果不变（本章的提醒记录不参与本章挑选）", () => {
    const pool = Array.from({ length: 5 }, (_, index) => ({ title: `线${index}`, status: "已埋设", setupChapter: 1 + index }));
    const first = selectDormantHooks(pool, 100, { limit: 2 });
    const recorded = pool.map((hook) => (first.some((picked) => picked.title === hook.title) ? { ...hook, lastRemindedChapter: lastRemindedBefore([100], 100) } : hook));
    expect(selectDormantHooks(recorded, 100, { limit: 2 }).map((hook) => hook.title)).toEqual(first.map((hook) => hook.title));
  });
});
