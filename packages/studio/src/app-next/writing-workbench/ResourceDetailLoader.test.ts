import { describe, expect, it, vi } from "vitest";

import {
  applyResourceDetailToNode,
  loadResourceDetailState,
  resourceNeedsDetailHydration,
} from "./ResourceDetailLoader";
import type { WorkbenchResourceNode } from "./useWorkbenchResources";

function node(overrides: Partial<WorkbenchResourceNode> = {}): WorkbenchResourceNode {
  return {
    id: "chapter:book-1:1",
    kind: "chapter",
    title: "第一章",
    content: "",
    metadata: { bookId: "book-1", chapterNumber: 1, source: "list-preview" },
    capabilities: { open: true, readonly: false, unsupported: false, edit: true, delete: false, apply: false },
    ...overrides,
  };
}

describe("ResourceDetailLoader", () => {
  it("RED: 章节列表节点必须通过章节详情 API hydrate 成 detail 来源", async () => {
    const resource = {
      getChapter: vi.fn(async () => ({ ok: true, data: { chapterNumber: 1, filename: "0001.md", content: "真实章节正文" } })),
    };

    const detail = await loadResourceDetailState(resource as never, "book-1", node());

    expect(resource.getChapter).toHaveBeenCalledWith("book-1", 1);
    expect(detail).toMatchObject({ status: "ready", resourceId: "chapter:book-1:1", content: "真实章节正文", source: "detail" });
    const hydrated = applyResourceDetailToNode(node(), detail);
    expect(hydrated.content).toBe("真实章节正文");
    expect(hydrated.metadata).toMatchObject({ detailSource: "detail", filename: "0001.md" });
    expect(resourceNeedsDetailHydration(hydrated)).toBe(false);
  });

  it("RED: Story/Truth 列表预览必须二次读取完整详情并标记 detail", async () => {
    const storyNode = node({ id: "story-file:设定.md", kind: "story", title: "设定.md", content: "预览", metadata: { bookId: "book-1", fileName: "设定.md", source: "preview" }, capabilities: { open: true, readonly: true, unsupported: false, edit: false, delete: true, apply: false } });
    const truthNode = node({ id: "truth-file:真相.md", kind: "truth", title: "真相.md", content: "预览", metadata: { bookId: "book-1", fileName: "真相.md", source: "preview" }, capabilities: { open: true, readonly: false, unsupported: false, edit: true, delete: true, apply: false } });
    const resource = {
      getStoryFile: vi.fn(async () => ({ ok: true, data: { file: "设定.md", content: "完整 Story 内容" } })),
      getTruthFile: vi.fn(async () => ({ ok: true, data: { file: "真相.md", content: "完整 Truth 内容" } })),
    };

    const storyDetail = await loadResourceDetailState(resource as never, "book-1", storyNode);
    const truthDetail = await loadResourceDetailState(resource as never, "book-1", truthNode);

    expect(resource.getStoryFile).toHaveBeenCalledWith("book-1", "设定.md");
    expect(resource.getTruthFile).toHaveBeenCalledWith("book-1", "真相.md");
    expect(applyResourceDetailToNode(storyNode, storyDetail).content).toBe("完整 Story 内容");
    expect(applyResourceDetailToNode(truthNode, truthDetail).metadata).toMatchObject({ detailSource: "detail" });
  });

  it("RED: 失败的详情读取返回 error 状态且不清空当前节点内容", async () => {
    const current = node({ content: "当前画布正文", metadata: { bookId: "book-1", chapterNumber: 1, source: "detail", detailSource: "detail" } });
    const target = node({ id: "chapter:book-1:2", title: "第二章", metadata: { bookId: "book-1", chapterNumber: 2, source: "list-preview" } });
    const resource = {
      getChapter: vi.fn(async () => ({ ok: false, error: { error: { message: "章节不存在" } }, code: "not-found" })),
    };

    const detail = await loadResourceDetailState(resource as never, "book-1", target);

    expect(detail).toMatchObject({ status: "error", resourceId: "chapter:book-1:2" });
    expect(applyResourceDetailToNode(current, detail)).toBe(current);
  });
});
