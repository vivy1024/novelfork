import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  StoryMapCanvas,
  buildStoryMapPlanPrompt,
  computeMissingPlanningKinds,
  snapshotToPlotBoard,
} from "./StoryMapCanvas";
import type { NarrativeLineSnapshot } from "../../handlers/narrative-line-types";

const mockSnapshot: NarrativeLineSnapshot = {
  bookId: "book-1",
  nodes: [
    {
      id: "node-chap-1",
      bookId: "book-1",
      type: "chapter",
      title: "第一章 灵潮初起",
      summary: "天地异变，少年执剑启程。",
      chapterNumber: 1,
      status: "completed",
    },
    {
      id: "node-arc-1",
      bookId: "book-1",
      type: "character-arc",
      title: "沈舟：心境觉醒",
      summary: "从迷惘走向坚定。",
      chapterNumber: 2,
    },
    {
      id: "node-conflict-1",
      bookId: "book-1",
      type: "conflict",
      title: "黑水宗逼压",
      summary: "外门长老突袭引发宗门危机。",
      chapterNumber: 3,
    },
    {
      id: "node-foreshadow-1",
      bookId: "book-1",
      type: "foreshadow",
      title: "青铜残片异动",
      summary: "残片中隐现古神低语。",
      chapterNumber: 4,
    },
  ],
  edges: [
    {
      id: "edge-1",
      bookId: "book-1",
      fromNodeId: "node-chap-1",
      toNodeId: "node-arc-1",
      type: "causes",
      confidence: "explicit",
    },
    {
      id: "edge-2",
      bookId: "book-1",
      fromNodeId: "node-arc-1",
      toNodeId: "node-conflict-1",
      type: "escalates",
      confidence: "explicit",
    },
    {
      id: "edge-invalid",
      bookId: "book-1",
      fromNodeId: "node-conflict-1",
      toNodeId: "node-non-exist",
      type: "supports",
      confidence: "inferred",
    },
  ],
  warnings: [],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("snapshotToPlotBoard 章×线索情节板", () => {
  it("章做列、线索做行，不把混类型边画进去", () => {
    const board = snapshotToPlotBoard(mockSnapshot);
    expect(board.chapters.map((chapter) => chapter.chapterNumber)).toEqual([1, 2, 3, 4]);
    expect(board.threads.map((thread) => thread.kind).sort()).toEqual(["character_arc", "conflict", "foreshadow"]);
    expect(board.threads.find((thread) => thread.kind === "conflict")?.beatsByChapter[3]?.[0]?.title).toBe("黑水宗逼压");
    expect(board.threads.find((thread) => thread.kind === "foreshadow")?.beatsByChapter[4]?.[0]?.title).toBe("青铜残片异动");
  });

  it("空快照返回空板", () => {
    expect(snapshotToPlotBoard(null)).toEqual({ chapters: [], threads: [] });
    expect(snapshotToPlotBoard({ bookId: "b", nodes: [], edges: [], warnings: [] })).toEqual({ chapters: [], threads: [] });
  });
});

describe("StoryMapCanvas 画布渲染与交互", () => {
  it("使用 runtimeFetch 成功加载快照并渲染节点、触发跳转与提拔回调", async () => {
    const runtimeFetch = vi.fn(async () => ({ snapshot: mockSnapshot }));
    const onOpenChapter = vi.fn();
    const onPromote = vi.fn();

    render(
      <StoryMapCanvas
        bookId="book-1"
        runtimeFetch={runtimeFetch}
        onOpenChapter={onOpenChapter}
        onPromote={onPromote}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("story-map-board")).toBeTruthy();
    });

    expect(runtimeFetch).toHaveBeenCalledWith(
      "/api/books/book-1/narrative-line",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(screen.getByTestId("story-map-node-node-arc-1")).toBeTruthy();
    expect(screen.getByTestId("story-map-node-node-conflict-1")).toBeTruthy();
    expect(screen.queryByTestId("story-map-node-node-chap-1")).toBeNull();

    const jumpBtn = screen.getByTestId("jump-btn-node-chap-1");
    fireEvent.click(jumpBtn);
    expect(onOpenChapter).toHaveBeenCalledWith(1);

    const promoteBtn = screen.getByTestId("promote-btn-node-arc-1");
    fireEvent.click(promoteBtn);
    expect(onPromote).toHaveBeenCalledWith(expect.objectContaining({ id: "node-arc-1", title: "沈舟：心境觉醒" }));
  });

  it("切书时中止旧请求，旧书响应不能覆盖新书", async () => {
    const pending = new Map<string, { resolve: (value: unknown) => void; signal?: AbortSignal }>();
    const runtimeFetch = vi.fn((url: string, init?: RequestInit) => new Promise((resolve) => {
      pending.set(url, { resolve, signal: init?.signal });
    }));
    const { rerender } = render(<StoryMapCanvas bookId="book-1" runtimeFetch={runtimeFetch} />);

    await waitFor(() => {
      expect(runtimeFetch).toHaveBeenCalledWith(
        "/api/books/book-1/narrative-line",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    rerender(<StoryMapCanvas bookId="book-2" runtimeFetch={runtimeFetch} />);
    await waitFor(() => {
      expect(runtimeFetch).toHaveBeenCalledWith(
        "/api/books/book-2/narrative-line",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    const oldRequest = pending.get("/api/books/book-1/narrative-line");
    const newRequest = pending.get("/api/books/book-2/narrative-line");
    expect(oldRequest?.signal?.aborted).toBe(true);
    expect(newRequest?.signal?.aborted).toBe(false);

    oldRequest?.resolve({
      snapshot: {
        bookId: "book-1",
        nodes: [{ id: "old-book-node", bookId: "book-1", type: "conflict", title: "旧书节点" }],
        edges: [],
        warnings: [],
      },
    });
    newRequest?.resolve({
      snapshot: {
        bookId: "book-2",
        nodes: [{ id: "new-book-node", bookId: "book-2", type: "conflict", title: "新书节点" }],
        edges: [],
        warnings: [],
      },
    });

    await waitFor(() => expect(screen.getByTestId("story-map-node-new-book-node")).toBeTruthy());
    expect(screen.queryByTestId("story-map-node-old-book-node")).toBeNull();
  });

  it("空数据时显示空状态提示", async () => {
    const runtimeFetch = vi.fn(async () => ({ snapshot: { bookId: "book-1", nodes: [], edges: [], warnings: [] } }));

    render(<StoryMapCanvas bookId="book-1" runtimeFetch={runtimeFetch} />);

    await waitFor(() => {
      expect(screen.getByTestId("story-map-empty")).toBeTruthy();
    });
    expect(screen.getByText("暂无故事主支线数据")).toBeTruthy();
  });

  it("只有章节节点时显示规划空态，点「发起主支线梳理」把意图交给叙述者", async () => {
    const runtimeFetch = vi.fn(async () => ({
      snapshot: {
        bookId: "book-1",
        nodes: [
          {
            id: "node-chap-1",
            bookId: "book-1",
            type: "chapter",
            title: "第一章 灵潮初起",
            summary: "天地异变，少年执剑启程。",
            chapterNumber: 1,
            status: "completed",
          },
        ],
        edges: [],
        warnings: [],
      },
    }));
    const onSendToNarrator = vi.fn(async () => undefined);

    render(<StoryMapCanvas bookId="book-1" runtimeFetch={runtimeFetch} onSendToNarrator={onSendToNarrator} />);

    await waitFor(() => {
      expect(screen.getByTestId("story-map-empty-planning")).toBeTruthy();
    });

    const startBtn = screen.getByTestId("story-map-start-planning");
    fireEvent.click(startBtn);
    await waitFor(() => {
      expect(onSendToNarrator).toHaveBeenCalledTimes(1);
    });
    const message = onSendToNarrator.mock.calls[0][0] as string;
    expect(message).toContain("book.dissect(apply=true)");
    expect(message).toContain("arc.character(action=sync)");
  });

  it("未注入 onSendToNarrator 时规划空态不显示发起按钮", async () => {
    const runtimeFetch = vi.fn(async () => ({
      snapshot: {
        bookId: "book-1",
        nodes: [
          {
            id: "node-chap-1",
            bookId: "book-1",
            type: "chapter",
            title: "第一章 灵潮初起",
            summary: "天地异变，少年执剑启程。",
            chapterNumber: 1,
            status: "completed",
          },
        ],
        edges: [],
        warnings: [],
      },
    }));

    render(<StoryMapCanvas bookId="book-1" runtimeFetch={runtimeFetch} />);

    await waitFor(() => {
      expect(screen.getByTestId("story-map-empty-planning")).toBeTruthy();
    });
    expect(screen.queryByTestId("story-map-start-planning")).toBeNull();
  });

  it("buildStoryMapPlanPrompt 生成的编排指令指向真实工具", () => {
    const message = buildStoryMapPlanPrompt(3);
    expect(message).toContain("3 个章节节点");
    expect(message).toContain("book.dissect");
    expect(message).toContain("arc.character");
    expect(message).toContain("lore.write");
    // 关键纪律：不能再出现「规划叙事线」这种指向不存在工具的文案
    expect(message).not.toContain("规划叙事线");
  });

  it("buildStoryMapPlanPrompt 按缺失类别裁剪：只缺冲突时不拆正文不抽弧线", () => {
    const message = buildStoryMapPlanPrompt(5, ["冲突"]);
    expect(message).toContain("缺这些规划节点：冲突");
    expect(message).toContain("lore.write");
    expect(message).not.toContain("book.dissect");
    expect(message).not.toContain("arc.character");
  });

  it("computeMissingPlanningKinds：空快照四类全缺，齐泳道快照不重复拆解", () => {
    expect(computeMissingPlanningKinds(null)).toEqual(["冲突", "角色弧线", "设定", "伏笔"]);
    // mock 快照只有 conflict / character-arc / foreshadow 节点，缺 setting。
    expect(computeMissingPlanningKinds(mockSnapshot)).toEqual(["设定"]);
    expect(computeMissingPlanningKinds({ bookId: "b", nodes: [{ id: "c", bookId: "b", type: "conflict", title: "x" }], edges: [], warnings: [] }))
      .toEqual(["角色弧线", "设定", "伏笔"]);
  });

  it("加载失败时显示错误态和重试按钮", async () => {
    const runtimeFetch = vi.fn(async () => {
      throw new Error("网络超时");
    });

    render(<StoryMapCanvas bookId="book-1" runtimeFetch={runtimeFetch} />);

    await waitFor(() => {
      expect(screen.getByTestId("story-map-error")).toBeTruthy();
    });
    expect(screen.getByText("网络超时")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
  });
});
