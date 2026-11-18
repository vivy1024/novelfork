import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChapterDirectorySidebar } from "./ChapterDirectorySidebar";
import type { WorkbenchResourceNode } from "./useWorkbenchResources";

const makeChapter = (num: number, title: string, wordCount?: number): WorkbenchResourceNode => ({
  id: `file:chapters/${String(num).padStart(4, "0")}_${title}.md`,
  kind: "chapter",
  title: `${String(num).padStart(4, "0")}_${title}.md`,
  capabilities: { open: true, readonly: false, unsupported: false, edit: true, delete: true, apply: false },
  metadata: {
    isChapter: true,
    isFile: true,
    chapterNumber: num,
    filePath: `chapters/${String(num).padStart(4, "0")}_${title}.md`,
    ...(typeof wordCount === "number" ? { wordCount } : {}),
  },
});

const makeNote = (name: string): WorkbenchResourceNode => ({
  id: `file:chapters/${name}`,
  kind: "file",
  title: name,
  capabilities: { open: true, readonly: false, unsupported: false, edit: true, delete: true, apply: false },
  metadata: { isFile: true, isChapterNote: true, filePath: `chapters/${name}` },
});

describe("ChapterDirectorySidebar", () => {
  afterEach(() => {
    cleanup();
  });

  it("按卷分组展示真实字数、区分已审与未审章节，不乱贴净标", () => {
    render(
      <ChapterDirectorySidebar
        chapterNodes={[makeChapter(1, "雨夜起笔"), makeChapter(2, "青梅入城", 3200)]}
        volumes={[{ id: "v1", title: "第一卷 · 雾起", from: 1, to: 10 }]}
        chapterWordCounts={{ 1: 2850, 2: 3200 }}
        chapterWordTarget={3000}
        chapterAuditSummary={{
          1: { issueCount: 0, criticalCount: 0, stale: false },
        }}
        onOpenChapter={vi.fn()}
      />,
    );

    expect(screen.getByText("已写 2 章 · 目标 3000 字/章")).toBeTruthy();
    expect(screen.getByText("2/10 章")).toBeTruthy();
    expect(screen.getByText("2,850 / 3,000 字")).toBeTruthy();
    expect(screen.getByText("3,200 / 3,000 字")).toBeTruthy();
    // 第1章已审通过显示「已审」，第2章未审不显示「净」或「已审」
    expect(screen.getAllByText("已审")).toHaveLength(1);
    expect(screen.queryByText("净")).toBeNull();
  });

  it("支持「有红标」筛选、大纲待写章跳转、独立附注区与单行底层工程文件", () => {
    const onOpenPlanned = vi.fn();
    const onOpenNote = vi.fn();

    render(
      <ChapterDirectorySidebar
        chapterNodes={[makeChapter(1, "雨夜起笔", 2500), makeChapter(2, "青梅入城", 2600)]}
        noteNodes={[makeNote("作者说_开书感言.md")]}
        volumes={[{ id: "v1", title: "第一卷", from: 1, to: 5 }]}
        plannedChapters={[
          { chapterNumber: 2, title: "青梅入城", summary: "已写完应被过滤" },
          { chapterNumber: 3, title: "旧港暗流", summary: "主角潜入黑市查账" },
        ]}
        chapterAuditSummary={{
          2: { issueCount: 2, criticalCount: 1, stale: false },
        }}
        onOpenChapter={vi.fn()}
        onOpenNote={onOpenNote}
        onOpenPlannedChapter={onOpenPlanned}
        rawFilesSlot={<div data-testid="mock-raw-files">chapters/</div>}
      />,
    );

    // 待写第3章可见，已写第2章不重复出现在待写栏
    const plannedBtn = screen.getByTestId("planned-chapter-card-3");
    expect(plannedBtn.textContent).toContain("旧港暗流");
    expect(screen.queryByTestId("planned-chapter-card-2")).toBeNull();
    fireEvent.click(plannedBtn);
    expect(onOpenPlanned).toHaveBeenCalledWith(expect.objectContaining({ chapterNumber: 3, title: "旧港暗流" }));

    // 附注区独立展示并可点击
    const noteBtn = screen.getByTestId("note-card-file:chapters/作者说_开书感言.md");
    fireEvent.click(noteBtn);
    expect(onOpenNote).toHaveBeenCalledTimes(1);

    // 底部底层工程文件默认收起，点击展开
    expect(screen.queryByTestId("mock-raw-files")).toBeNull();
    fireEvent.click(screen.getByTestId("sidebar-raw-files-toggle"));
    expect(screen.getByTestId("mock-raw-files")).toBeTruthy();

    // 切换到「有红标」只保留第2章
    fireEvent.click(screen.getByTestId("chapter-filter-issues"));
    expect(screen.queryByTestId("chapter-card-file:chapters/0001_雨夜起笔.md")).toBeNull();
    expect(screen.getByTestId("chapter-card-file:chapters/0002_青梅入城.md")).toBeTruthy();
  });
});
