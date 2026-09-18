import { describe, expect, it } from "vitest";

import {
  buildCharacterLanes,
  buildForeshadowDebts,
  buildNextChapterFocus,
  buildStoryProgressBoard,
  cellsForChapter,
  DEBT_OVERDUE_CHAPTERS,
  hasProgressContent,
  resolveDebtStatus,
  STALLED_LANE_GAP,
  trimTitle,
  type ProgressJingweiEntry,
  type ProgressMemoryEvent,
} from "./story-progress-board";

function entry(overrides: Partial<ProgressJingweiEntry> & { id: string }): ProgressJingweiEntry {
  return { category: "foreshadowing", lifecycle: "active", ...overrides };
}

describe("resolveDebtStatus 伏笔状态解析", () => {
  it("识别白名单枚举值", () => {
    expect(resolveDebtStatus(entry({ id: "a", fields: { status: "paid_off" } }))).toBe("paid_off");
    expect(resolveDebtStatus(entry({ id: "b", fields: { status: "planted" } }))).toBe("planted");
    expect(resolveDebtStatus(entry({ id: "c", fields: { status: "triggered" } }))).toBe("triggered");
  });

  it("脏 status（整句话被写进字段）不当成有效状态，回落到章号推断", () => {
    // 实测该书真有一条把整段说明写进 fields.status
    const dirty = entry({
      id: "dirty",
      fields: { status: "已进入法定异议流程（ERR-202710-042，纸面两联归档+经办人执存）", plantedChapter: 1 },
    });
    expect(resolveDebtStatus(dirty)).toBe("planted");
  });

  it("无 status 时按 payoffChapter 推断已回收", () => {
    expect(resolveDebtStatus(entry({ id: "c", fields: { plantedChapter: 3, payoffChapter: 9 } }))).toBe("paid_off");
  });

  it("完全没有线索时记 unknown，不猜", () => {
    expect(resolveDebtStatus(entry({ id: "d", fields: {} }))).toBe("unknown");
    expect(resolveDebtStatus(entry({ id: "e" }))).toBe("unknown");
  });
});

describe("buildForeshadowDebts 伏笔债务", () => {
  it("按悬置章数计算龄期并排序：超期最久在最前", () => {
    const debts = buildForeshadowDebts([
      entry({ id: "fresh", title: "近期埋点", fields: { status: "planted", plantedChapter: 28 } }),
      entry({ id: "old", title: "远古旧账", fields: { status: "planted", plantedChapter: 1 } }),
      entry({ id: "done", title: "已收", fields: { status: "paid_off", plantedChapter: 5, payoffChapter: 6 } }),
    ], 29);

    expect(debts.map((debt) => debt.entryId)).toEqual(["old", "fresh", "done"]);
    expect(debts[0]!.chaptersPending).toBe(28);
    expect(debts[0]!.urgency).toBe("overdue");
    expect(debts[0]!.reason).toContain("已悬 28 章未回收");
    // 已回收不产生悬置章数
    expect(debts[2]!.chaptersPending).toBeUndefined();
    expect(debts[2]!.urgency).toBe("ok");
  });

  it("triggered 伏笔视为必须处理的债", () => {
    const debts = buildForeshadowDebts([
      entry({ id: "armed", title: "小瓶", fields: { status: "triggered", plantedChapter: 8 } }),
    ], 12);
    expect(debts[0]!.status).toBe("triggered");
    expect(debts[0]!.urgency).toBe("overdue");
    expect(debts[0]!.reason).toContain("尚未兑现");
  });

  it("archived / retired 生命周期视为已放弃，不计入债务", () => {
    const debts = buildForeshadowDebts([
      entry({ id: "gone", lifecycle: "archived", fields: { status: "planted", plantedChapter: 2 } }),
      entry({ id: "retired", lifecycle: "retired", fields: { status: "planted", plantedChapter: 2 } }),
      entry({ id: "live", fields: { status: "planted", plantedChapter: 2 } }),
    ], 20);
    expect(debts.map((debt) => debt.entryId)).toEqual(["live"]);
  });

  it("章号缺失时从标题「第N章」回退", () => {
    const debts = buildForeshadowDebts([
      entry({ id: "t", title: "指向第 13 章 B 座地下二层的筛查", fields: { status: "planted" } }),
    ], 29);
    expect(debts[0]!.plantedChapter).toBe(13);
    expect(debts[0]!.chaptersPending).toBe(16);
  });

  it("unknown 状态如实说明未标注，而不是伪造已回收", () => {
    const debts = buildForeshadowDebts([entry({ id: "u", title: "待处理伏笔" })], 29);
    expect(debts[0]!.status).toBe("unknown");
    expect(debts[0]!.reason).toContain("状态未标注");
  });

  it("超期阈值边界：达到 DEBT_OVERDUE_CHAPTERS 即判 overdue", () => {
    const debts = buildForeshadowDebts([
      entry({ id: "edge", fields: { status: "planted", plantedChapter: 1 } }),
    ], 1 + DEBT_OVERDUE_CHAPTERS);
    expect(debts[0]!.urgency).toBe("overdue");
  });
});

