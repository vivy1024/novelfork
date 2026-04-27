import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { AiDisclosure, PublishReadinessReport } from "@vivy1024/novelfork-core/compliance";

const fetchJsonMock = vi.fn();
const notifySuccessMock = vi.fn();
const notifyErrorMock = vi.fn();
const createObjectURLMock = vi.fn(() => "blob:mock");
const revokeObjectURLMock = vi.fn();
const anchorClickMock = vi.fn();

vi.mock("../hooks/use-api", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

vi.mock("@/lib/notify", () => ({
  notify: {
    success: (...args: unknown[]) => notifySuccessMock(...args),
    error: (...args: unknown[]) => notifyErrorMock(...args),
  },
}));

import { PublishReadiness } from "./PublishReadiness";

const sampleReport: PublishReadinessReport = {
  platform: "qidian",
  status: "blocked",
  totalBlockCount: 1,
  totalWarnCount: 2,
  totalSuggestCount: 1,
  sensitiveScan: {
    platform: "qidian",
    totalBlockCount: 1,
    totalWarnCount: 0,
    totalSuggestCount: 0,
    chapters: [
      {
        platform: "qidian",
        chapterNumber: 1,
        chapterTitle: "第一章 风起",
        blockCount: 1,
        warnCount: 0,
        suggestCount: 0,
        hits: [
          {
            word: "法轮功",
            category: "political",
            severity: "block",
            chapterNumber: 1,
            chapterTitle: "第一章 风起",
            count: 1,
            suggestion: "替换为中性描述",
            positions: [
              { offset: 12, paragraph: 1, context: "他看到法轮功相关传单。" },
            ],
          },
        ],
      },
    ],
  },
  aiRatio: {
    bookId: "book-1",
    platform: "qidian",
    totalWords: 8000,
    overallAiRatio: 0.1,
    overallLevel: "danger",
    platformThreshold: 0,
    platformThresholds: {
      qidian: 0,
      jjwxc: 0.05,
      fanqie: 0.2,
      qimao: 0.2,
      generic: 0.2,
    },
    methodology: "基于 AI 味特征分数的粗略估算，不代表精确 AI 生成比例；仅用于投稿前自检，最终以平台实际审核为准。",
    chapters: [
      {
        chapterNumber: 1,
        chapterTitle: "第一章 风起",
        wordCount: 8000,
        aiTasteScore: 0.45,
        estimatedAiRatio: 0.1,
        isAboveThreshold: true,
        level: "danger",
      },
    ],
  },
  formatCheck: {
    platform: "qidian",
    totalWords: 8000,
    chapterCount: 1,
    avgChapterWords: 8000,
    blockCount: 0,
    warnCount: 1,
    suggestCount: 1,
    issues: [
      {
        type: "chapter-too-short",
        severity: "warn",
        chapterNumber: 1,
        message: "章节字数偏短",
        detail: "建议单章至少 1000 字。",
      },
      {
        type: "title-format",
        severity: "suggest",
        chapterNumber: 1,
        message: "章节标题格式可优化",
      },
    ],
  },
};

const sampleDisclosure: AiDisclosure = {
  bookId: "book-1",
  platform: "qidian",
  aiUsageTypes: ["大纲辅助", "改写"],
  estimatedAiRatio: 0.1,
  modelNames: ["claude-sonnet-4-6"],
  humanEditDescription: "已人工逐章校改。",
  markdownText: "# AI 使用标注\n\n- 辅助类型：大纲辅助、改写\n- 估算比例：10.0%",
};

afterEach(() => {
  cleanup();
});

describe("PublishReadiness", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    notifySuccessMock.mockReset();
    notifyErrorMock.mockReset();
    createObjectURLMock.mockReset();
    createObjectURLMock.mockReturnValue("blob:mock");
    revokeObjectURLMock.mockReset();
    anchorClickMock.mockReset();

    Object.defineProperty(URL, "createObjectURL", {
      writable: true,
      value: createObjectURLMock,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      writable: true,
      value: revokeObjectURLMock,
    });
    Object.defineProperty(HTMLAnchorElement.prototype, "click", {
      writable: true,
      value: anchorClickMock,
    });
  });

  it("runs readiness check and renders summary with expandable sections", async () => {
    fetchJsonMock.mockResolvedValueOnce({ report: sampleReport });

    render(<PublishReadiness bookId="book-1" />);

    expect(screen.getByText("发布就绪检查")).toBeTruthy();
    expect(screen.getByRole("button", { name: "开始检查" })).toBeTruthy();
    expect(screen.getByText("目标平台")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "开始检查" }));

    await waitFor(() => {
      expect(fetchJsonMock).toHaveBeenCalledWith(
        "/books/book-1/compliance/publish-readiness",
        expect.objectContaining({ method: "POST" }),
      );
    });

    expect((await screen.findAllByText("建议修复后再投稿")).length).toBeGreaterThan(0);
    expect(screen.getByText("block 1")).toBeTruthy();
    expect(screen.getByText("warn 2")).toBeTruthy();
    expect(screen.getByText("suggest 1")).toBeTruthy();

    expect(screen.getByRole("button", { name: "敏感词扫描" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "AI 比例估算" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "格式规范检查" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "AI 比例估算" }));
    expect(await screen.findByText("AI 比例估算报告")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "格式规范检查" }));
    expect(await screen.findByText("章节字数偏短")).toBeTruthy();
  });

  it("generates AI disclosure and exports the report", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ report: sampleReport })
      .mockResolvedValueOnce({ disclosure: sampleDisclosure });

    render(<PublishReadiness bookId="book-1" />);

    fireEvent.click(screen.getByRole("button", { name: "开始检查" }));
    expect((await screen.findAllByText("建议修复后再投稿")).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "生成 AI 标注" }));

    await waitFor(() => {
      expect(fetchJsonMock).toHaveBeenCalledWith(
        "/books/book-1/compliance/ai-disclosure",
        expect.objectContaining({ method: "POST" }),
      );
    });

    expect(await screen.findByRole("heading", { name: "AI 使用标注" })).toBeTruthy();
    expect(screen.getByText(/辅助类型：大纲辅助、改写/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "导出报告" }));
    expect(createObjectURLMock).toHaveBeenCalledTimes(1);
  });
});
