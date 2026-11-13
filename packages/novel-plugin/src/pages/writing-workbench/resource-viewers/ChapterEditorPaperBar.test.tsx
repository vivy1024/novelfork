import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChapterEditor, localWritingDate, normalizePaperText } from "./ChapterEditor";
vi.mock("./EditorMinimap", () => ({ EditorMinimap: () => null }));
vi.mock("@tiptap/react", async (original) => ({ ...await original<typeof import("@tiptap/react")>(), BubbleMenu: () => null }));
beforeEach(() => { const store = new Map<string, string>(); vi.stubGlobal("localStorage", { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key), clear: () => store.clear() }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("排版规范化与中文标点不丢失原文", () => {
  expect(normalizePaperText('　 唐三说："来了..."\n\n\n  长老--转身。')).toBe("唐三说：“来了……”\n\n长老——转身。");
});
it("稿纸开关、8000 目标内联编辑持久化与阅读态", () => {
  const { container, unmount, rerender } = render(<ChapterEditor content="唐三转身。" bookId="paper" showMinimap={false} />);
  expect((screen.getByLabelText("今日目标字数") as HTMLInputElement).value).toBe("8000");
  fireEvent.change(screen.getByLabelText("今日目标字数"), { target: { value: "6000" } });
  fireEvent.click(screen.getByRole("button", { name: "稿纸横线" })); expect(container.querySelector("[data-paper-lines=true]")).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "阅读本章" }));
  rerender(<ChapterEditor content="唐三转身。" bookId="paper" showMinimap={false} />);
  expect(container.querySelector(".tiptap")?.getAttribute("contenteditable")).toBe("false");
  expect((screen.getByRole("button", { name: "一键排版" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "返回码字" })); expect(container.querySelector(".tiptap")?.getAttribute("contenteditable")).toBe("true");
  unmount(); render(<ChapterEditor content="正文" bookId="paper" showMinimap={false} />); expect((screen.getByLabelText("今日目标字数") as HTMLInputElement).value).toBe("6000"); expect(screen.getByRole("button", { name: "稿纸横线" }).getAttribute("aria-pressed")).toBe("true");
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
