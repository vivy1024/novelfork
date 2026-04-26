import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { toastMock } = vi.hoisted(() => {
  const fn: any = vi.fn();
  fn.success = vi.fn();
  fn.error = vi.fn();
  fn.warning = vi.fn();
  fn.info = vi.fn();
  fn.dismiss = vi.fn();
  return { toastMock: fn };
});

vi.mock("sonner", () => ({ toast: toastMock }));

const { useWindowRuntimeStore } = await import("@/stores/windowRuntimeStore");
const { useRecoveryToasts } = await import("./use-recovery-toasts");

beforeEach(() => {
  toastMock.mockClear();
  toastMock.success.mockClear();
  toastMock.error.mockClear();
  toastMock.warning.mockClear();
  toastMock.info.mockClear();
  useWindowRuntimeStore.setState({
    wsConnections: {},
    recoveryStates: {},
    chatSnapshots: {},
  });
});

afterEach(() => {
  // Unmount previously rendered hooks so their subscriptions do not accumulate
  // and double-fire toasts in subsequent tests.
  cleanup();
});

describe("useRecoveryToasts", () => {
  it("does not fire on first appearance of a window", () => {
    renderHook(() => useRecoveryToasts());
    act(() => {
      useWindowRuntimeStore.getState().setRecoveryState("w1", "idle");
    });
    expect(toastMock.warning).not.toHaveBeenCalled();
    expect(toastMock.info).not.toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("fires warning on idle → reconnecting", () => {
    act(() => {
      useWindowRuntimeStore.getState().setRecoveryState("w1", "idle");
    });
    renderHook(() => useRecoveryToasts());
    act(() => {
      useWindowRuntimeStore.getState().setRecoveryState("w1", "reconnecting");
    });
    expect(toastMock.warning).toHaveBeenCalledWith(
      "连接中断，正在重连…",
      expect.objectContaining({ id: "recovery-w1" }),
    );
  });

  it("fires info on reconnecting → replaying", () => {
    act(() => {
      useWindowRuntimeStore.getState().setRecoveryState("w1", "reconnecting");
    });
    renderHook(() => useRecoveryToasts());
    act(() => {
      useWindowRuntimeStore.getState().setRecoveryState("w1", "replaying");
    });
    expect(toastMock.info).toHaveBeenCalledWith(
      "正在回放历史…",
      expect.objectContaining({ id: "recovery-w1" }),
    );
  });

  it("fires success on replaying → idle", () => {
    act(() => {
      useWindowRuntimeStore.getState().setRecoveryState("w1", "replaying");
    });
    renderHook(() => useRecoveryToasts());
    act(() => {
      useWindowRuntimeStore.getState().setRecoveryState("w1", "idle");
    });
    expect(toastMock.success).toHaveBeenCalledWith(
      "会话已恢复",
      expect.objectContaining({ id: "recovery-w1" }),
    );
  });

  it("fires error on any → resetting, regardless of prev state", () => {
    act(() => {
      useWindowRuntimeStore.getState().setRecoveryState("w1", "idle");
    });
    renderHook(() => useRecoveryToasts());
    act(() => {
      useWindowRuntimeStore.getState().setRecoveryState("w1", "resetting");
    });
    expect(toastMock.error).toHaveBeenCalledWith(
      "会话已重置",
      expect.objectContaining({ id: "recovery-w1" }),
    );
  });

  it("fires error on recovery failure with the same stable toast id", () => {
    act(() => {
      useWindowRuntimeStore.getState().setRecoveryState("w1", "replaying");
    });
    renderHook(() => useRecoveryToasts());
    act(() => {
      useWindowRuntimeStore.getState().setRecoveryState("w1", "failed");
    });
    expect(toastMock.error).toHaveBeenCalledWith(
      "会话恢复失败",
      expect.objectContaining({ id: "recovery-w1" }),
    );
  });

  it("also fires success for reconnecting → idle (fast-path without replay)", () => {
    act(() => {
      useWindowRuntimeStore.getState().setRecoveryState("w2", "reconnecting");
    });
    renderHook(() => useRecoveryToasts());
    act(() => {
      useWindowRuntimeStore.getState().setRecoveryState("w2", "idle");
    });
    expect(toastMock.success).toHaveBeenCalledWith(
      "会话已恢复",
      expect.objectContaining({ id: "recovery-w2" }),
    );
  });

  it("does not re-fire when the same state is set repeatedly", () => {
    act(() => {
      useWindowRuntimeStore.getState().setRecoveryState("w1", "idle");
    });
    renderHook(() => useRecoveryToasts());
    act(() => {
      useWindowRuntimeStore.getState().setRecoveryState("w1", "reconnecting");
      useWindowRuntimeStore.getState().setRecoveryState("w1", "reconnecting");
    });
    expect(toastMock.warning).toHaveBeenCalledTimes(1);
  });

  it("uses a stable toast id per window so newer toasts replace older ones", () => {
    act(() => {
      useWindowRuntimeStore.getState().setRecoveryState("w1", "idle");
    });
    renderHook(() => useRecoveryToasts());
    act(() => {
      useWindowRuntimeStore.getState().setRecoveryState("w1", "reconnecting");
      useWindowRuntimeStore.getState().setRecoveryState("w1", "replaying");
      useWindowRuntimeStore.getState().setRecoveryState("w1", "idle");
    });
    const allCalls = [
      ...toastMock.warning.mock.calls,
      ...toastMock.info.mock.calls,
      ...toastMock.success.mock.calls,
    ];
    for (const [, opts] of allCalls) {
      expect((opts as { id?: string })?.id).toBe("recovery-w1");
    }
  });

  // Offline toast — covers the silent-offline case where recoveryState never
  // leaves `idle` but the ws channel flips from connected → disconnected.
  it("fires warning when idle+online flips to idle+offline", () => {
    act(() => {
      useWindowRuntimeStore.getState().setRecoveryState("w1", "idle");
      useWindowRuntimeStore.getState().setWsConnected("w1", true);
    });
    renderHook(() => useRecoveryToasts());
    act(() => {
      useWindowRuntimeStore.getState().setWsConnected("w1", false);
    });
    expect(toastMock.warning).toHaveBeenCalledWith(
      "会话暂时离线",
      expect.objectContaining({ id: "recovery-w1" }),
    );
  });

  it("does not fire offline toast when non-idle state already owns the banner", () => {
    act(() => {
      useWindowRuntimeStore.getState().setRecoveryState("w1", "reconnecting");
      useWindowRuntimeStore.getState().setWsConnected("w1", true);
    });
    renderHook(() => useRecoveryToasts());
    act(() => {
      // Still reconnecting, connection just drops — reconnect toast already
      // covers this; we must not stack a second "离线" on top of it.
      useWindowRuntimeStore.getState().setWsConnected("w1", false);
    });
    expect(toastMock.warning).not.toHaveBeenCalledWith(
      "会话暂时离线",
      expect.anything(),
    );
  });

  it("does not fire offline toast on first-seen offline window", () => {
    renderHook(() => useRecoveryToasts());
    act(() => {
      useWindowRuntimeStore.getState().setRecoveryState("w1", "idle");
      useWindowRuntimeStore.getState().setWsConnected("w1", false);
    });
    // prevConnected was undefined (first appearance) so no offline announce.
    expect(toastMock.warning).not.toHaveBeenCalledWith(
      "会话暂时离线",
      expect.anything(),
    );
  });
});
