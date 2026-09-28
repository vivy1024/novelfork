import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchJson = vi.fn();
vi.mock("@/hooks/use-api", () => ({
  fetchJson: (...args: unknown[]) => fetchJson(...args),
}));

import { useChapterReconcile } from "./use-chapter-reconcile";

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
}

const change = { chapterNumber: 3, path: "chapters/卷01/0003_夜雪.md", kind: "modified", wordCount: 1200 };
const feed = (revision: number, changes: unknown[] = [], extra: Record<string, unknown> = {}) => ({
  epoch: "epoch-1",
  revision,
  changes,
  ...extra,
});

beforeEach(() => {
  vi.useFakeTimers();
  setVisibility("visible");
  fetchJson.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setVisibility("visible");
});

describe("useChapterReconcile", () => {
  it("挂载时先取基准修订号，之后带上它轮询，有变更才回调", async () => {
    fetchJson
      .mockResolvedValueOnce(feed(4))
      .mockResolvedValueOnce(feed(4))
      .mockResolvedValueOnce(feed(5, [change]));
    const onChanges = vi.fn();
    renderHook(() => useChapterReconcile("book-1", onChanges, 1_000));

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchJson).toHaveBeenLastCalledWith("/api/books/book-1/chapters/reconcile", { method: "POST" });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchJson).toHaveBeenLastCalledWith("/api/books/book-1/chapters/reconcile?since=4", { method: "POST" });
    expect(onChanges).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(onChanges).toHaveBeenCalledWith([change], { reset: false });

    fetchJson.mockResolvedValueOnce(feed(5));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchJson).toHaveBeenLastCalledWith("/api/books/book-1/chapters/reconcile?since=5", { method: "POST" });
    expect(onChanges).toHaveBeenCalledTimes(1);
  });

  it("服务重启（纪元变化）或流水被截断时要求整体刷新", async () => {
    fetchJson
      .mockResolvedValueOnce(feed(9))
      .mockResolvedValueOnce({ epoch: "epoch-2", revision: 0, changes: [] })
      .mockResolvedValueOnce({ epoch: "epoch-2", revision: 300, changes: [change], truncated: true });
    const onChanges = vi.fn();
    renderHook(() => useChapterReconcile("book-1", onChanges, 1_000));

    await vi.advanceTimersByTimeAsync(1_000);
    expect(onChanges).toHaveBeenLastCalledWith([], { reset: true });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchJson).toHaveBeenLastCalledWith("/api/books/book-1/chapters/reconcile?since=0", { method: "POST" });
    expect(onChanges).toHaveBeenLastCalledWith([], { reset: true });
  });

  it("页面隐藏时不对账，重新可见时立即补一次", async () => {
    fetchJson.mockResolvedValue(feed(1));
    setVisibility("hidden");
    renderHook(() => useChapterReconcile("book-1", vi.fn(), 1_000));

    await vi.advanceTimersByTimeAsync(3_000);
    expect(fetchJson).not.toHaveBeenCalled();

    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it("请求失败不打断后续对账，卸载后停止", async () => {
    fetchJson.mockRejectedValueOnce(new Error("网络中断")).mockResolvedValue(feed(1));
    const { unmount } = renderHook(() => useChapterReconcile("book-1", vi.fn(), 1_000));

    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchJson).toHaveBeenCalledTimes(2);

    unmount();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it("没有书籍时不对账", async () => {
    renderHook(() => useChapterReconcile(undefined, vi.fn(), 1_000));
    await vi.advanceTimersByTimeAsync(3_000);
    expect(fetchJson).not.toHaveBeenCalled();
  });
});
