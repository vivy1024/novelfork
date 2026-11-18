import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChapterOutlineBoard } from "./ChapterOutlineBoard";
import { OutlineOverviewPanel } from "./OutlineOverviewPanel";

const mockPayload = {
  ok: true,
  bookId: "book-p3",
  currentChapter: 2,
  volumes: [
    {
      id: "vol-1",
      title: "第一卷 · 初入雾城",
      chapterRange: { from: 1, to: 10 },
      status: "active",
      goal: "摸清旧港异变源头并站稳脚跟",
    },
  ],
  chapters: [
    { number: 1, title: "雨夜敲钟", status: "done", wordCount: 3100 },
    { number: 2, title: "灰衣来客", status: "done", wordCount: 2800 },
  ],
  scenes: [
    {
      id: "sc-1",
      bookId: "book-p3",
      chapterNumber: 2,
      title: "旧码头接头",
      summary: "林舟与线人在灯塔下核对密信",
      function: "advance",
    },
  ],
  storylines: [
    { id: "line-main", bookId: "book-p3", name: "雾钟真相", kind: "main", lifecycle: "active", status: "active" },
  ],
  mounts: [
    { id: "m-1", sceneId: "sc-1", storylineId: "line-main", role: "primary" },
  ],
  foreshadows: [
    {
      entryId: "fs-1",
      title: "铜钥匙刻痕",
      plantedChapter: 1,
      chaptersSince: 4,
      urgency: "watch",
      status: "planted",
    },
  ],
  foreshadowThresholds: { watchChapters: 3, overdueChapters: 8 },
  entities: [],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ChapterOutlineBoard & OutlineOverviewPanel", () => {
  it("伴随大纲板展示所属卷进度、本章推进节拍与故事推进总览跳转", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(mockPayload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));
    const onOpenStoryCanvas = vi.fn();
    render(
      <ChapterOutlineBoard
        bookId="book-p3"
        chapterNumber={2}
        onOpenStoryCanvas={onOpenStoryCanvas}
      />,
    );

    await waitFor(() => expect(screen.getByText("第一卷 · 初入雾城")).toBeTruthy());
    expect(screen.getByTestId("outline-board-volume").textContent).toContain("20%");
    expect(screen.getByText("旧码头接头")).toBeTruthy();
    expect(screen.getByText("雾钟真相")).toBeTruthy();
    expect(screen.getByText("铜钥匙刻痕")).toBeTruthy();

    fireEvent.click(screen.getByTestId("outline-board-open-overview"));
    expect(onOpenStoryCanvas).toHaveBeenCalledWith("overview");
  });

  it("大纲总览面板按卷点亮已写章与下一章并支持跳转", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(mockPayload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));
    const onOpenChapter = vi.fn();
    const onOpenWriteView = vi.fn();
    render(
      <OutlineOverviewPanel
        bookId="book-p3"
        currentChapter={2}
        onOpenChapter={onOpenChapter}
        onOpenWriteView={onOpenWriteView}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("outline-overview-panel")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /第2章/ }));
    expect(onOpenChapter).toHaveBeenCalledWith(2);

    fireEvent.click(screen.getByRole("button", { name: /第3章/ }));
    expect(onOpenWriteView).toHaveBeenCalledTimes(1);
  });
});
