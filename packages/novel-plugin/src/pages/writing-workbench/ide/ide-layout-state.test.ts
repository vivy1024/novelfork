import { beforeEach, describe, expect, it } from "vitest";

import {
  defaultIdePaneVisibility,
  IDE_CHAT_PANE_MIN_WIDTH,
  ideLayoutModeFromWidth,
  ideLayoutSizesToArray,
  idePanesUseOverlay,
  initialIdeLayoutMode,
  loadIdeLayoutSizes,
  mergeIdeLayoutSizes,
  normalizeIdeLayoutSizes,
  saveIdeLayoutSizes,
  type IdeLayoutStorage,
} from "./ide-layout-state";

const storedValues = new Map<string, string>();
const storage: IdeLayoutStorage = {
  getItem: (key) => storedValues.get(key) ?? null,
  setItem: (key, value) => storedValues.set(key, value),
};

describe("ide layout state", () => {
  beforeEach(() => {
    storedValues.clear();
  });

  it("normalizes malformed and undersized values", () => {
    expect(normalizeIdeLayoutSizes([0, -1, Number.NaN])).toEqual({ sidebar: 220, editor: 800, chat: 320 });
    // chat 240 低于对话栏下限（IDE_CHAT_PANE_MIN_WIDTH，320）：下限提高后一律夹到 320，
    // 否则恢复一个过窄的布局会把 composer 再挤回内容盒为 0 的状态。
    expect(normalizeIdeLayoutSizes([180.4, 300.6, 240.2])).toEqual({ sidebar: 180, editor: 301, chat: 320 });
  });

  it("round-trips sizes per book", () => {
    const sizes = { sidebar: 312, editor: 901, chat: 427 };
    saveIdeLayoutSizes("book-a", sizes, storage);
    expect(ideLayoutSizesToArray(loadIdeLayoutSizes("book-a", undefined, storage))).toEqual([312, 901, 427]);
    expect(loadIdeLayoutSizes("book-b", undefined, storage)).toEqual({ sidebar: 220, editor: 800, chat: 320 });
  });

  it("keeps the previous size when Allotment reports a hidden pane as zero", () => {
    const previous = { sidebar: 250, editor: 760, chat: 330 };
    expect(mergeIdeLayoutSizes([0, 810, 0], previous)).toEqual({ sidebar: 250, editor: 810, chat: 330 });
  });

  it("maps workbench width to pane visibility without stacking columns", () => {
    expect(ideLayoutModeFromWidth(1200)).toBe("comfortable");
    expect(ideLayoutModeFromWidth(1099)).toBe("compact");
    expect(ideLayoutModeFromWidth(780)).toBe("compact");
    expect(ideLayoutModeFromWidth(779)).toBe("narrow");
    expect(ideLayoutModeFromWidth(0)).toBe("comfortable");
    expect(defaultIdePaneVisibility("comfortable")).toEqual({ sidebar: true, chat: true });
    expect(defaultIdePaneVisibility("compact")).toEqual({ sidebar: true, chat: false });
    expect(defaultIdePaneVisibility("narrow")).toEqual({ sidebar: false, chat: false });
    expect(idePanesUseOverlay("narrow")).toBe(true);
    expect(idePanesUseOverlay("compact")).toBe(false);
    expect(idePanesUseOverlay("comfortable")).toBe(false);
  });

  it("subtracts the collapsed desktop shell rail when guessing the first layout mode", () => {
    expect(initialIdeLayoutMode(1400)).toBe("comfortable");
    expect(initialIdeLayoutMode(1148)).toBe("comfortable");
    expect(initialIdeLayoutMode(1147)).toBe("compact");
    expect(initialIdeLayoutMode(828)).toBe("compact");
    expect(initialIdeLayoutMode(827)).toBe("narrow");
    expect(initialIdeLayoutMode(767)).toBe("narrow");
  });

  /**
   * 对话栏最小宽度必须够 composer 用：1280px 屏幕上容器只剩 1030px（扣掉 250px 壳层侧栏），
   * 三栏并排时对话栏会被压到下限。实测（T-27，1280px 视口）：
   *   内容盒 = 面板宽 - 247；占位文字「发送消息...」自然宽 66.1px，要单行放下内容盒须 ≥ 66.1；
   *   故面板最小宽须 ≥ 313.1。下限 200 时内容盒为 0，占位文字逐字换行成 7 行（实测）。
   */
  it("keeps the chat pane wide enough for the composer placeholder", () => {
    expect(IDE_CHAT_PANE_MIN_WIDTH).toBeGreaterThanOrEqual(314);
    // 兜底尺寸与下限不能互相矛盾：下限高于兜底时，恢复布局会把窗口撑到超过预设宽度。
    expect(loadIdeLayoutSizes("book-a", undefined, storage).chat).toBeGreaterThanOrEqual(IDE_CHAT_PANE_MIN_WIDTH);
  });
});
