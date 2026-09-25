import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ForeshadowThresholdField } from "./ForeshadowThresholdField";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function flush(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

describe("ForeshadowThresholdField 伏笔阈值设置", () => {
  it("未设置时显示默认值且「恢复默认」不可点", () => {
    render(<ForeshadowThresholdField initial={undefined} onSave={vi.fn(async () => true)} />);
    expect((screen.getByTestId("foreshadow-threshold-watch") as HTMLInputElement).value).toBe("5");
    expect((screen.getByTestId("foreshadow-threshold-overdue") as HTMLInputElement).value).toBe("12");
    expect(screen.getByText("当前为默认值")).toBeTruthy();
    expect((screen.getByTestId("foreshadow-threshold-reset") as HTMLButtonElement).disabled).toBe(true);
  });

  it("改成合法值后延迟保存，并收起「默认值」标记", async () => {
    const onSave = vi.fn(async () => true);
    render(<ForeshadowThresholdField initial={undefined} onSave={onSave} />);
    fireEvent.change(screen.getByTestId("foreshadow-threshold-overdue"), { target: { value: "30" } });
    expect(onSave).not.toHaveBeenCalled();
    await flush(1000);
    expect(onSave).toHaveBeenCalledWith({ watchChapters: 5, overdueChapters: 30 });
    expect(screen.queryByText("当前为默认值")).toBeNull();
  });

  it("临近提醒不小于超期时就地说明原因，且不保存", async () => {
    const onSave = vi.fn(async () => true);
    render(<ForeshadowThresholdField initial={{ watchChapters: 5, overdueChapters: 12 }} onSave={onSave} />);
    fireEvent.change(screen.getByTestId("foreshadow-threshold-watch"), { target: { value: "15" } });
    await flush(1000);
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByTestId("foreshadow-threshold-error").textContent).toContain("必须小于");
  });

  it("恢复默认发送 null，并把输入框回到 5 / 12", async () => {
    const onSave = vi.fn(async () => true);
    render(<ForeshadowThresholdField initial={{ watchChapters: 8, overdueChapters: 20 }} onSave={onSave} />);
    fireEvent.click(screen.getByTestId("foreshadow-threshold-reset"));
    await flush(0);
    expect(onSave).toHaveBeenCalledWith(null);
    expect((screen.getByTestId("foreshadow-threshold-watch") as HTMLInputElement).value).toBe("5");
    expect((screen.getByTestId("foreshadow-threshold-overdue") as HTMLInputElement).value).toBe("12");
    expect(screen.getByText("当前为默认值")).toBeTruthy();
  });

  it("保存失败时明确告诉作者没存上", async () => {
    render(<ForeshadowThresholdField initial={undefined} onSave={vi.fn(async () => false)} />);
    fireEvent.change(screen.getByTestId("foreshadow-threshold-overdue"), { target: { value: "20" } });
    await flush(1000);
    expect(screen.getByTestId("foreshadow-threshold-save-failed")).toBeTruthy();
  });
});
