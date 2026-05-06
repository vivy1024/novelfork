import { describe, expect, it, vi } from "vitest";

import { saveResourceAndHydrate } from "./ResourceSaveController";
import type { WorkbenchResourceNode } from "./useWorkbenchResources";

function node(overrides: Partial<WorkbenchResourceNode> = {}): WorkbenchResourceNode {
  return {
    id: "chapter:book-1:1",
    kind: "chapter",
    title: "第一章",
    content: "旧正文",
    metadata: { bookId: "book-1", chapterNumber: 1, detailSource: "detail" },
    capabilities: { open: true, readonly: false, unsupported: false, edit: true, delete: false, apply: false },
    ...overrides,
  };
}

describe("ResourceSaveController", () => {
  it("RED: 保存章节后必须重新读取详情并返回服务端回读正文", async () => {
    const resource = {
      saveChapter: vi.fn(async () => ({ ok: true, data: { ok: true } })),
      getChapter: vi.fn(async () => ({ ok: true, data: { chapterNumber: 1, filename: "0001.md", content: "服务端回读正文" } })),
    };

    const saved = await saveResourceAndHydrate(resource as never, "book-1", node(), "新正文");

    expect(resource.saveChapter).toHaveBeenCalledWith("book-1", 1, { content: "新正文" });
    expect(resource.getChapter).toHaveBeenCalledWith("book-1", 1);
    expect(saved.content).toBe("服务端回读正文");
    expect(saved.metadata).toMatchObject({ detailSource: "detail", filename: "0001.md" });
  });

  it("RED: preview 或未 hydrate 资源禁止保存，避免空预览覆盖正式正文", async () => {
    const resource = {
      saveChapter: vi.fn(async () => ({ ok: true, data: { ok: true } })),
      getChapter: vi.fn(async () => ({ ok: true, data: { content: "不应读取" } })),
    };

    await expect(saveResourceAndHydrate(resource as never, "book-1", node({ content: "", metadata: { bookId: "book-1", chapterNumber: 1, source: "list-preview" } }), ""))
      .rejects.toThrow(/详情.*hydrate|预览/);
    expect(resource.saveChapter).not.toHaveBeenCalled();
  });

  it("RED: Truth、草稿、经纬条目按 kind 调用真实保存合同并回填服务端内容", async () => {
    const resource = {
      saveTruthFile: vi.fn(async () => ({ ok: true, data: { ok: true } })),
      getTruthFile: vi.fn(async () => ({ ok: true, data: { file: "truth.md", content: "服务端 Truth" } })),
      saveDraft: vi.fn(async () => ({ ok: true, data: { ok: true } })),
      getDraft: vi.fn(async () => ({ ok: true, data: { id: "d1", content: "服务端草稿", updatedAt: "2026-05-06T00:00:00.000Z" } })),
      saveJingweiEntry: vi.fn(async () => ({ ok: true, data: { entry: { id: "char-1", sectionId: "people", title: "沈舟", contentMd: "服务端经纬", updatedAt: "2026-05-06T00:00:00.000Z" } } })),
    };

    const truth = await saveResourceAndHydrate(resource as never, "book-1", node({ id: "truth-file:truth.md", kind: "truth", title: "truth.md", content: "旧 Truth", metadata: { fileName: "truth.md", detailSource: "detail" } }), "新 Truth");
    const draft = await saveResourceAndHydrate(resource as never, "book-1", node({ id: "draft:d1", kind: "draft", title: "草稿", content: "旧草稿", metadata: { draftId: "d1", detailSource: "detail" } }), "新草稿");
    const jingwei = await saveResourceAndHydrate(resource as never, "book-1", node({ id: "jingwei-entry:char-1", kind: "jingwei-entry", title: "沈舟", content: "旧经纬", metadata: { entryId: "char-1", sectionId: "people", detailSource: "detail" } }), "新经纬");

    expect(resource.saveTruthFile).toHaveBeenCalledWith("book-1", "truth.md", { content: "新 Truth" });
    expect(resource.getTruthFile).toHaveBeenCalledWith("book-1", "truth.md");
    expect(truth.content).toBe("服务端 Truth");
    expect(resource.saveDraft).toHaveBeenCalledWith("book-1", { id: "d1", title: "草稿", content: "新草稿" });
    expect(resource.getDraft).toHaveBeenCalledWith("book-1", "d1");
    expect(draft.content).toBe("服务端草稿");
    expect(resource.saveJingweiEntry).toHaveBeenCalledWith("book-1", "char-1", { title: "沈舟", contentMd: "新经纬", sectionId: "people" });
    expect(jingwei.content).toBe("服务端经纬");
  });

  it("RED: 候选稿不能从画布保存升级为正式正文覆盖", async () => {
    const resource = { saveChapter: vi.fn() };

    await expect(saveResourceAndHydrate(resource as never, "book-1", node({ id: "candidate:c1", kind: "candidate", title: "候选稿", content: "候选", capabilities: { open: true, readonly: false, unsupported: false, edit: true, delete: true, apply: true }, metadata: { detailSource: "detail" } }), "误保存"))
      .rejects.toThrow(/候选稿|不支持/);
    expect(resource.saveChapter).not.toHaveBeenCalled();
  });
});
