import { describe, expect, it } from "vitest";

import {
  chapterDisplayTitleFromPath,
  chapterTabTitle,
  fileBreadcrumbParts,
  formatChapterTitle,
  resourceDisplayTitle,
} from "./chapter-display-title";
import type { WorkbenchResourceNode } from "./useWorkbenchResources";

const capabilities = { open: true, readonly: false, unsupported: false, edit: true, delete: true, apply: false };

function chapterNode(filePath: string): WorkbenchResourceNode {
  return {
    id: `file:${filePath}`,
    kind: "chapter",
    title: filePath.split("/").pop() ?? filePath,
    path: filePath,
    capabilities,
    metadata: { filePath, isFile: true, isChapter: true },
  };
}

describe("章节显示名", () => {
  it("文件名 0001_雨夜.md 显示为「第 1 章 雨夜」", () => {
    expect(chapterDisplayTitleFromPath("chapters/卷01/0001_雨夜.md")).toBe("第 1 章 雨夜");
    expect(chapterDisplayTitleFromPath("0012-转折.md")).toBe("第 12 章 转折");
  });

  it("只有章号或标题已含「第X章」时不重复", () => {
    expect(chapterDisplayTitleFromPath("chapters/卷01/0003.md")).toBe("第 3 章");
    expect(chapterDisplayTitleFromPath("chapters/卷01/0002_第二章 回响.md")).toBe("第二章 回响");
    expect(formatChapterTitle(5, "第 5 章")).toBe("第 5 章");
  });

  it("认不出章号的文件返回 null，由调用方退回原名", () => {
    expect(chapterDisplayTitleFromPath("chapters/说明.md")).toBeNull();
  });

  it("章节节点与 chapters 目录用作者语言，其它节点保留原标题", () => {
    expect(resourceDisplayTitle(chapterNode("chapters/卷01/0001_雨夜.md"))).toBe("第 1 章 雨夜");
    expect(resourceDisplayTitle({
      id: "file-dir:chapters",
      kind: "group",
      title: "chapters",
      capabilities,
      metadata: { filePath: "chapters", isDirectory: true },
    })).toBe("正文");
    expect(resourceDisplayTitle({
      id: "file:story/notes.md",
      kind: "file",
      title: "notes.md",
      capabilities,
      metadata: { filePath: "story/notes.md", isFile: true },
    })).toBe("notes.md");
  });

  it("面包屑显示「正文 › 卷01 › 第 1 章 雨夜」，段数与真实路径一致", () => {
    const parts = fileBreadcrumbParts(chapterNode("chapters/卷01/0001_雨夜.md"));
    expect(parts).toEqual(["正文", "卷01", "第 1 章 雨夜"]);
    expect(parts).toHaveLength("chapters/卷01/0001_雨夜.md".split("/").length);
  });

  it("非章节文件的面包屑仍是真实路径", () => {
    expect(fileBreadcrumbParts({
      id: "file:story/notes.md",
      kind: "file",
      title: "notes.md",
      capabilities,
      metadata: { filePath: "story/notes.md", isFile: true },
    })).toEqual(["story", "notes.md"]);
  });

  it("恢复标签时只改章节标签的标题", () => {
    expect(chapterTabTitle("file:chapters/卷01/0001_雨夜.md", "0001_雨夜.md")).toBe("第 1 章 雨夜");
    expect(chapterTabTitle("file:story/notes.md", "notes.md")).toBe("notes.md");
    expect(chapterTabTitle("jingwei-entry:1", "陆沉")).toBe("陆沉");
  });
});
