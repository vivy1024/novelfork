import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { postApiMock } = vi.hoisted(() => ({
  postApiMock: vi.fn(),
}));

vi.mock("@/hooks/use-api", () => ({
  postApi: (...args: unknown[]) => postApiMock(...args),
}));

import { InlineWritePanel } from "./InlineWritePanel";
import { DialogueGenerator } from "./DialogueGenerator";
import { VariantCompare } from "./VariantCompare";
import { OutlineBrancher } from "./OutlineBrancher";
import { WorkImporter } from "./WorkImporter";

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  postApiMock.mockReset();
});

describe("InlineWritePanel", () => {
  it("generates continuation and accepts result", async () => {
    const onAccept = vi.fn();
    postApiMock.mockResolvedValueOnce({ content: "生成的续写内容" });

    render(
      <InlineWritePanel bookId="book-1" chapterNumber={3} selectedText="前文内容" onAccept={onAccept} onDiscard={vi.fn()} />,
    );

    expect(screen.getByText("选段写作")).toBeTruthy();
    expect(screen.getByText("续写")).toBeTruthy();
    expect(screen.getByText("扩写")).toBeTruthy();
    expect(screen.getByText("补写")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "生成" }));

    await waitFor(() => {
      expect(postApiMock).toHaveBeenCalledWith("/books/book-1/inline-write", expect.objectContaining({ mode: "continuation", selectedText: "前文内容", chapterNumber: 3 }));
    });

    expect(await screen.findByText("生成的续写内容")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "接受" }));
    expect(onAccept).toHaveBeenCalledWith("生成的续写内容");
  });

  it("shows expansion direction badges when expansion mode selected", () => {
    render(
      <InlineWritePanel bookId="book-1" chapterNumber={1} selectedText="text" onAccept={vi.fn()} onDiscard={vi.fn()} />,
    );

    fireEvent.click(screen.getByText("扩写"));
    expect(screen.getByText("感官")).toBeTruthy();
    expect(screen.getByText("动作")).toBeTruthy();
    expect(screen.getByText("心理")).toBeTruthy();
  });
});

describe("DialogueGenerator", () => {
  it("generates dialogue and inserts formatted text", async () => {
    const onInsert = vi.fn();
    postApiMock.mockResolvedValueOnce({
      lines: [
        { character: "林月", line: "你来了。" },
        { character: "沈舟", line: "嗯。" },
      ],
    });

    render(<DialogueGenerator bookId="book-1" chapterNumber={5} onInsert={onInsert} />);

    fireEvent.change(screen.getByLabelText("角色"), { target: { value: "林月，沈舟" } });
    fireEvent.change(screen.getByLabelText("场景描述"), { target: { value: "客栈门口" } });
    fireEvent.click(screen.getByRole("button", { name: "生成对话" }));

    await waitFor(() => {
      expect(postApiMock).toHaveBeenCalledWith(
        "/books/book-1/dialogue/generate",
        expect.objectContaining({ characters: ["林月", "沈舟"], scene: "客栈门口" }),
      );
    });

    expect(await screen.findByText(/林月/)).toBeTruthy();
    expect(screen.getByText(/沈舟/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "插入到正文" }));
    expect(onInsert).toHaveBeenCalledWith('林月："你来了。"\n沈舟："嗯。"');
  });
});

describe("VariantCompare", () => {
  it("generates variants and selects one", async () => {
    const onAccept = vi.fn();
    postApiMock.mockResolvedValueOnce({
      variants: [
        { label: "版本A", content: "内容A" },
        { label: "版本B", content: "内容B" },
      ],
    });

    render(<VariantCompare bookId="book-1" chapterNumber={2} selectedText="原文" onAccept={onAccept} />);

    fireEvent.click(screen.getByRole("button", { name: "生成多版本" }));

    await waitFor(() => {
      expect(postApiMock).toHaveBeenCalledWith(
        "/books/book-1/variants/generate",
        expect.objectContaining({ selectedText: "原文", chapterNumber: 2 }),
      );
    });

    expect(await screen.findByText("内容A")).toBeTruthy();

    fireEvent.click(screen.getByText("版本B"));
    expect(screen.getByText("内容B")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "选择此版本" }));
    expect(onAccept).toHaveBeenCalledWith("内容B");
  });
});

describe("OutlineBrancher", () => {
  it("generates branches and expands one", async () => {
    const onSelectBranch = vi.fn();
    postApiMock
      .mockResolvedValueOnce({
        branches: [
          { id: "b1", conflict: "门派内斗", turningPoint: "长老叛变", estimatedChapters: 15 },
          { id: "b2", conflict: "外敌入侵", turningPoint: "结界破碎", estimatedChapters: 20 },
        ],
      })
      .mockResolvedValueOnce({ outline: "展开的大纲内容" });

    render(<OutlineBrancher bookId="book-1" onSelectBranch={onSelectBranch} />);

    fireEvent.click(screen.getByRole("button", { name: "生成分支走向" }));

    expect(await screen.findByText("门派内斗")).toBeTruthy();
    expect(screen.getByText("外敌入侵")).toBeTruthy();
    expect(screen.getByText("预计 15 章")).toBeTruthy();

    const expandButtons = screen.getAllByRole("button", { name: "展开" });
    fireEvent.click(expandButtons[0]);

    await waitFor(() => {
      expect(postApiMock).toHaveBeenCalledWith("/books/book-1/outline/expand", { branchId: "b1" });
    });

    expect(await screen.findByText("展开的大纲内容")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "选择此走向" }));
    expect(onSelectBranch).toHaveBeenCalledWith("展开的大纲内容");
  });
});

describe("WorkImporter", () => {
  it("submits pasted text and shows result", async () => {
    const onComplete = vi.fn();
    postApiMock.mockResolvedValueOnce({ chapterCount: 12, styleSummary: "偏古风叙事" });

    render(<WorkImporter onImportComplete={onComplete} />);

    fireEvent.change(screen.getByLabelText("作品文本"), { target: { value: "第一章 开端\n正文内容..." } });
    fireEvent.click(screen.getByText("续写"));
    fireEvent.click(screen.getByRole("button", { name: "提交导入" }));

    await waitFor(() => {
      expect(postApiMock).toHaveBeenCalledWith("/works/import", expect.objectContaining({ purpose: "continue-writing" }));
    });

    expect(await screen.findByText(/识别章节数：12/)).toBeTruthy();
    expect(screen.getByText(/偏古风叙事/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    expect(onComplete).toHaveBeenCalled();
  });
});