describe("buildCharacterLanes 角色泳道", () => {
  const events: ProgressMemoryEvent[] = [
    { chapterNumber: 1, eventType: "character_state_changed", subject: "薛行之", evidenceText: "接手异常波形" },
    { chapterNumber: 5, eventType: "character_state_changed", subject: "薛行之", evidenceText: "收到匿名警告" },
    { chapterNumber: 3, eventType: "relationship_changed", subject: "方工", evidenceText: "开始试探" },
    { chapterNumber: 9, eventType: "world_fact", subject: "灵科院", evidenceText: "不该进角色泳道" },
  ];

  it("只收角色状态/关系变化事件，按出场频次排序", () => {
    const { lanes } = buildCharacterLanes(events, 10, 4);
    expect(lanes.map((lane) => lane.title)).toEqual(["薛行之", "方工"]);
    expect(cellsForChapter(lanes[0]!, 5)).toHaveLength(1);
  });

  it("超过上限的角色折叠计数，避免又叠成墙", () => {
    const many: ProgressMemoryEvent[] = ["甲", "乙", "丙", "丁", "戊"].map((name, index) => ({
      chapterNumber: index + 1,
      eventType: "character_state_changed",
      subject: name,
    }));
    const { lanes, collapsed } = buildCharacterLanes(many, 5, 2);
    expect(lanes).toHaveLength(2);
    expect(collapsed).toBe(3);
  });

  it("断档判定：距今超过 STALLED_LANE_GAP 章没推进算停滞", () => {
    const { lanes } = buildCharacterLanes(
      [{ chapterNumber: 2, eventType: "character_state_changed", subject: "甲" }],
      2 + STALLED_LANE_GAP,
      4,
    );
    expect(lanes[0]!.chaptersSinceLastBeat).toBe(STALLED_LANE_GAP);
    expect(lanes[0]!.stalled).toBe(true);
  });
});

