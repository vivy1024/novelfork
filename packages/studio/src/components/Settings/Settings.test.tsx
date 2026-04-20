import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Settings } from "./Settings";

afterEach(() => {
  cleanup();
});

describe("Settings Component", () => {
  it("renders as a dialog shell", () => {
    const onClose = vi.fn();
    render(<Settings onClose={onClose} theme="light" />);

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("设置")).toBeTruthy();
  });

  it("renders with three tabs", () => {
    const onClose = vi.fn();
    render(<Settings onClose={onClose} theme="light" />);

    expect(screen.getByText("状态")).toBeTruthy();
    expect(screen.getByText("配置")).toBeTruthy();
    expect(screen.getByText("使用统计")).toBeTruthy();
  });

  it("closes on Escape key", () => {
    const onClose = vi.fn();
    render(<Settings onClose={onClose} theme="light" />);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on close button click", () => {
    const onClose = vi.fn();
    render(<Settings onClose={onClose} theme="light" />);

    const closeButton = screen.getByLabelText("关闭");
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalled();
  });
});
