import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { normalizeCapability } from "@/app-next/backend-contract/capability-status";
import type { ContractResourceNode } from "@/app-next/backend-contract/resource-tree-adapter";
import { buildWorkbenchResourceTree, createMemoryCenterNode, createToolSectionNodes, createWorkflowNode, flattenWorkbenchResourceTree, loadWorkbenchResourcesFromContract, useWorkbenchResources } from "./useWorkbenchResources";

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
        id: "group:story-files",
        kind: "group",
        title: "Story 文件",
        capabilities: { read: current("resource.group") },
        children: [{ id: "story-file:hooks.md", kind: "story", title: "hooks.md", path: "story/hooks.md", capabilities: { read: current("story-files.detail"), edit: unsupported("story-files.edit") } }],
      },
      {
        id: "group:jingwei-files",
        kind: "group",
        title: "经纬文件",
        capabilities: { read: current("resource.group") },
        children: [{ id: "jingwei-file:truth.md", kind: "jingwei", title: "truth.md", path: "truth/truth.md", capabilities: { read: current("jingwei-files.detail"), edit: current("jingwei-files.save") } }],
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
    ],
  },
];

function ok<T>(data: T) {
  return { ok: true as const, data, raw: data, httpStatus: 200, capability: current("test") };
}

describe("buildWorkbenchResourceTree", () => {
  it("从 resource contract adapter 节点构造章节、经纬、story/truth 和叙事线节点", () => {
    const tree = buildWorkbenchResourceTree(contractTree);
    const flat = flattenWorkbenchResourceTree(tree);

    expect(flat.get("chapter:book-1:1")).toMatchObject({ kind: "chapter", title: "第一章 灵潮初起", capabilities: expect.objectContaining({ edit: true, readonly: false }) });
    expect(flat.get("story-file:hooks.md")).toMatchObject({ kind: "story", capabilities: expect.objectContaining({ readonly: true, edit: false }) });
    expect(flat.get("jingwei-file:truth.md")).toMatchObject({ kind: "jingwei", capabilities: expect.objectContaining({ readonly: false, edit: true }) });
    expect(flat.get("jingwei-entry:char-1")).toMatchObject({ kind: "jingwei-entry", title: "沈舟", content: "主角" });
    expect(flat.get("narrative-line:book-1")).toMatchObject({ kind: "narrative-line", title: "叙事线快照" });
  });

  it("useWorkbenchResources 返回可打开资源索引和顶层树", () => {
    const { result } = renderHook(() => useWorkbenchResources(contractTree));

    expect(result.current.tree[0]).toMatchObject({ kind: "book", title: "灵潮纪元" });
    expect(result.current.resourceMap.get("jingwei-entry:char-1")?.content).toBe("主角");
    expect(result.current.openableNodes.map((node) => node.id)).toContain("chapter:book-1:1");
  });

  it("在工具分区按时机重组工具并下线生产线组", () => {
    const flat = flattenWorkbenchResourceTree([createToolSectionNodes()]);

    // ⚡ 生产线 组已从工具树移除（移入故事推进）
    expect(flat.get("tool:workflow")).toBeUndefined();
    expect(flat.get("tool-group:workflow")).toBeUndefined();

    // 确认按时机划分的各工具节点存在
    expect(flat.get("tool:arcs")).toMatchObject({ title: "角色弧线", metadata: { toolPanel: "arcs" } });
    expect(flat.get("tool:tension")).toMatchObject({ title: "张力曲线", metadata: { toolPanel: "tension" } });
    expect(flat.get("tool:quality")).toMatchObject({ title: "质量中心", metadata: { toolPanel: "quality" } });
    expect(flat.get("tool:compliance")).toMatchObject({ title: "投稿风险自检", metadata: { toolPanel: "compliance" } });
    expect(flat.get("tool:governance")).toMatchObject({ title: "叙事治理驾驶舱", metadata: { toolPanel: "governance" } });
    expect(flat.get("tool:collaboration-version")).toMatchObject({
      title: "协作与版本",
      metadata: { toolPanel: "collaboration-version" },
      capabilities: expect.objectContaining({ open: true, readonly: true }),
    });
  });

  it("分析工具分组按写作时机排序，标题只用文字，图标用 lucide 名（不用 emoji）", () => {
    const section = createToolSectionNodes();
    expect(section.title).toBe("分析工具");
    expect(section.children?.map((group) => [group.id, group.title, group.metadata?.icon])).toEqual([
      ["tool-group:pre-writing", "写前筹备", "target"],
      ["tool-group:in-writing", "写中质检", "scan-search"],
      ["tool-group:pre-publish", "发布前风控", "shield-check"],
      ["tool-group:runtime", "运行与协同", "settings"],
    ]);
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
    for (const node of flattenWorkbenchResourceTree([section]).values()) {
      expect(node.title).not.toMatch(emoji);
    }
  });

  it("createMemoryCenterNode 创建合法且只读的章后事实中央面板合成节点", () => {
    const node = createMemoryCenterNode("book-42");

    expect(node).toEqual({
      id: "memory-center:book-42",
      kind: "file",
      title: "章后事实",
      capabilities: {
        open: true,
        readonly: true,
        unsupported: false,
        edit: false,
        delete: false,
        apply: false,
      },
      metadata: {
        isMemoryCenter: true,
        bookId: "book-42",
      },
    });
  });

  it("createWorkflowNode 创建写作视图的工作流中央标签节点（同一本书共用一个 tab）", () => {
    const node = createWorkflowNode("book-42");

    expect(node).toEqual({
      id: "workflow:book-42",
      kind: "file",
      title: "工作流",
      capabilities: {
        open: true,
        readonly: true,
        unsupported: false,
        edit: false,
        delete: false,
        apply: false,
      },
      metadata: {
        isWorkflowRun: true,
        bookId: "book-42",
      },
    });
  });

  it("分析工具里没有伏笔看板节点（伏笔只在故事画布「下一章」的伏笔账本）", () => {
    const ids = [...flattenWorkbenchResourceTree([createToolSectionNodes()]).keys()];
    expect(ids).not.toContain("tool:foreshadowing");
  });

  it("loadWorkbenchResourcesFromContract 通过 resource contract adapter 加载真实资源树", async () => {
    const resource = {
      getBook: vi.fn(async () => ok({ book: { id: "book-1", title: "灵潮纪元" }, chapters: [{ number: 1, title: "第一章", status: "draft", fileName: "001.md" }], nextChapter: 2 })),
      listWritingResources: vi.fn(async () => ok({ resources: [{ id: "chapter-resource-1", bookId: "book-1", type: "chapter", status: "accepted", title: "第一章", content: "正文", chapterNumber: 1, wordCount: 2, parentId: null, version: 1, source: null, metadata: {}, createdAt: 1, updatedAt: 1, acceptedAt: 1, deletedAt: null }] })),
      listStoryFiles: vi.fn(async () => ok({ files: [{ name: "hooks.md", label: "hooks.md", preview: "伏笔" }] })),
      listJingweiFiles: vi.fn(async () => ok({ files: [{ name: "truth.md", label: "truth.md", preview: "真相" }] })),
      listJingweiSections: vi.fn(async () => ok({ sections: [] })),
      listJingweiEntries: vi.fn(async () => ok({ entries: [{ id: "char-1", title: "沈舟", contentMd: "主角" }] })),
      getNarrativeLine: vi.fn(async () => ok({ snapshot: { bookId: "book-1", version: 1, nodes: [], edges: [], updatedAt: "2026-05-04T00:00:00.000Z" } })),
    };

    const result = await loadWorkbenchResourcesFromContract(resource as any, "book-1");

    expect(resource.getBook).toHaveBeenCalledWith("book-1");
    expect(result.resourceMap.get("chapter:1")).toMatchObject({ kind: "chapter", title: "第一章" });
    expect(result.errors).toEqual([]);
  });
});
