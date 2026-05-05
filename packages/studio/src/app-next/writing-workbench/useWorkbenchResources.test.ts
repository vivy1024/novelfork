import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { normalizeCapability } from "../backend-contract/capability-status";
import type { ContractResourceNode } from "../backend-contract/resource-tree-adapter";
import { buildWorkbenchResourceTree, flattenWorkbenchResourceTree, loadWorkbenchResourcesFromContract, useWorkbenchResources } from "./useWorkbenchResources";

const current = (id: string) => normalizeCapability({ id, status: "current" });
const unsupported = (id: string) => normalizeCapability({ id, status: "unsupported" });

const contractTree: ContractResourceNode[] = [
  {
    id: "book:book-1",
    kind: "book",
    title: "灵潮纪元",
    capabilities: { read: current("books.detail"), edit: current("books.update") },
    children: [
      {
        id: "group:chapters",
        kind: "group",
        title: "章节",
        capabilities: { read: current("resource.group") },
        children: [{ id: "chapter:book-1:1", kind: "chapter", title: "第一章 灵潮初起", capabilities: { read: current("chapters.detail"), edit: current("chapters.save") } }],
      },
      {
        id: "group:candidates",
        kind: "group",
        title: "候选稿",
        capabilities: { read: current("resource.group") },
        children: [{ id: "candidate:candidate-1", kind: "candidate", title: "第二章候选稿", capabilities: { read: current("candidates.list"), edit: unsupported("candidates.edit"), delete: current("candidates.delete"), apply: current("candidates.accept") } }],
      },
      {
        id: "group:story-files",
        kind: "group",
        title: "Story 文件",
        capabilities: { read: current("resource.group") },
        children: [{ id: "story-file:hooks.md", kind: "story", title: "hooks.md", path: "story/hooks.md", capabilities: { read: current("story-files.detail"), edit: unsupported("story-files.edit") } }],
      },
      {
        id: "group:truth-files",
        kind: "group",
        title: "Truth 文件",
        capabilities: { read: current("resource.group") },
        children: [{ id: "truth-file:truth.md", kind: "truth", title: "truth.md", path: "truth/truth.md", capabilities: { read: current("truth-files.detail"), edit: current("truth-files.save") } }],
      },
      {
        id: "group:jingwei",
        kind: "group",
        title: "经纬资料",
        capabilities: { read: current("resource.group") },
        children: [{ id: "jingwei-entry:char-1", kind: "jingwei-entry", title: "沈舟", content: "主角", capabilities: { read: current("jingwei.entries"), edit: current("jingwei.entries.update"), delete: current("jingwei.entries.delete") } }],
      },
      {
        id: "group:narrative-line",
        kind: "group",
        title: "叙事线",
        capabilities: { read: current("resource.group") },
        children: [{ id: "narrative-line:book-1", kind: "narrative-line", title: "叙事线快照", capabilities: { read: current("narrative-line.read"), edit: unsupported("narrative-line.edit") } }],
      },
      { id: "unsupported:candidates.list", kind: "unsupported", title: "候选稿加载失败", capabilities: { unsupported: unsupported("candidates.list") } },
    ],
  },
];

function ok<T>(data: T) {
  return { ok: true as const, data, raw: data, httpStatus: 200, capability: current("test") };
}

describe("buildWorkbenchResourceTree", () => {
  it("从 resource contract adapter 节点构造章节、候选稿、草稿、经纬、story/truth 和叙事线节点", () => {
    const tree = buildWorkbenchResourceTree(contractTree);
    const flat = flattenWorkbenchResourceTree(tree);

    expect(flat.get("chapter:book-1:1")).toMatchObject({ kind: "chapter", title: "第一章 灵潮初起", capabilities: expect.objectContaining({ edit: true, readonly: false }) });
    expect(flat.get("candidate:candidate-1")).toMatchObject({ kind: "candidate", capabilities: expect.objectContaining({ apply: true, delete: true, edit: false }) });
    expect(flat.get("story-file:hooks.md")).toMatchObject({ kind: "story", capabilities: expect.objectContaining({ readonly: true, edit: false }) });
    expect(flat.get("truth-file:truth.md")).toMatchObject({ kind: "truth", capabilities: expect.objectContaining({ readonly: false, edit: true }) });
    expect(flat.get("jingwei-entry:char-1")).toMatchObject({ kind: "jingwei-entry", title: "沈舟", content: "主角" });
    expect(flat.get("narrative-line:book-1")).toMatchObject({ kind: "narrative-line", title: "叙事线快照" });
    expect(flat.get("unsupported:candidates.list")).toMatchObject({ kind: "unsupported", capabilities: expect.objectContaining({ unsupported: true, readonly: true }) });
  });

  it("useWorkbenchResources 返回可打开资源索引和顶层树", () => {
    const { result } = renderHook(() => useWorkbenchResources(contractTree));

    expect(result.current.tree[0]).toMatchObject({ kind: "book", title: "灵潮纪元" });
    expect(result.current.resourceMap.get("jingwei-entry:char-1")?.content).toBe("主角");
    expect(result.current.openableNodes.map((node) => node.id)).toContain("candidate:candidate-1");
  });

  it("loadWorkbenchResourcesFromContract 通过 resource contract adapter 加载真实资源树", async () => {
    const resource = {
      getBook: vi.fn(async () => ok({ book: { id: "book-1", title: "灵潮纪元" }, chapters: [{ number: 1, title: "第一章", status: "draft", fileName: "001.md" }], nextChapter: 2 })),
      listCandidates: vi.fn(async () => ok({ candidates: [{ id: "candidate-1", bookId: "book-1", title: "候选稿", source: "write-next", createdAt: "2026-05-04T00:00:00.000Z", status: "candidate", content: "候选正文" }] })),
      listDrafts: vi.fn(async () => ok({ drafts: [] })),
      listStoryFiles: vi.fn(async () => ok({ files: [{ name: "hooks.md", label: "hooks.md", preview: "伏笔" }] })),
      listTruthFiles: vi.fn(async () => ok({ files: [{ name: "truth.md", label: "truth.md", preview: "真相" }] })),
      listJingweiSections: vi.fn(async () => ok({ sections: [] })),
      listJingweiEntries: vi.fn(async () => ok({ entries: [{ id: "char-1", title: "沈舟", contentMd: "主角" }] })),
      getNarrativeLine: vi.fn(async () => ok({ snapshot: { bookId: "book-1", version: 1, nodes: [], edges: [], updatedAt: "2026-05-04T00:00:00.000Z" } })),
    };

    const result = await loadWorkbenchResourcesFromContract(resource as any, "book-1");

    expect(resource.getBook).toHaveBeenCalledWith("book-1");
    expect(result.resourceMap.get("chapter:book-1:1")).toMatchObject({ kind: "chapter", title: "第一章" });
    expect(result.errors).toEqual([]);
  });
});
