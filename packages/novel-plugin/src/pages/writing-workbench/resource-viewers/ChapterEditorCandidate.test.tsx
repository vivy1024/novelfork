/**
 * 选区候选面板：叙述者送回候选后，作者对照并决定应用或放弃。
 * 用真实 TipTap 编辑器验证正文变化；坐标是文档坐标（p 内文本从 1 起算）。
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChapterEditor, type SelectionCandidate } from "./ChapterEditor";

// 去掉依赖浏览器布局的缩略图和浮层；正文仍用真实 TipTap。
vi.mock("./EditorMinimap", () => ({ EditorMinimap: () => null }));
vi.mock("@tiptap/react", async (importOriginal) => ({
  ...await importOriginal<typeof import("@tiptap/react")>(),
  BubbleMenu: () => null,
}));

function candidate(overrides: Partial<SelectionCandidate> = {}): SelectionCandidate {
  return {
    kind: "selection-candidate",
    id: "req-1",
    requestId: "req-1",
    bookId: "book-1",
    chapterNumber: 1,
    from: 3,
    to: 5,
    sourceText: "推开",
    candidateText: "推开又合上",
    action: "rewrite",
    ...overrides,
  };
}

function renderEditor(content: string, overrides: Partial<Parameters<typeof ChapterEditor>[0]> = {}) {
  const onContentChange = vi.fn();
  const onDismiss = vi.fn();
  render(
    <ChapterEditor
      content={content}
      bookId="book-1"
      chapterNumber={1}
      onContentChange={onContentChange}
      selectionCandidate={candidate()}
      onDismissSelectionCandidate={onDismiss}
      {...overrides}
    />,
  );
  return { onContentChange, onDismiss };
}

afterEach(() => cleanup());

describe("选区候选面板", () => {
  it("显示原文与候选，应用后正文被替换并触发内容变化与关闭", () => {
    const { onContentChange, onDismiss } = renderEditor("小明推开药坊的门。");
    expect(screen.getByTestId("selection-candidate-source").textContent).toBe("推开");
    expect(screen.getByTestId("selection-candidate-text").textContent).toBe("推开又合上");

    fireEvent.click(screen.getByTestId("selection-candidate-apply"));

    const last = onContentChange.mock.calls.at(-1)?.[0] as string | undefined;
    expect(last).toContain("小明推开又合上药坊的门。");
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("续写候选插在选区之后，不替换原文", () => {
    const { onContentChange } = renderEditor("小明推开药坊的门。", {
      selectionCandidate: candidate({ action: "continue", candidateText: "一股药香扑面而来。" }),
    });
    fireEvent.click(screen.getByTestId("selection-candidate-apply"));

    const last = onContentChange.mock.calls.at(-1)?.[0] as string | undefined;
    expect(last).toContain("推开一股药香扑面而来。药坊的门。");
  });

  it("放弃：正文不动，只关闭候选", () => {
    const { onContentChange, onDismiss } = renderEditor("小明推开药坊的门。");
    fireEvent.click(screen.getByTestId("selection-candidate-dismiss"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onContentChange).not.toHaveBeenCalled();
  });

  it("候选章号与编辑器不一致：禁用应用并说明原因", () => {
    const { onContentChange } = renderEditor("小明推开药坊的门。", { chapterNumber: 2 });
    expect(screen.getByTestId("selection-candidate-mismatch").textContent).toContain("第 1 章");
    expect((screen.getByTestId("selection-candidate-apply") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("selection-candidate-apply"));
    expect(onContentChange).not.toHaveBeenCalled();
  });

  it("候选生成后选区原文被改动：应用被拒并提示过期", async () => {
    const { onContentChange, onDismiss } = renderEditor("小明推开药坊的门。");
    const editorEl = screen.getByLabelText("章节正文");
    // 直接改文档，让 from/to 处不再是候选生成时的原文
    await act(async () => {
      editorEl.replaceChildren(Object.assign(document.createElement("p"), { textContent: "小明合上药坊的门。" }));
      fireEvent.input(editorEl);
    });

    fireEvent.click(screen.getByTestId("selection-candidate-apply"));

    expect(screen.getByTestId("selection-candidate-error").textContent).toContain("候选已过期");
    const last = onContentChange.mock.calls.at(-1)?.[0] as string | undefined;
    expect(last).toContain("小明合上药坊的门。");
    expect(last).not.toContain("推开又合上");
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("定位模式（无 from/to）：原文唯一出现时按定位替换", () => {
    const { onContentChange, onDismiss } = renderEditor("小明推开药坊的门。\n\n夜里又下起雨。", {
      selectionCandidate: candidate({ from: undefined, to: undefined, sourceText: "推开药坊的门", candidateText: "合上了药坊的门" }),
    });
    expect(screen.getByTestId("selection-candidate-mode").textContent).toContain("按原文定位");

    fireEvent.click(screen.getByTestId("selection-candidate-apply"));

    const last = onContentChange.mock.calls.at(-1)?.[0] as string | undefined;
    expect(last).toContain("小明合上了药坊的门。");
    expect(last).toContain("夜里又下起雨。");
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("定位模式：原文找不到或出现多次时拒绝应用并说明", () => {
    const { onContentChange } = renderEditor("他推开这扇门。他推开那扇门。", {
      selectionCandidate: candidate({ from: undefined, to: undefined, sourceText: "他推开", candidateText: "他合上" }),
    });
    fireEvent.click(screen.getByTestId("selection-candidate-apply"));
    expect(screen.getByTestId("selection-candidate-error").textContent).toContain("出现多次");

    cleanup();
    const second = renderEditor("正文里没有这句话。", {
      selectionCandidate: candidate({ from: undefined, to: undefined, sourceText: "他推开", candidateText: "他合上" }),
    });
    fireEvent.click(screen.getByTestId("selection-candidate-apply"));
    expect(screen.getByTestId("selection-candidate-error").textContent).toContain("找不到");
    expect(second.onContentChange).not.toHaveBeenCalled();
  });
});
