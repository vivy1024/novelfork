import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initStyleTheme, setStyleTheme, useStyleTheme } from "./use-style-theme";

function stubStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
  return store;
}

function Probe() {
  const { styleTheme } = useStyleTheme();
  return <span data-testid="probe">{styleTheme}</span>;
}

beforeEach(() => {
  delete document.documentElement.dataset.nfStyle;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("书房主题", () => {
  it("启动时按本地保存的主题挂到 <html data-nf-style>", () => {
    stubStorage({ "novelfork:style-theme": "yegeng" });
    initStyleTheme();
    expect(document.documentElement.dataset.nfStyle).toBe("yegeng");
  });

  it("保存的值无法识别时退回默认的绿格稿纸", () => {
    stubStorage({ "novelfork:style-theme": "neon" });
    initStyleTheme();
    expect(document.documentElement.dataset.nfStyle).toBe("gaozhi");
  });

  it("切换后所有使用者同步更新，并写入本地存储", () => {
    const store = stubStorage();
    initStyleTheme();
    render(<><Probe /><Probe /></>);
    expect(screen.getAllByTestId("probe").map((node) => node.textContent)).toEqual(["gaozhi", "gaozhi"]);

    act(() => setStyleTheme("shuhan"));

    expect(screen.getAllByTestId("probe").map((node) => node.textContent)).toEqual(["shuhan", "shuhan"]);
    expect(document.documentElement.dataset.nfStyle).toBe("shuhan");
    expect(store.get("novelfork:style-theme")).toBe("shuhan");
  });
});
