import { beforeEach, describe, expect, it, vi } from "vitest";

const { toastMock } = vi.hoisted(() => {
  const fn: any = vi.fn((title: string, opts?: unknown) => ({ title, opts }));
  fn.success = vi.fn((title: string, opts?: unknown) => ({ title, opts, kind: "success" }));
  fn.error = vi.fn((title: string, opts?: unknown) => ({ title, opts, kind: "error" }));
  fn.warning = vi.fn((title: string, opts?: unknown) => ({ title, opts, kind: "warning" }));
  fn.info = vi.fn((title: string, opts?: unknown) => ({ title, opts, kind: "info" }));
  fn.dismiss = vi.fn((id?: string | number) => id ?? "all");
  return { toastMock: fn };
});

vi.mock("sonner", () => ({ toast: toastMock }));

// Import after the mock is wired so notify picks up the mocked toast fn.
const { notify } = await import("./notify");

beforeEach(() => {
  toastMock.mockClear();
  toastMock.success.mockClear();
  toastMock.error.mockClear();
  toastMock.warning.mockClear();
  toastMock.info.mockClear();
  toastMock.dismiss.mockClear();
});

describe("notify", () => {
  it("forwards success to toast.success with an empty payload when no options", () => {
    notify.success("已保存");
    expect(toastMock.success).toHaveBeenCalledTimes(1);
    expect(toastMock.success).toHaveBeenCalledWith("已保存", {});
  });

  it("omits undefined option fields instead of sending undefined", () => {
    notify.error("保存失败", { description: "网络不可达" });
    expect(toastMock.error).toHaveBeenCalledWith("保存失败", { description: "网络不可达" });
    // Duration / id not passed, so they must not appear in the payload object.
    const payload = toastMock.error.mock.calls[0]![1] as Record<string, unknown>;
    expect("duration" in payload).toBe(false);
    expect("id" in payload).toBe(false);
  });

  it("passes duration and id through verbatim", () => {
    notify.info("恢复完成", { duration: 2000, id: "recovery" });
    expect(toastMock.info).toHaveBeenCalledWith("恢复完成", { duration: 2000, id: "recovery" });
  });

  it("routes warning and generic message to the right sonner channels", () => {
    notify.warning("权限被拒绝");
    notify.message("普通提示");
    expect(toastMock.warning).toHaveBeenCalledWith("权限被拒绝", {});
    expect(toastMock).toHaveBeenCalledWith("普通提示", {});
  });

  it("dismisses by id or all toasts", () => {
    notify.dismiss("recovery");
    notify.dismiss();
    expect(toastMock.dismiss).toHaveBeenNthCalledWith(1, "recovery");
    expect(toastMock.dismiss).toHaveBeenNthCalledWith(2, undefined);
  });
});
