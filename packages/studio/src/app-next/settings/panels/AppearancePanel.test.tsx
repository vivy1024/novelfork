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
  it("五套主题各有一张就地预览的卡片，点选后整套界面切换", async () => {
    render(<AppearancePanel />);

    const group = await screen.findByRole("radiogroup", { name: "书房主题" });
    const options = screen.getAllByRole("radio");
    expect(group).toBeTruthy();
    expect(options.map((option) => option.getAttribute("data-nf-theme-preview"))).toEqual([
      "gaozhi",
      "shuhan",
      "yegeng",
      "zhusha",
      "ruyao",
    ]);
    expect(screen.getByTestId("style-theme-gaozhi").getAttribute("aria-checked")).toBe("true");

    fireEvent.click(screen.getByTestId("style-theme-zhusha"));

    expect(document.documentElement.dataset.nfStyle).toBe("zhusha");
    expect(screen.getByTestId("style-theme-zhusha").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("style-theme-gaozhi").getAttribute("aria-checked")).toBe("false");
  });

  it("预览卡用同一套 nf-* 表面与控件类渲染纸面、边饰与控件形态，并给出结构特征标签", async () => {
    render(<AppearancePanel />);

    await screen.findByRole("radiogroup", { name: "书房主题" });

    for (const option of screen.getAllByRole("radio")) {
      // 卡片本体是风格化表面：纹样、圆角、边饰与材质都从这里取
      expect(option.className).toContain("nf-surface-card");
      // 缩略界面里四层材质同时在场：次级表面、侧栏头、稿面纸纹、微型按钮与徽章
      expect(option.querySelector(".nf-surface-sub")).not.toBeNull();
      expect(option.querySelector(".nf-sidebar-head")).not.toBeNull();
      expect(option.querySelector(".nf-sidebar-head-icon")).not.toBeNull();
      expect(option.querySelector(".nf-preview-paper")).not.toBeNull();
      expect(option.querySelector(".nf-mini-button")).not.toBeNull();
      expect(option.querySelector(".nf-mini-badge")).not.toBeNull();
      expect(option.querySelector(".nf-tab-pill")).not.toBeNull();
      // 一行结构特征标签点明这套主题「形状上」的不同，而不只是换色
      const caption = option.querySelector(".nf-preview-caption");
      expect(caption?.textContent?.trim()).not.toBe("");
    }

    // 五套主题的标签互不重复，能一眼分辨
    const captions = screen
      .getAllByRole("radio")
      .map((option) => option.querySelector(".nf-preview-caption")?.textContent?.trim());
    expect(new Set(captions).size).toBe(captions.length);
    expect(captions[0]).toContain("方格纸面");
    expect(captions[1]).toContain("题签");
    expect(captions[2]).toContain("胶囊");
    expect(captions[3]).toContain("朱砂");
    expect(captions[4]).toContain("瓷釉");
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
