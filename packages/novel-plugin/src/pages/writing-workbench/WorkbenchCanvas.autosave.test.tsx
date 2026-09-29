import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkbenchCanvas } from "./WorkbenchCanvas";
import type { WorkbenchResourceNode } from "./useWorkbenchResources";

// 去掉依赖浏览器布局的缩略图和浮层；正文仍用真实 TipTap，验证输入传到保存回调。
vi.mock("./resource-viewers/EditorMinimap", () => ({ EditorMinimap: () => null }));
vi.mock("@tiptap/react", async (importOriginal) => ({
  ...await importOriginal<typeof import("@tiptap/react")>(),
  BubbleMenu: () => null,
}));

function chapter(id = "chapter:1", content = "初始正文"): WorkbenchResourceNode {
  return { id, kind: "chapter", title: id, content,
    capabilities: { open: true, readonly: false, unsupported: false, edit: true, delete: false, apply: false } };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function edit(text: string, editor = screen.getByLabelText("章节正文")) {
  await act(async () => {
    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    editor.replaceChildren(paragraph);
    fireEvent.input(editor);
  });
}

async function advance(ms = 3000) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

async function manualSave() {
  await act(async () => { window.dispatchEvent(new CustomEvent("ide:save")); });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { headers: { "content-type": "application/json" } })));
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("真实章节编辑器自动保存", () => {
  it("关闭或刷新时保护防抖草稿、在途新输入和失败草稿，全部保存成功后解除提示", async () => {
    const first = deferred();
    const retry = deferred();
    const onSave = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise);
    const { unmount } = render(<WorkbenchCanvas node={chapter()} onSave={onSave} />);
    const unload = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(unload()).toBe(false);
    await edit("关闭前尚未到防抖的正文");
    expect(unload()).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
    await manualSave();
    await edit("保存中的新输入");
    expect(unload()).toBe(true);
    await act(async () => { first.reject(new Error("保存失败")); });
    expect(unload()).toBe(true);
    await manualSave();
    expect(unload()).toBe(true);
    await act(async () => { retry.resolve(); });
    expect(onSave).toHaveBeenLastCalledWith(chapter(), "保存中的新输入");
    expect(unload()).toBe(false);
    await edit("卸载前输入");
    unmount();
    expect(unload()).toBe(false);
  });

  it("后台标签仍有新输入时，前台与旧快照保存完成都不能解除离开提示", async () => {
    const background = deferred();
    const onSave = vi.fn().mockReturnValueOnce(background.promise).mockResolvedValue(undefined);
    render(<>
      <div data-testid="background"><WorkbenchCanvas node={chapter()} isActive={false} onSave={onSave} /></div>
      <WorkbenchCanvas node={chapter("chapter:2")} onSave={onSave} />
    </>);
    const editor = within(screen.getByTestId("background")).getByLabelText("章节正文");
    await edit("后台第一版", editor);
    await advance();
    await edit("后台未保存的第二版", editor);
    await act(async () => { background.resolve(); });
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await advance();
    const savedEvent = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(savedEvent);
    expect(savedEvent.defaultPrevented).toBe(false);
  });

  it("打开含 frontmatter 的正文不算输入，也不会自动保存编辑器规范化后的 Markdown", async () => {
    const onSave = vi.fn();
    const onCanvasContextChange = vi.fn();
    const source = "---\ntitle: 第一章\n---\n# 第一章\n\n原始正文。";
    render(<WorkbenchCanvas node={chapter("chapter:1", source)} onSave={onSave} onCanvasContextChange={onCanvasContextChange} />);
    await advance(6000);
    expect(onSave).not.toHaveBeenCalled();
    expect(onCanvasContextChange).toHaveBeenLastCalledWith(expect.objectContaining({ dirty: false, contentPreview: source }));
  });
  it("防抖到期才保存；在途新输入串行写入，旧响应不能把新正文标为已保存", async () => {
    const first = deferred();
    const second = deferred();
    const onSave = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const onCanvasContextChange = vi.fn();
    render(<WorkbenchCanvas node={chapter()} onSave={onSave} onCanvasContextChange={onCanvasContextChange} />);
    await edit("第一版");
    await advance(2999);
    expect(onSave).not.toHaveBeenCalled();
    await advance(1);
    expect(onSave).toHaveBeenNthCalledWith(1, chapter(), "第一版");

    await edit("第二版继续输入");
    await advance();
    await manualSave();
    await manualSave();
    expect(onSave).toHaveBeenCalledTimes(1);
    await act(async () => { first.resolve(); });
    expect(onSave).toHaveBeenNthCalledWith(2, chapter(), "第二版继续输入");
    expect(screen.getByText("未保存")).toBeTruthy();
    expect(onCanvasContextChange).toHaveBeenLastCalledWith(expect.objectContaining({ dirty: true, contentPreview: "第二版继续输入" }));
    await act(async () => { second.resolve(); });
    expect(screen.getByText("已保存")).toBeTruthy();
    await advance();
    expect(onSave).toHaveBeenCalledTimes(2);

    // 成功后必须推进脏状态基准，撤回到最初内容也是一次需要保存的修改。
    await edit("初始正文");
    expect(screen.getByText("未保存")).toBeTruthy();
  });

  it("在途输入尚未到防抖时限，旧成功响应仍保持 dirty，剩余计时正常执行", async () => {
    const request = deferred();
    const onSave = vi.fn().mockReturnValueOnce(request.promise).mockResolvedValue(undefined);
    render(<WorkbenchCanvas node={chapter()} onSave={onSave} />);
    await edit("第一版");
    await manualSave();
    await edit("第二版");
    await advance(1000);
    await act(async () => { request.resolve(); });
    expect(screen.getByText("未保存")).toBeTruthy();
    await advance(1999);
    expect(onSave).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(onSave).toHaveBeenLastCalledWith(chapter(), "第二版");
    expect(screen.getByText("已保存")).toBeTruthy();
  });

  it("保存中撤回旧基准仍需补写，不能把正在写入的版本当成撤回成功", async () => {
    const request = deferred();
    const onSave = vi.fn().mockReturnValueOnce(request.promise).mockResolvedValue(undefined);
    render(<WorkbenchCanvas node={chapter()} onSave={onSave} />);
    await edit("将被撤回的版本");
    await manualSave();
    await edit("初始正文");
    expect(screen.getByText("未保存")).toBeTruthy();
    await advance();
    await act(async () => { request.resolve(); });
    expect(onSave).toHaveBeenLastCalledWith(chapter(), "初始正文");
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(screen.getByText("已保存")).toBeTruthy();
  });

  it("失败保留最新草稿与真实错误，清理计时后可手动重试", async () => {
    const request = deferred();
    const retry = deferred();
    const onSave = vi.fn().mockReturnValueOnce(request.promise).mockReturnValueOnce(retry.promise);
    render(<WorkbenchCanvas node={chapter()} onSave={onSave} />);
    await edit("第一版");
    await advance();
    await edit("失败时的新输入");
    await act(async () => { request.reject(new Error("磁盘不可写")); });
    expect(screen.getByRole("alert").textContent).toContain("磁盘不可写");
    expect(screen.getByText("未保存")).toBeTruthy();
    expect(screen.getByLabelText("章节正文").textContent).toBe("失败时的新输入");
    await advance(6000);
    expect(onSave).toHaveBeenCalledTimes(1);
    await manualSave();
    expect(onSave).toHaveBeenLastCalledWith(chapter(), "失败时的新输入");
    await act(async () => { retry.resolve(); });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("已保存")).toBeTruthy();
  });

  it("同一章节对象刷新和保存回包均不能覆盖脏草稿，干净时仍接纳外部正文", async () => {
    const request = deferred();
    const onSave = vi.fn().mockReturnValueOnce(request.promise).mockResolvedValue(undefined);
    const { rerender } = render(<WorkbenchCanvas node={chapter()} onSave={onSave} />);
    await edit("第一版");
    await manualSave();
    await edit("尚未保存的第二版");
    rerender(<WorkbenchCanvas node={chapter()} onSave={onSave} />);
    expect(screen.getByLabelText("章节正文").textContent).toBe("尚未保存的第二版");
    rerender(<WorkbenchCanvas node={chapter("chapter:1", "第一版")} onSave={onSave} />);
    await act(async () => { request.resolve(); });
    expect(screen.getByText("未保存")).toBeTruthy();
    expect(screen.getByLabelText("章节正文").textContent).toBe("尚未保存的第二版");
    await advance();
    expect(screen.getByText("已保存")).toBeTruthy();
    rerender(<WorkbenchCanvas node={chapter("chapter:1", "外部后续修改")} onSave={onSave} />);
    expect(screen.getByLabelText("章节正文").textContent).toBe("外部后续修改");
  });

  it("请求失败后即使撤回旧正文也保持未保存，直到重试得到成功确认", async () => {
    const request = deferred();
    const onSave = vi.fn().mockReturnValueOnce(request.promise).mockResolvedValue(undefined);
    render(<WorkbenchCanvas node={chapter()} onSave={onSave} />);
    await edit("可能已落盘但响应丢失的正文");
    await manualSave();
    await act(async () => { request.reject(new Error("连接中断")); });
    await edit("其他草稿");
    await edit("初始正文");
    expect(screen.getByText("未保存")).toBeTruthy();
    await advance();
    expect(onSave).toHaveBeenLastCalledWith(chapter(), "初始正文");
    expect(screen.getByText("已保存")).toBeTruthy();
  });

  it.each(["成功", "失败"])("切换同编号的书籍后，旧请求%s不能清脏、清除新请求的 saving 或污染错误", async (outcome) => {
    const oldRequest = deferred();
    const newRequest = deferred();
    const oldSave = vi.fn(() => oldRequest.promise);
    const newSave = vi.fn(() => newRequest.promise);
    const { rerender } = render(<WorkbenchCanvas bookId="book-a" node={chapter()} onSave={oldSave} />);
    await edit("甲书输入");
    await manualSave();
    rerender(<WorkbenchCanvas bookId="book-b" node={chapter("chapter:1", "乙书正文")} onSave={newSave} />);
    expect(screen.getByLabelText("章节正文").textContent).toBe("乙书正文");
    await edit("乙书输入");
    await manualSave();
    await act(async () => {
      if (outcome === "成功") oldRequest.resolve();
      else oldRequest.reject(new Error("甲书失败"));
    });
    expect(oldSave).toHaveBeenCalledTimes(1);
    expect(oldSave).toHaveBeenCalledWith(chapter(), "甲书输入");
    expect(newSave).toHaveBeenCalledWith(chapter("chapter:1", "乙书正文"), "乙书输入");
    expect(screen.getByText("未保存")).toBeTruthy();
    expect(screen.getByRole("button", { name: "保存" })).toHaveProperty("disabled", true);
    expect(screen.queryByRole("alert")).toBeNull();
    await act(async () => { newRequest.resolve(); });
    expect(screen.getByText("已保存")).toBeTruthy();
  });

  it("切换章节取消旧防抖，卸载取消防抖和在途排队，空画布不残留旧保存快捷键", async () => {
    const request = deferred();
    const onSave = vi.fn(() => request.promise);
    const { rerender, unmount } = render(<WorkbenchCanvas node={chapter()} onSave={onSave} />);
    await edit("未到期的第一章");
    rerender(<WorkbenchCanvas node={chapter("chapter:2", "第二章正文")} onSave={onSave} />);
    await advance();
    expect(onSave).not.toHaveBeenCalled();
    await edit("第二章修改");
    await manualSave();
    await edit("第二章在途新输入");
    await advance();
    rerender(<WorkbenchCanvas node={null} onSave={onSave} />);
    await manualSave();
    await act(async () => { request.resolve(); });
    expect(onSave).toHaveBeenCalledTimes(1);
    rerender(<WorkbenchCanvas node={chapter()} onSave={onSave} />);
    await edit("卸载前输入");
    unmount();
    await advance(6000);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("隐藏标签不响应手动保存，但其独立自动保存仍写入原章节", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<>
      <div data-testid="first"><WorkbenchCanvas node={chapter()} isActive={false} onSave={onSave} /></div>
      <div data-testid="second"><WorkbenchCanvas node={chapter("chapter:2")} onSave={onSave} /></div>
    </>);
    await edit("第一章输入", within(screen.getByTestId("first")).getByLabelText("章节正文"));
    await edit("第二章输入", within(screen.getByTestId("second")).getByLabelText("章节正文"));
    await manualSave();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenLastCalledWith(chapter("chapter:2"), "第二章输入");
    await advance();
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenLastCalledWith(chapter(), "第一章输入");
  });

  it("资源变成只读时取消待发防抖，保留草稿；恢复编辑权限后仍可手动保存", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const node = chapter();
    const { rerender } = render(<WorkbenchCanvas node={node} onSave={onSave} />);
    await edit("权限变化前的草稿");
    rerender(<WorkbenchCanvas node={{ ...node, capabilities: { ...node.capabilities, readonly: true } }} onSave={onSave} />);
    await advance();
    await manualSave();
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("未保存")).toBeTruthy();
    rerender(<WorkbenchCanvas node={node} onSave={onSave} />);
    await manualSave();
    expect(onSave).toHaveBeenCalledWith(node, "权限变化前的草稿");
    expect(screen.getByText("已保存")).toBeTruthy();
  });
});
