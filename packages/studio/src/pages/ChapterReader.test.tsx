import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  useAutosave: () => ({
    saving: false,
    dirty: false,
    lastSaved: null,
    flush: vi.fn(),
  }),
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
  InkEditor: ({ initialContent, editable, onChange, onAIAction }: {
    initialContent?: string;
    editable?: boolean;
    onChange?: (markdown: string) => void;
    onAIAction?: (params: { text: string; surrounding: string; mode: string }) => Promise<string | null>;
  }) => (
    <div>
      <div>编辑器内容：{initialContent}</div>
      {editable ? <div>当前选区：选中文本</div> : null}
      {editable ? (
        <button
          type="button"
          onClick={() => {
            onChange?.("# 第一章\n原始正文");
            void onAIAction?.({ text: "选中文本", surrounding: "前文\n[SELECTED]\n后文", mode: "polish" });
          }}
        >
          触发 AI 改写
        </button>
      ) : null}
    </div>
  ),
}));

import { ChapterReader } from "./ChapterReader";

describe("ChapterReader AI gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useApiMock.mockImplementation((path: string) => {
      if (path === "/books/book-1/chapters/1") {
        return {
          data: {
            chapterNumber: 1,
            filename: "001.md",
            content: "# 第一章\n原始正文",
          },
          loading: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      if (path === "/providers/status") {
        return {
          data: {
            status: {
              hasUsableModel: false,
            },
          },
          loading: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      return { data: null, loading: false, error: null, refetch: vi.fn() };
    });
  });

  afterEach(() => cleanup());

  it("keeps current text and selection when AI rewrite is blocked then canceled", async () => {
    render(
      <ChapterReader
        bookId="book-1"
        chapterNumber={1}
        nav={{ toBook: vi.fn(), toDashboard: vi.fn(), toDiff: vi.fn(), toAdmin: vi.fn() }}
        theme="light"
        t={(key: string) => ({
          "reader.openingManuscript": "打开手稿",
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
        }[key] ?? key) as never}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(screen.getByText("当前选区：选中文本")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "触发 AI 改写" }));

    expect(await screen.findByText("此功能需要配置 AI 模型")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(screen.getByText("当前选区：选中文本")).toBeTruthy();
    expect(screen.getByText("编辑器内容：# 第一章 原始正文")).toBeTruthy();
    expect(fetchJsonMock).not.toHaveBeenCalledWith("/api/ai/transform", expect.anything());
  });
});
