import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWorkbenchLeaveGuard } from "./use-workbench-leave-guard";

afterEach(cleanup);

describe("工作台离开确认的异步归属", () => {
  it.each(["换书再返回", "卸载"])("%s后丢弃旧确认，等待期间不叠加弹窗", async (change) => {
    let decide!: (value: boolean) => void;
    const confirm = vi.fn(() => new Promise<boolean>(resolve => { decide = resolve; }));
    const leave = vi.fn();
    const { result, rerender, unmount } = renderHook(({ scope }) => useWorkbenchLeaveGuard(scope, confirm), {
      initialProps: { scope: "book-a:explorer" },
    });
    let pending!: Promise<void>;
    act(() => { pending = result.current(["第一章"], leave); });
    await act(async () => { await result.current(["第二章"], leave); });
    expect(confirm).toHaveBeenCalledTimes(1);
    if (change === "卸载") unmount();
    else {
      rerender({ scope: "book-b:explorer" });
      rerender({ scope: "book-a:explorer" });
    }
    await act(async () => { decide(true); await pending; });
    expect(leave).not.toHaveBeenCalled();
  });

  it("无脏稿时同步离开；确认取消后允许重试", async () => {
    const confirm = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const leave = vi.fn();
    const { result } = renderHook(() => useWorkbenchLeaveGuard("book-a", confirm));
    act(() => { void result.current([], leave); });
    expect(leave).toHaveBeenCalledTimes(1);
    await act(async () => { await result.current(["第一章"], leave); });
    expect(leave).toHaveBeenCalledTimes(1);
    await act(async () => { await result.current(["第一章"], leave); });
    expect(leave).toHaveBeenCalledTimes(2);
  });
});
