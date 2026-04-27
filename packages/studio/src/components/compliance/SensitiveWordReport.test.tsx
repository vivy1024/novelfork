import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { BookSensitiveScanResult } from "@vivy1024/novelfork-core/compliance";

import { SensitiveWordReport } from "./SensitiveWordReport";

const sampleReport: BookSensitiveScanResult = {
  platform: "qidian",
  totalBlockCount: 1,
  totalWarnCount: 1,
  totalSuggestCount: 1,
  chapters: [
    {
      platform: "qidian",
      chapterNumber: 1,
      chapterTitle: "第一章 风起",
      blockCount: 1,
      warnCount: 1,
      suggestCount: 0,
      hits: [
        {
          word: "法轮功",
          category: "political",
          severity: "block",
          chapterNumber: 1,
          chapterTitle: "第一章 风起",
          count: 2,
          suggestion: "替换为中性描述",
          positions: [
            {
              offset: 12,
              paragraph: 1,
              context: "他在街角看到法轮功相关传单，立刻皱眉。",
            },
          ],
        },
        {
          word: "爆头",
          category: "violence",
          severity: "warn",
          chapterNumber: 1,
          chapterTitle: "第一章 风起",
          count: 1,
          positions: [
            {
              offset: 44,
              paragraph: 2,
              context: "敌人被一枪爆头，鲜血溅在墙上。",
            },
          ],
        },
      ],
    },
    {
      platform: "qidian",
      chapterNumber: 2,
      chapterTitle: "第二章 夜谈",
      blockCount: 0,
      warnCount: 0,
      suggestCount: 1,
      hits: [
        {
          word: "巫蛊",
          category: "religious",
          severity: "suggest",
          chapterNumber: 2,
          chapterTitle: "第二章 夜谈",
          count: 1,
          positions: [
            {
              offset: 18,
              paragraph: 1,
              context: "村里老人提到巫蛊秘术，但无人深究。",
            },
          ],
        },
      ],
    },
  ],
};

afterEach(() => {
  cleanup();
});

describe("SensitiveWordReport", () => {
  it("renders hit rows and filters by severity/category", () => {
    render(<SensitiveWordReport report={sampleReport} onJumpToChapter={vi.fn()} />);

    expect(screen.getByText("敏感词命中 3 条")).toBeTruthy();
    expect(screen.getAllByText("法轮功").length).toBeGreaterThan(0);
    expect(screen.getAllByText("爆头").length).toBeGreaterThan(0);
    expect(screen.getAllByText("巫蛊").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "仅看 block" }));
    expect(screen.getAllByText("法轮功").length).toBeGreaterThan(0);
    expect(screen.queryByText("爆头")).toBeNull();
    expect(screen.queryByText("巫蛊")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "全部严重等级" }));
    fireEvent.click(screen.getByRole("button", { name: "仅看 violence" }));
    expect(screen.queryByText("法轮功")).toBeNull();
    expect(screen.getAllByText("爆头").length).toBeGreaterThan(0);
  });

  it("highlights context and triggers chapter jump", () => {
    const onJumpToChapter = vi.fn();
    render(<SensitiveWordReport report={sampleReport} onJumpToChapter={onJumpToChapter} />);

    const jumpButtons = screen.getAllByRole("button", { name: "跳转到第 1 章" });
    fireEvent.click(jumpButtons[0]!);

    expect(onJumpToChapter).toHaveBeenCalledWith(1);
    expect(screen.getAllByText("法轮功").length).toBeGreaterThan(0);
    expect(screen.getByText(/替换为中性描述/)).toBeTruthy();
  });
});
