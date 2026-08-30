import { describe, expect, it } from "vitest";

import {
  currentFocusHasContent,
  emptyCurrentFocus,
  isPlaceholderFocusDoc,
  parseCurrentFocusFields,
  selectCurrentFocusEntry,
  serializeCurrentFocusDoc,
} from "./current-focus";

describe("current-focus 创作罗盘字段", () => {
  it("解析 goal/mustKeep/mustAvoid/notes，兼容 must_keep 下划线别名", () => {
    expect(parseCurrentFocusFields({
      goal: " 试炼过关 ",
      must_keep: "旧伤不能好",
      mustAvoid: "提前揭底",
      notes: "给自己看",
    })).toEqual({
      goal: "试炼过关",
      mustKeep: "旧伤不能好",
      mustAvoid: "提前揭底",
      notes: "给自己看",
    });
  });

  it("序列化时第一行是本章目标，供 directiveFromFocus 直接取用", () => {
    const doc = serializeCurrentFocusDoc({
      goal: "让林舟通过守门人试炼",
      mustKeep: "旧伤仍在",
      mustAvoid: "提前揭底",
      notes: "",
    });
    expect(doc.split("\n")[0]).toBe("让林舟通过守门人试炼");
    expect(doc).toContain("必须守住：");
    expect(doc).toContain("必须避开：");
    expect(doc).not.toContain("备注：");
  });

  it("空字段与默认 md 占位文案视为无内容", () => {
    expect(currentFocusHasContent(emptyCurrentFocus())).toBe(false);
    expect(isPlaceholderFocusDoc("")).toBe(true);
    expect(isPlaceholderFocusDoc("# 当前聚焦\n\n## 当前重点\n\n（描述接下来 1-3 章最需要优先推进的内容。）\n")).toBe(true);
    expect(isPlaceholderFocusDoc("# Current Focus\n\n## Active Focus\n\n(Describe what the next 1-3 chapters should prioritize.)\n")).toBe(true);
    expect(isPlaceholderFocusDoc("让林舟通过守门人试炼")).toBe(false);
  });

  it("优先取 current-focus，同分类取最新更新", () => {
    const picked = selectCurrentFocusEntry([
      { category: "outline", updatedAt: "2026-08-02" },
      { category: "current-focus", updatedAt: "2026-08-01" },
      { category: "current-focus", updatedAt: "2026-08-03" },
      { category: "focus", updatedAt: "2026-08-04" },
    ]);
    expect(picked?.updatedAt).toBe("2026-08-04");
    expect(selectCurrentFocusEntry([{ category: "outline" }])).toBeUndefined();
  });
});
