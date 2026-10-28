import { describe, expect, it } from "vitest";

import {
  CHAPTER_CONTEXT_RAIL_DEFAULT_WIDTH,
  CHAPTER_CONTEXT_RAIL_MAX_WIDTH,
  CHAPTER_CONTEXT_RAIL_MIN_WIDTH,
  clampChapterContextRailWidth,
  defaultChapterContextRailOpen,
  loadChapterContextRailState,
  saveChapterContextRailState,
} from "./chapter-context-rail-state";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    map,
  };
}

describe("本章上下文栏状态", () => {
  it("没存过时返回 null，由调用方按宽度决定默认开合", () => {
    expect(loadChapterContextRailState("book-1", memoryStorage())).toBeNull();
  });

  it("按书记住开合与宽度，书与书互不影响", () => {
    const storage = memoryStorage();
    saveChapterContextRailState("book-1", { open: false, width: 280 }, storage);
    expect(loadChapterContextRailState("book-1", storage)).toEqual({ open: false, width: 280 });
    expect(loadChapterContextRailState("book-2", storage)).toBeNull();
  });

  it("读回的宽度夹在上下限内，坏数据当没存过", () => {
    const storage = memoryStorage();
    saveChapterContextRailState("book-1", { open: true, width: 9999 }, storage);
    expect(loadChapterContextRailState("book-1", storage)?.width).toBe(CHAPTER_CONTEXT_RAIL_MAX_WIDTH);
    storage.map.set("nf:chapter-context-rail:v1:book-1", "{not json");
    expect(loadChapterContextRailState("book-1", storage)).toBeNull();
    storage.map.set("nf:chapter-context-rail:v1:book-1", JSON.stringify({ open: "yes", width: 300 }));
    expect(loadChapterContextRailState("book-1", storage)).toBeNull();
  });

  it("拖动宽度夹在上下限内，非数值回落默认宽度", () => {
    expect(clampChapterContextRailWidth(100)).toBe(CHAPTER_CONTEXT_RAIL_MIN_WIDTH);
    expect(clampChapterContextRailWidth(10_000)).toBe(CHAPTER_CONTEXT_RAIL_MAX_WIDTH);
    expect(clampChapterContextRailWidth(Number.NaN)).toBe(CHAPTER_CONTEXT_RAIL_DEFAULT_WIDTH);
    expect(clampChapterContextRailWidth(301.6)).toBe(302);
  });

  it("默认开合：稿面放得下约 36 字加上下文栏才展开，否则先让稿面", () => {
    // 稿面 36 字 × 16px + 左右内边距 40px ≈ 616px；加默认 280px 的栏 ≈ 896px
    expect(defaultChapterContextRailOpen(1200)).toBe(true);
    expect(defaultChapterContextRailOpen(900)).toBe(true);
    expect(defaultChapterContextRailOpen(600)).toBe(false);
    // 量不到宽度（首帧、测试环境）时维持旧行为：展开
    expect(defaultChapterContextRailOpen(0)).toBe(true);
  });

  it("存储不可用时不抛错", () => {
    const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
    expect(loadChapterContextRailState("book-1", broken)).toBeNull();
    expect(() => saveChapterContextRailState("book-1", { open: true, width: 280 }, broken)).not.toThrow();
  });
});
