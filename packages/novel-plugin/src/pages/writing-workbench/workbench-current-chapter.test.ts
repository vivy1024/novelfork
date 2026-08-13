import { describe, expect, it } from "vitest";

import { resolveCurrentChapter } from "./WorkbenchCanvas";
import type { WorkbenchResourceNode } from "./useWorkbenchResources";

const CAPS = { open: true, readonly: true, unsupported: false, edit: false, delete: false, apply: false } as const;

function chapter(number: number): WorkbenchResourceNode {
  return {
    id: `chapter:${number}`,
    kind: "chapter",
    title: `第 ${number} 章`,
    metadata: { chapterNumber: number },
    capabilities: { ...CAPS },
  };
}

function book(children: WorkbenchResourceNode[], nextChapter?: number): WorkbenchResourceNode {
  return {
    id: "book:b1",
    kind: "book",
    title: "测试书",
    metadata: nextChapter === undefined ? {} : { nextChapter },
    capabilities: { ...CAPS },
    children,
  };
}

describe("resolveCurrentChapter", () => {
  it("取章节节点中的最大章号（含嵌套分组）", () => {
    const tree = [book([
      { id: "group:chapters", kind: "group", title: "章节", capabilities: { ...CAPS }, children: [chapter(1), chapter(7), chapter(3)] },
    ], 8)];
    expect(resolveCurrentChapter(tree)).toBe(7);
  });

  it("只有 book.nextChapter 时反推已完成章号", () => {
    expect(resolveCurrentChapter([book([], 12)])).toBe(11);
  });

  it("新书（nextChapter=1，无章节）返回 undefined 而不是 0 或 1", () => {
    expect(resolveCurrentChapter([book([], 1)])).toBeUndefined();
  });

  it("资源树为空或没有章号信息时返回 undefined", () => {
    expect(resolveCurrentChapter(undefined)).toBeUndefined();
    expect(resolveCurrentChapter([])).toBeUndefined();
    expect(resolveCurrentChapter([book([])])).toBeUndefined();
  });

  it("忽略非法章号（NaN / 非数字 / 负数）", () => {
    const bad: WorkbenchResourceNode = {
      id: "chapter:bad",
      kind: "chapter",
      title: "坏数据",
      metadata: { chapterNumber: "第五章" },
      capabilities: { ...CAPS },
    };
    expect(resolveCurrentChapter([book([bad])])).toBeUndefined();
    expect(resolveCurrentChapter([book([bad, chapter(4)])])).toBe(4);
  });
});
