import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChapterEditor, localWritingDate, normalizePaperText } from "./ChapterEditor";
vi.mock("./EditorMinimap", () => ({ EditorMinimap: () => null }));
vi.mock("@tiptap/react", async (original) => ({ ...await original<typeof import("@tiptap/react")>(), BubbleMenu: () => null }));
beforeEach(() => { const store = new Map<string, string>(); vi.stubGlobal("localStorage", { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key), clear: () => store.clear() }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it("排版规范化与中文标点不丢失原文", () => {
  expect(normalizePaperText('　 唐三说："来了..."\n\n\n  长老--转身。')).toBe("唐三说：“来了……”\n\n长老——转身。");
});
it("稿纸模式(无/横/方)、手机阅读宽、8000 目标持久化与阅读态", () => {
  const { container, unmount, rerender } = render(<ChapterEditor content="唐三转身。" bookId="paper" showMinimap={false} />);
  expect((screen.getByLabelText("今日目标字数") as HTMLInputElement).value).toBe("8000");
  fireEvent.change(screen.getByLabelText("今日目标字数"), { target: { value: "6000" } });
  fireEvent.click(screen.getByRole("button", { name: "横格" }));
  expect(container.querySelector("[data-paper-lines=true]")?.getAttribute("data-paper-mode")).toBe("lines");
  fireEvent.click(screen.getByRole("button", { name: "方格" }));
  expect(container.querySelector("[data-paper-lines=true]")?.getAttribute("data-paper-mode")).toBe("grid");
  fireEvent.click(screen.getByRole("button", { name: "手机宽" }));
  expect(container.querySelector("[data-mobile-width=true]")).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "阅读本章" }));
  rerender(<ChapterEditor content="唐三转身。" bookId="paper" showMinimap={false} />);
  expect(container.querySelector(".tiptap")?.getAttribute("contenteditable")).toBe("false");
  expect((screen.getByRole("button", { name: "一键排版" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "返回码字" })); expect(container.querySelector(".tiptap")?.getAttribute("contenteditable")).toBe("true");
  unmount(); render(<ChapterEditor content="正文" bookId="paper" showMinimap={false} />);
  expect((screen.getByLabelText("今日目标字数") as HTMLInputElement).value).toBe("6000");
  expect(screen.getByRole("button", { name: "方格" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button", { name: "手机宽" }).getAttribute("aria-pressed")).toBe("true");
});
it("零 Token 清理条可预览并应用规则替换", async () => {
  const changed = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    result: {
      text: "他深吸一口气，随后迈步出门。",
      edits: [{ rule: "redundant-filler", reason: "去掉冗余套词" }],
      manualFlags: [{ rule: "tone", excerpt: "随后", reason: "可进一步精简", instruction: "直接写动作" }],
    },
  }), { status: 200, headers: { "Content-Type": "application/json" } })));
  render(<ChapterEditor content="他不禁深吸一口气，随后迈步出门。" bookId="paper" chapterNumber={1} onContentChange={changed} showMinimap={false} />);
  fireEvent.click(screen.getByTestId("zero-token-clean-btn"));
  await waitFor(() => expect(screen.getByTestId("zero-token-clean-bar")).not.toBeNull());
  fireEvent.click(screen.getByRole("button", { name: /应用 1 处清理/ }));
  expect(changed).toHaveBeenCalledWith("他深吸一口气，随后迈步出门。");
});
it("正文审稿波浪线点击弹出原地 PopConfirm 建议卡并可送叙述者", async () => {
  const send = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    ok: true,
    exists: true,
    issues: [{
      issueId: "iss-1",
      category: "style",
      severity: "warning",
      description: "玉佩描写「摸出那枚完好无损的玉佩」重复赘余。",
    }],
  }), { status: 200, headers: { "Content-Type": "application/json" } })));
  const { container } = render(
    <ChapterEditor
      content="林风抬手摸出那枚完好无损的玉佩，端详片刻。"
      bookId="paper"
      chapterNumber={2}
      onSendToNarrator={send}
      showMinimap={false}
    />,
  );
  const underline = await waitFor(() => {
    const el = container.querySelector(".nf-audit-underline");
    expect(el).not.toBeNull();
    return el as HTMLElement;
  });
  fireEvent.click(underline);
  const popup = await waitFor(() => screen.getByTestId("audit-issue-popconfirm"));
  expect(popup.textContent).toContain("重复赘余");
  fireEvent.click(screen.getByRole("button", { name: "送叙述者原地修" }));
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0]?.[0]).toContain("摸出那枚完好无损的玉佩");
});
it("本章提及匹配规范名或别名，未出现实体不渲染，点击打开资料", () => {
  const open = vi.fn(); render(<ChapterEditor content="小三转身，长老来了。" bookId="paper" mentionEntities={[{ name: "唐三", aliases: ["小三"], entityType: "character" }, { name: "长老" }, { name: "未出场" }]} onOpenEntity={open} />);
  expect(screen.queryByRole("button", { name: /未出场/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /角色 · 唐三/ })); expect(open).toHaveBeenCalledWith("唐三");
});
it("格式调整触发正文保存，外部加载不计入今日新增，查找栏保留", () => {
  const changed = vi.fn(); const { rerender } = render(<ChapterEditor content={'　 唐三说："来..."'} bookId="paper" onContentChange={changed} />);
  fireEvent.click(screen.getByRole("button", { name: "一键排版" })); expect(changed).toHaveBeenCalled(); expect(changed.mock.calls.at(-1)?.[0]).toContain("“来……”");
  const before = localStorage.getItem(`novelfork:writing-count:paper:${localWritingDate()}`);
  act(() => rerender(<ChapterEditor content="外部加载的一整篇更长章节，不应算作作者今日新增字数。" bookId="paper" onContentChange={changed} />));
  expect(localStorage.getItem(`novelfork:writing-count:paper:${localWritingDate()}`)).toBe(before);
  fireEvent.click(screen.getByRole("button", { name: "查找替换" })); expect(screen.getByPlaceholderText("搜索…")).not.toBeNull();
});
