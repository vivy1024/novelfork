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

  it("executes a prompt preview through the runtime before accepting generated content", async () => {
    const onAccept = vi.fn();
    postApiMock
      .mockResolvedValueOnce({
        mode: "prompt-preview",
        promptPreview: "请根据选段续写下一段。",
        prompt: "请根据选段续写下一段。",
      })
      .mockResolvedValueOnce({ content: "真实生成的续写" });

    render(
      <InlineWritePanel bookId="book-1" chapterNumber={3} selectedText="前文内容" onAccept={onAccept} onDiscard={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "生成" }));

    expect(await screen.findByText("提示词预览")).toBeTruthy();
    expect(screen.queryByText("Prompt 预览")).toBeNull();
    expect(screen.getByText("请根据选段续写下一段。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "复制提示词" })).toBeTruthy();
    const executeButton = screen.getByRole("button", { name: "执行生成" }) as HTMLButtonElement;
    expect(executeButton.disabled).toBe(false);
    expect(screen.queryByRole("button", { name: "接受" })).toBeNull();

    fireEvent.click(executeButton);

    await waitFor(() => {
      expect(postApiMock).toHaveBeenCalledWith("/books/book-1/writing-modes/execute-prompt", expect.objectContaining({ prompt: "请根据选段续写下一段。", sourceMode: "inline-write" }));
    });
    expect(await screen.findByText("真实生成的续写")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "接受" }));
    expect(onAccept).toHaveBeenCalledWith("真实生成的续写");
  });
});

describe("DialogueGenerator", () => {
  it("keeps insert disabled when workspace cannot provide a safe write target", async () => {
    const onInsert = vi.fn();
    postApiMock.mockResolvedValueOnce({
      lines: [{ character: "林月", line: "你来了。" }],
    });

    render(<DialogueGenerator bookId="book-1" chapterNumber={5} onInsert={onInsert} applyDisabledReason="当前工作台尚未暴露安全写入目标。" />);

    fireEvent.change(screen.getByLabelText("角色"), { target: { value: "林月" } });
    fireEvent.click(screen.getByRole("button", { name: "生成对话" }));

    const insertButton = await screen.findByRole("button", { name: "插入到正文" }) as HTMLButtonElement;
    expect(insertButton.disabled).toBe(true);
    expect(screen.getByText("当前工作台尚未暴露安全写入目标。")).toBeTruthy();
    fireEvent.click(insertButton);
    expect(onInsert).not.toHaveBeenCalled();
  });

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
  it("executes variant prompt previews and selects the generated version", async () => {
    const onAccept = vi.fn();
    postApiMock
      .mockResolvedValueOnce({ mode: "prompt-preview", promptPreviews: ["版本提示 A", "版本提示 B"] })
      .mockResolvedValueOnce({ content: "生成版本 A" })
      .mockResolvedValueOnce({ content: "生成版本 B" });

    render(<VariantCompare bookId="book-1" chapterNumber={2} selectedText="原文" onAccept={onAccept} />);

    fireEvent.click(screen.getByRole("button", { name: "生成多版本" }));
    expect(await screen.findByText("版本提示 A")).toBeTruthy();
    const executeButton = screen.getByRole("button", { name: "执行生成" }) as HTMLButtonElement;
    expect(executeButton.disabled).toBe(false);
    fireEvent.click(executeButton);

    await waitFor(() => {
      expect(postApiMock).toHaveBeenCalledWith("/books/book-1/writing-modes/execute-prompt", expect.objectContaining({ prompt: "版本提示 A", sourceMode: "variant-compare", variantIndex: 0 }));
      expect(postApiMock).toHaveBeenCalledWith("/books/book-1/writing-modes/execute-prompt", expect.objectContaining({ prompt: "版本提示 B", sourceMode: "variant-compare", variantIndex: 1 }));
    });
    expect(await screen.findByText("生成版本 A")).toBeTruthy();
    fireEvent.click(screen.getByText("版本 2"));
    fireEvent.click(screen.getByRole("button", { name: "选择此版本" }));
    expect(onAccept).toHaveBeenCalledWith("生成版本 B");
  });

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
  it("executes a branch prompt preview into selectable outline content", async () => {
    const onSelectBranch = vi.fn();
    postApiMock
      .mockResolvedValueOnce({ mode: "prompt-preview", promptPreview: "大纲提示" })
      .mockResolvedValueOnce({ content: "真实大纲走向" });

    render(<OutlineBrancher bookId="book-1" onSelectBranch={onSelectBranch} />);

    fireEvent.click(screen.getByRole("button", { name: "生成分支走向" }));
    expect(await screen.findByText("大纲提示")).toBeTruthy();
    const executeButton = screen.getByRole("button", { name: "执行生成" }) as HTMLButtonElement;
    expect(executeButton.disabled).toBe(false);
    fireEvent.click(executeButton);

    await waitFor(() => {
      expect(postApiMock).toHaveBeenCalledWith("/books/book-1/writing-modes/execute-prompt", expect.objectContaining({ prompt: "大纲提示", sourceMode: "outline-branch" }));
    });
    expect(await screen.findByText("真实大纲走向")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "选择此走向" }));
    expect(onSelectBranch).toHaveBeenCalledWith("真实大纲走向");
  });

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
