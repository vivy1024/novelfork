import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NarrativeLineSnapshot } from "../../handlers/narrative-line-types";
import { hasPlanningNodes, snapshotToPlotBoard } from "./story-map-board";

// ---------------------------------------------------------------------------
// hasPlanningNodes —— 故事地图空态纪律的纯函数判定
// ---------------------------------------------------------------------------

function snapshotOf(types: Array<string>): NarrativeLineSnapshot {
  return {
    nodes: types.map((type, index) => ({
      id: `n-${index}`,
      title: `节点 ${index}`,
      type,
    })),
  } as unknown as NarrativeLineSnapshot;
}

describe("hasPlanningNodes", () => {
  it("纯章节快照没有规划节点", () => {
    expect(hasPlanningNodes(snapshotOf(["chapter", "chapter", "event"]))).toBe(false);
  });

  it("含冲突 / 伏笔 / 角色支线等规划节点时返回 true", () => {
    expect(hasPlanningNodes(snapshotOf(["chapter", "conflict"]))).toBe(true);
    expect(hasPlanningNodes(snapshotOf(["foreshadow"]))).toBe(true);
    expect(hasPlanningNodes(snapshotOf(["character-arc"]))).toBe(true);
    expect(hasPlanningNodes(snapshotOf(["payoff"]))).toBe(true);
    expect(hasPlanningNodes(snapshotOf(["setting"]))).toBe(true);
  });

  it("空快照与非法输入诚实返回 false", () => {
    expect(hasPlanningNodes(null)).toBe(false);
    expect(hasPlanningNodes(undefined)).toBe(false);
    expect(hasPlanningNodes({ nodes: [] } as unknown as NarrativeLineSnapshot)).toBe(false);
  });
});

describe("snapshotToPlotBoard", () => {
  it("把派生伏笔和角色弧按章入格，作者备注不覆盖派生线索", () => {
    const board = snapshotToPlotBoard({
      bookId: "b",
      nodes: [
        { id: "c1", bookId: "b", type: "chapter", title: "第一章", chapterNumber: 1, layer: "derived" },
        { id: "foreshadow:small-bottle", bookId: "b", type: "foreshadow", title: "小瓶来历", chapterNumber: 1, status: "open", layer: "derived" },
        { id: "character-arc:han-li", bookId: "b", type: "character-arc", title: "韩立 · 人物弧光", chapterNumber: 1, layer: "derived" },
        { id: "note-1", bookId: "b", type: "event", title: "作者备注", layer: "annotation" },
      ],
      edges: [],
      foreshadowThreads: [{
        id: "foreshadow:small-bottle",
        bookId: "b",
        title: "小瓶来历",
        status: "open",
        setupNodeIds: ["foreshadow:small-bottle"],
      }],
      warnings: [],
    });
    expect(board.threads.map((thread) => thread.kind).sort()).toEqual(["character_arc", "foreshadow"]);
    expect(board.threads.find((thread) => thread.kind === "foreshadow")?.beatsByChapter[1]?.[0]?.title).toBe("小瓶来历");
  });

  it("冲突线程按章入格，不产出 DAG 边", () => {
    const board = snapshotToPlotBoard({
      bookId: "b",
      nodes: [
        { id: "c1", bookId: "b", type: "chapter", title: "第一章", chapterNumber: 1 },
        { id: "cf1", bookId: "b", type: "conflict", title: "通道争夺", chapterNumber: 1, summary: "正方守通道" },
      ],
      edges: [{ id: "e1", bookId: "b", fromNodeId: "c1", toNodeId: "cf1", type: "causes", confidence: "explicit" }],
      conflictThreads: [{ id: "thread-1", bookId: "b", title: "通道争夺", status: "escalating", nodeIds: ["cf1"] }],
      warnings: [],
    });
    expect(board.chapters).toHaveLength(1);
    expect(board.threads).toHaveLength(1);
    expect(board.threads[0]!.beatsByChapter[1]?.[0]?.title).toBe("通道争夺");
  });
});
