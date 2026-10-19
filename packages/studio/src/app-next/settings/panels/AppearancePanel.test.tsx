import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppearancePanel } from "./AppearancePanel";

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
  delete document.documentElement.dataset.nfStyle;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AppearancePanel 书房主题", () => {
  it("三套主题各有一张就地预览的卡片，点选后整套界面切换", async () => {
    render(<AppearancePanel />);

    const group = await screen.findByRole("radiogroup", { name: "书房主题" });
    const options = screen.getAllByRole("radio");
    expect(group).toBeTruthy();
    expect(options.map((option) => option.getAttribute("data-nf-theme-preview"))).toEqual(["gaozhi", "shuhan", "yegeng"]);
    expect(screen.getByTestId("style-theme-gaozhi").getAttribute("aria-checked")).toBe("true");

    fireEvent.click(screen.getByTestId("style-theme-shuhan"));

    expect(document.documentElement.dataset.nfStyle).toBe("shuhan");
    expect(screen.getByTestId("style-theme-shuhan").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("style-theme-gaozhi").getAttribute("aria-checked")).toBe("false");
  });

  it("只保留产品外观设置，通用显示偏好交给 Runtime 原页", async () => {
    render(<AppearancePanel />);

    expect(await screen.findByRole("radiogroup", { name: "书房主题" })).toBeTruthy();
    expect(screen.queryByText("自动换行")).toBeNull();
    expect(screen.queryByText("界面语言")).toBeNull();
    expect(screen.queryByText("终端字号")).toBeNull();
    expect(screen.queryByText("Enter 键行为")).toBeNull();
  });

  it("不重复 Runtime 外观页已有的开关：OLED、全屏、常亮、动画都留在 Runtime 那一份", async () => {
    render(<AppearancePanel />);

    expect(await screen.findByRole("radiogroup", { name: "书房主题" })).toBeTruthy();
    expect(screen.queryByRole("switch", { name: "OLED 纯黑模式" })).toBeNull();
    expect(screen.queryByText("忽略安全区并全屏")).toBeNull();
    expect(screen.queryByText("保持屏幕唤醒")).toBeNull();
    expect(screen.queryByText("高级动画")).toBeNull();
    expect(screen.queryByText("Narrator 消息渲染器")).toBeNull();
    expect(screen.queryByRole("heading", { name: "外观与界面" })).toBeNull();
  });
});