describe("buildStoryProgressBoard 总装配", () => {
  const chapterSummaries: ProgressJingweiEntry[] = [
    { id: "s1", category: "chapter-summaries", title: "第 1 章 归档", fields: { chapterNumber: 1, tension_score: 5 } },
    { id: "s2", category: "chapter-summaries", title: "第 2 章 追查", fields: { chapterNumber: 2, tension_score: -1 } },
  ];

  it("章节轴含未来列，并标出 future", () => {
    const board = buildStoryProgressBoard({ chapterSummaries, currentChapter: 2 });
    expect(board.currentChapter).toBe(2);
    const future = board.chapters.filter((column) => column.future);
    expect(future.length).toBeGreaterThan(0);
    expect(future.every((column) => column.chapterNumber > 2)).toBe(true);
  });

  it("张力负值是哨兵（评过但失败），不当成有效分数", () => {
    const board = buildStoryProgressBoard({ chapterSummaries, currentChapter: 2 });
    expect(board.chapters.find((column) => column.chapterNumber === 1)?.tensionScore).toBe(5);
    expect(board.chapters.find((column) => column.chapterNumber === 2)?.tensionScore).toBeUndefined();
  });

  it("焦点列指向下一章，并带上该收的债与断档线", () => {
    const board = buildStoryProgressBoard({
      chapterSummaries,
      foreshadowEntries: [entry({ id: "debt1", title: "旧账", fields: { status: "planted", plantedChapter: 1 } })],
      events: [{ chapterNumber: 1, eventType: "character_state_changed", subject: "薛行之" }],
      currentChapter: 20,
    });
    expect(board.focus?.chapterNumber).toBe(21);
    expect(board.focus?.dueDebts.map((debt) => debt.entryId)).toContain("debt1");
    expect(board.focus?.involvedCharacters).toContain("薛行之");
  });

  it("未回收伏笔进网格泳道，已回收的不占格子", () => {
    const board = buildStoryProgressBoard({
      chapterSummaries,
      foreshadowEntries: [
        entry({ id: "open", title: "未收", fields: { status: "planted", plantedChapter: 1 } }),
        entry({ id: "closed", title: "已收", fields: { status: "paid_off", plantedChapter: 1, payoffChapter: 2 } }),
      ],
      currentChapter: 10,
    });
    const lane = board.lanes.find((candidate) => candidate.kind === "foreshadow");
    expect(lane).toBeDefined();
    const cells = cellsForChapter(lane!, 1);
    expect(cells.map((cell) => cell.entryId)).toEqual(["open"]);
  });

  it("currentChapter 缺省时从数据推断最大章号", () => {
    const board = buildStoryProgressBoard({
      events: [{ chapterNumber: 29, eventType: "character_state_changed", subject: "甲" }],
    });
    expect(board.currentChapter).toBe(29);
  });

  it("完全没有数据时不报错，且判为无内容（交给空态分流）", () => {
    const board = buildStoryProgressBoard({});
    expect(board.chapters).toEqual([]);
    expect(board.focus).toBeNull();
    expect(hasProgressContent(board)).toBe(false);
  });

  it("有章节且有节拍时判为有内容", () => {
    const board = buildStoryProgressBoard({ chapterSummaries, currentChapter: 2 });
    expect(hasProgressContent(board)).toBe(true);
  });
});

describe("buildNextChapterFocus", () => {
  it("当前章为 0（还没开写）时没有焦点列", () => {
    expect(buildNextChapterFocus(0, [], [])).toBeNull();
  });
});

describe("trimTitle", () => {
  it("截断超长标题，为 hover 全文留出口", () => {
    const long = "两年前，他背负着十五万债务，在昏暗的工位上一条八分钱敲击着别人的死亡";
    expect(trimTitle(long, 10)).toHaveLength(10);
    expect(trimTitle(long, 10).endsWith("…")).toBe(true);
  });

  it("空值给出占位而不是空字符串", () => {
    expect(trimTitle(undefined)).toBe("未命名");
    expect(trimTitle("   ")).toBe("未命名");
  });
});

