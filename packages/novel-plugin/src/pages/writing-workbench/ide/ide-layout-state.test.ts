import { beforeEach, describe, expect, it } from "vitest";

import {
  ideLayoutSizesToArray,
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
    expect(normalizeIdeLayoutSizes([180.4, 300.6, 240.2])).toEqual({ sidebar: 180, editor: 301, chat: 240 });
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
});
