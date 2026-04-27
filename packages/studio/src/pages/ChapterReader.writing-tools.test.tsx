import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { useApiMock, fetchJsonMock, postApiMock } = vi.hoisted(() => ({
  useApiMock: vi.fn(),
  fetchJsonMock: vi.fn(),
  postApiMock: vi.fn(),
}));

vi.mock("../hooks/use-api", () => ({
  useApi: (...args: unknown[]) => useApiMock(...args),
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
  postApi: (...args: unknown[]) => postApiMock(...args),
}));

vi.mock("../hooks/use-autosave", () => ({
  useAutosave: () => ({ saving: false, dirty: false, lastSaved: null, flush: vi.fn() }),
}));

vi.mock("../components/ContextPanel", () => ({ ContextPanel: () => null }));
vi.mock("../components/HistoryPanel", () => ({ HistoryPanel: () => null }));
vi.mock("../components/OutlinePanel", () => ({ OutlinePanel: () => null }));
vi.mock("../components/DiffPanel", () => ({ DiffPanel: () => null }));
vi.mock("@/lib/notify", () => ({
  notify: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock("../components/InkEditor", () => ({
  getMarkdown: () => "# 第一章\n原始正文",
  InkEditor: ({ initialContent }: { initialContent?: string }) => <div>编辑器内容：{initialContent}</div>,
}));

vi.mock("@/components/writing-tools/ChapterHookGenerator", () => ({
  ChapterHookGenerator: ({ onApplyHook }: { onApplyHook: (hook: { id: string; style: string; text: string; rationale: string; retentionEstimate: string }) => void }) => (
    <section>
      章节钩子生成器
      <button
        type="button"
        onClick={() => onApplyHook({
          id: "hook-1",
          style: "suspense",
          text: "门外传来第三次脚步声。",
          rationale: "制造持续问题",
          retentionEstimate: "high",
        })}
      >
        插入测试钩子
      </button>
    </section>
  ),
}));

vi.mock("@/components/writing-tools/RhythmChart", () => ({
  RhythmChart: ({ onHighlightRanges }: { onHighlightRanges?: (ranges: ReadonlyArray<{ start: number; end: number }>) => void }) => (
    <section>
      段落节奏可视化
      <button type="button" onClick={() => onHighlightRanges?.([{ start: 3, end: 7 }])}>高亮测试句子</button>
    </section>
  ),
}));

vi.mock("@/components/writing-tools/DialogueAnalysis", () => ({
  DialogueAnalysis: () => <section>对话比例分析</section>,
}));

import { ChapterReader } from "./ChapterReader";

describe("ChapterReader writing tools integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useApiMock.mockImplementation((path: string) => {
      if (path === "/books/book-1/chapters/1") {
        return {
          data: { chapterNumber: 1, filename: "001.md", content: "# 第一章\n原始正文。\n她说：你好。" },
          loading: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      if (path === "/providers/status") {
        return { data: { status: { hasUsableModel: true } }, loading: false, error: null, refetch: vi.fn() };
      }
      return { data: null, loading: false, error: null, refetch: vi.fn() };
    });
    fetchJsonMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/books/book-1/chapters/1/rhythm") {
        return Promise.resolve({
          sentenceLengths: [4],
          sentenceHistogram: [{ range: "1-5", count: 1 }],
          paragraphLengths: [12],
          avgSentenceLength: 4,
          sentenceLengthStdDev: 0,
          rhythmScore: 80,
          issues: [],
          sentenceRanges: [{ text: "原始正文。", length: 4, start: 3, end: 7, bucket: "1-5" }],
        });
      }
      if (path === "/books/book-1/chapters/1/dialogue") {
        return Promise.resolve({
          totalWords: 20,
          dialogueWords: 8,
          dialogueRatio: 0.4,
          referenceRange: { min: 0.3, max: 0.5 },
          isHealthy: true,
          characterDialogue: [],
          issues: [],
        });
      }
      if (path === "/books/book-1/truth/pending_hooks.md") {
        if (init?.method === "PUT") {
          return Promise.resolve({ ok: true });
        }
        return Promise.resolve({ content: "# 待处理伏笔" });
      }
      return Promise.resolve({});
    });
  });

  afterEach(() => cleanup());

  it("opens chapter writing tools, loads rhythm/dialogue analysis, and applies generated hooks", async () => {
    render(
      <ChapterReader
        bookId="book-1"
        chapterNumber={1}
        nav={{ toBook: vi.fn(), toDashboard: vi.fn(), toDiff: vi.fn(), toAdmin: vi.fn() }}
        theme="light"
        t={((key: string) => ({
          "reader.openingManuscript": "打开手稿",
          "reader.backToList": "返回列表",
          "diff.title": "对比",
          "reader.edit": "编辑",
          "book.save": "保存",
          "book.saving": "保存中",
          "reader.preview": "预览",
          "reader.chapterList": "章节列表",
          "reader.manuscriptPage": "手稿页",
          "reader.characters": "字",
          "reader.minRead": "分钟",
          "reader.endOfChapter": "章节结束",
          "reader.approve": "通过",
          "reader.reject": "拒绝",
        }[key] ?? key)) as never}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "写作工具" }));
    expect(await screen.findByText("章节钩子生成器")).toBeTruthy();

    await waitFor(() => {
      expect(fetchJsonMock).toHaveBeenCalledWith("/books/book-1/chapters/1/rhythm", expect.objectContaining({ method: "POST" }));
      expect(fetchJsonMock).toHaveBeenCalledWith("/books/book-1/chapters/1/dialogue", expect.objectContaining({ method: "POST" }));
    });
    expect(await screen.findByText("段落节奏可视化")).toBeTruthy();
    expect(await screen.findByText("对话比例分析")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "插入测试钩子" }));
    expect(screen.getByText(/门外传来第三次脚步声。/)).toBeTruthy();
    await waitFor(() => {
      expect(fetchJsonMock).toHaveBeenCalledWith("/books/book-1/truth/pending_hooks.md");
      expect(fetchJsonMock).toHaveBeenCalledWith("/books/book-1/truth/pending_hooks.md", expect.objectContaining({ method: "PUT" }));
    });
    const truthUpdateCall = fetchJsonMock.mock.calls.find((call) => call[0] === "/books/book-1/truth/pending_hooks.md" && call[1]?.method === "PUT");
    expect(JSON.parse(truthUpdateCall?.[1]?.body as string).content).toContain("hook-1");
  });
});