describe("真剧情线与场景看板装配 (任务 3 验收)", () => {
  it("有真剧情线时：真剧情线排在最上方，场景正确挂载到对应线与章，断档计算准确", () => {
    const storylines = [
      {
        id: "line-main",
        bookId: "b1",
        name: "主线：复仇之路",
        kind: "main" as const,
        lifecycle: "active" as const,
        goal: "重振宗门",
        layer: "canon" as const,
        status: "confirmed" as const,
        source: "manual" as const,
        confidence: 1,
        createdAt: 1000,
        updatedAt: 1000,
      },
      {
        id: "line-romance",
        bookId: "b1",
        name: "感情线：与苏晚",
        kind: "romance" as const,
        lifecycle: "active" as const,
        goal: "化解误会",
        layer: "canon" as const,
        status: "confirmed" as const,
        source: "manual" as const,
        confidence: 1,
        createdAt: 1001,
        updatedAt: 1001,
      },
    ];

    const scenes = [
      {
        id: "scene-1",
        bookId: "b1",
        chapterNumber: 1,
        ordinal: 1,
        title: "宗门夜变",
        summary: "师尊被害",
        function: "climax" as const,
        wordCount: 2000,
        conflict: "",
        mood: "",
        outcome: "",
        characters: [],
        hooksUsed: [],
        hooksPlanted: [],
        layer: "canon" as const,
        status: "confirmed" as const,
        source: "manual" as const,
        confidence: 1,
        createdAt: 1000,
        updatedAt: 1000,
      },
      {
        id: "scene-2",
        bookId: "b1",
        chapterNumber: 2,
        ordinal: 1,
        title: "药园初遇",
        summary: "苏晚赠药",
        function: "relationship" as const,
        wordCount: 1500,
        conflict: "",
        mood: "",
        outcome: "",
        characters: [],
        hooksUsed: [],
        hooksPlanted: [],
        layer: "canon" as const,
        status: "confirmed" as const,
        source: "manual" as const,
        confidence: 1,
        createdAt: 1000,
        updatedAt: 1000,
      },
      {
        id: "scene-3",
        bookId: "b1",
        chapterNumber: 5,
        ordinal: 1,
        title: "青云试炼",
        summary: "击溃仇敌先锋",
        function: "advance" as const,
        wordCount: 3000,
        conflict: "",
        mood: "",
        outcome: "",
        characters: [],
        hooksUsed: [],
        hooksPlanted: [],
        layer: "canon" as const,
        status: "confirmed" as const,
        source: "manual" as const,
        confidence: 1,
        createdAt: 1000,
        updatedAt: 1000,
      },
    ];

    const mounts = [
      { sceneId: "scene-1", storylineId: "line-main", role: "primary" as const, createdAt: 1000 },
      { sceneId: "scene-3", storylineId: "line-main", role: "primary" as const, createdAt: 1000 },
      { sceneId: "scene-2", storylineId: "line-romance", role: "primary" as const, createdAt: 1000 },
    ];

    // 当前写到第 6 章
    const board = buildStoryProgressBoard({
      storylines,
      scenes,
      mounts,
      currentChapter: 6,
    });

    expect(board.hasRealStorylines).toBe(true);
    expect(board.explanation).toBeUndefined();

    // 检查真剧情线是否排在最前
    const mainLane = board.lanes.find((l) => l.id === "line-main");
    expect(mainLane).toBeDefined();
    expect(mainLane!.source).toBe("storyline");
    expect(mainLane!.title).toContain("主线：复仇之路");
    // 第 1 章与第 5 章有场景
    expect(mainLane!.cellsByChapter[1]).toHaveLength(1);
    expect(mainLane!.cellsByChapter[1][0].title).toBe("宗门夜变");
    expect(mainLane!.cellsByChapter[5]).toHaveLength(1);
    expect(mainLane!.cellsByChapter[5][0].title).toBe("青云试炼");
    // 距今 (6 - 5) = 1 章没推进，未达到断档阈值 3
    expect(mainLane!.chaptersSinceLastBeat).toBe(1);
    expect(mainLane!.stalled).toBe(false);

    // 检查感情线
    const romanceLane = board.lanes.find((l) => l.id === "line-romance");
    expect(romanceLane).toBeDefined();
    expect(romanceLane!.source).toBe("storyline");
    expect(romanceLane!.cellsByChapter[2]).toHaveLength(1);
    expect(romanceLane!.cellsByChapter[2][0].title).toBe("药园初遇");
    // 感情线最后停在第 2 章，当前第 6 章：(6 - 2) = 4 >= STALLED_LANE_GAP (3) → 判定断档
    expect(romanceLane!.chaptersSinceLastBeat).toBe(4);
    expect(romanceLane!.stalled).toBe(true);

    // 焦点列中能检测到感情线停滞
    expect(board.focus?.stalledLanes.some((l) => l.id === "line-romance")).toBe(true);
  });

  it("老书一条真剧情线都没有时：优雅退回 4 类派生行，带三段式规范 explanation 引导", () => {
    const board = buildStoryProgressBoard({
      chapterSummaries: [
        { id: "sum-1", title: "第一章", fields: { chapterNumber: 1 } },
        { id: "sum-2", title: "第二章", fields: { chapterNumber: 2 } },
      ],
      currentChapter: 2,
    });

    expect(board.hasRealStorylines).toBe(false);
    expect(board.explanation).toBeDefined();
    expect(board.explanation!.title).toBe("当前显示自动推导泳道");
    expect(board.explanation!.what).toContain("本书尚未建立结构化剧情线");
    expect(board.explanation!.why).toContain("正式剧情线可跨越多章挂载具体场景");
    expect(board.explanation!.action).toContain("创建第一条正式剧情线");

    // 所有的行均为派生
    expect(board.lanes.every((l) => l.source === "derived")).toBe(true);
  });
});
