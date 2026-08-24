import { useMemo } from "react";

import {
  loadResourceTreeFromContract,
  type ContractResourceCapabilities,
  type ContractResourceNode,
  type ResourceDomainClient,
} from "@/app-next/backend-contract/resource-tree-adapter";

export type WorkbenchResourceKind = ContractResourceNode["kind"] | "file" | "storyline" | "story-map" | "story-progression" | "tool-result" | "tool" | "tool-group";

export interface WorkbenchResourceCapabilities {
  open: boolean;
  readonly: boolean;
  unsupported: boolean;
  edit: boolean;
  delete: boolean;
  apply: boolean;
}

export interface WorkbenchResourceNode {
  id: string;
  kind: WorkbenchResourceKind;
  title: string;
  content?: string;
  path?: string;
  metadata?: Record<string, unknown>;
  capabilities: WorkbenchResourceCapabilities;
  children?: WorkbenchResourceNode[];
}

export interface WorkbenchResourcesResult {
  tree: WorkbenchResourceNode[];
  resourceMap: Map<string, WorkbenchResourceNode>;
  openableNodes: WorkbenchResourceNode[];
  errors: WorkbenchResourceNode[];
}

function isCurrent(capability: ContractResourceCapabilities[keyof ContractResourceCapabilities] | undefined): boolean {
  return capability?.status === "current";
}

function isUnsupported(capability: ContractResourceCapabilities[keyof ContractResourceCapabilities] | undefined): boolean {
  return capability?.status === "unsupported";
}

function mapCapabilities(kind: WorkbenchResourceKind, capabilities: ContractResourceCapabilities): WorkbenchResourceCapabilities {
  const edit = isCurrent(capabilities.edit);
  const unsupported = kind === "unsupported" || isUnsupported(capabilities.unsupported);
  const open = kind !== "group" && kind !== "book" && (isCurrent(capabilities.read) || unsupported);

  return {
    open,
    readonly: !edit,
    unsupported,
    edit,
    delete: isCurrent(capabilities.delete),
    apply: isCurrent(capabilities.apply),
  };
}

function toWorkbenchResourceNode(node: ContractResourceNode): WorkbenchResourceNode {
  return {
    id: node.id,
    kind: node.kind,
    title: node.title,
    content: node.content ?? undefined,
    path: node.path,
    metadata: node.metadata,
    capabilities: mapCapabilities(node.kind, node.capabilities),
    children: node.children?.map(toWorkbenchResourceNode),
  };
}

function createWorkbenchResourcesResult(tree: WorkbenchResourceNode[], errors: WorkbenchResourceNode[] = []): WorkbenchResourcesResult {
  const resourceMap = flattenWorkbenchResourceTree(tree);
  const openableNodes = Array.from(resourceMap.values()).filter((node) => node.capabilities.open);
  return { tree, resourceMap, openableNodes, errors };
}

export function buildWorkbenchResourceTree(nodes: readonly ContractResourceNode[]): WorkbenchResourceNode[] {
  return nodes.map(toWorkbenchResourceNode);
}

export function flattenWorkbenchResourceTree(nodes: readonly WorkbenchResourceNode[]): Map<string, WorkbenchResourceNode> {
  const result = new Map<string, WorkbenchResourceNode>();
  const walk = (node: WorkbenchResourceNode) => {
    result.set(node.id, node);
    node.children?.forEach(walk);
  };
  nodes.forEach(walk);
  return result;
}

export async function loadWorkbenchResourcesFromContract(resource: ResourceDomainClient, bookId: string): Promise<WorkbenchResourcesResult> {
  const result = await loadResourceTreeFromContract(resource, bookId);
  const tree = buildWorkbenchResourceTree(result.tree);
  const errors = buildWorkbenchResourceTree(result.errors);
  return createWorkbenchResourcesResult(tree, errors);
}

/**
 * 注意：调用方应确保 nodes 引用稳定（用 useMemo 包裹），
 * 否则每次父组件渲染都会重建整棵资源树。
 */
export function useWorkbenchResources(nodes: readonly ContractResourceNode[]) {
  return useMemo(() => createWorkbenchResourcesResult(buildWorkbenchResourceTree(nodes)), [nodes]);
}

// ---------------------------------------------------------------------------
// Tool section — 工具分区节点（供资源树使用）
// ---------------------------------------------------------------------------

export type ToolPanelId = "quality" | "health" | "arcs" | "drift" | "compliance" | "consistency" | "foreshadowing" | "runtime" | "coreshift" | "collaboration-version";

export interface ToolNodeDef {
  id: string;
  title: string;
  toolPanel: ToolPanelId;
}

interface ToolGroupDef {
  id: string;
  title: string;
  tools: ToolNodeDef[];
}

const TOOL_GROUPS: ToolGroupDef[] = [
  {
    id: "tool-group:progress",
    title: "📈 进度类",
    tools: [
      { id: "tool:health", title: "全书健康", toolPanel: "health" },
    ],
  },
  {
    id: "tool-group:quality",
    title: "🔍 质量类",
    tools: [
      { id: "tool:quality", title: "质量监控", toolPanel: "quality" },
      { id: "tool:consistency", title: "叙事体检", toolPanel: "consistency" },
      { id: "tool:drift", title: "文风一致性", toolPanel: "drift" },
      { id: "tool:compliance", title: "投稿风险自检", toolPanel: "compliance" },
    ],
  },
  {
    id: "tool-group:structure",
    title: "📐 结构类",
    tools: [
      { id: "tool:arcs", title: "角色弧线", toolPanel: "arcs" },
      // 伏笔看板已收敛到「故事推进」侧栏唯一入口，不再作为工具面板条目重复出现。
      { id: "tool:runtime", title: "状态总览", toolPanel: "runtime" },
    ],
  },
  {
    id: "tool-group:collaboration",
    title: "协作类",
    tools: [
      { id: "tool:collaboration-version", title: "协作与版本", toolPanel: "collaboration-version" },
    ],
  },
];

/** Create the "工具" section with grouped tool panel child nodes */
export function createToolSectionNodes(): WorkbenchResourceNode {
  const groupCaps: WorkbenchResourceCapabilities = { open: false, readonly: true, unsupported: false, edit: false, delete: false, apply: false };
  const toolCaps: WorkbenchResourceCapabilities = { open: true, readonly: true, unsupported: false, edit: false, delete: false, apply: false };

  const children: WorkbenchResourceNode[] = TOOL_GROUPS.map((group) => ({
    id: group.id,
    kind: "tool-group" as WorkbenchResourceKind,
    title: group.title,
    capabilities: groupCaps,
    children: group.tools.map((def) => ({
      id: def.id,
      kind: "tool" as WorkbenchResourceKind,
      title: def.title,
      metadata: { toolPanel: def.toolPanel },
      capabilities: toolCaps,
    })),
  }));

  return {
    id: "tool-section",
    kind: "group" as WorkbenchResourceKind,
    title: "🔧 工具",
    capabilities: groupCaps,
    children,
  };
}

/**
 * 创建全景故事主支线（Story Map）只读合成资源节点。
 */
export function createStoryMapNode(bookId: string): WorkbenchResourceNode {
  return {
    id: `story-map:${bookId}`,
    kind: "story-map",
    title: "故事主支线",
    capabilities: {
      open: true,
      readonly: true,
      unsupported: false,
      edit: false,
      delete: false,
      apply: false,
    },
    metadata: {
      isStoryMap: true,
      bookId,
    },
  };
}

/** 故事推进画布的合法初始视图。 */
export type StoryProgressionPreferredView = "outline" | "map" | "evolution";

/**
 * 创建「故事推进大屏画布」合成资源节点。
 *
 * 同一本书共用一个 tab（id 固定为 story-progression:{bookId}），
 * 不同视图（outline/map/evolution）通过 metadata.preferredView 表达，
 * 由 StoryProgressionCanvas 内部切换，避免侧栏跳转堆出多个垂直 tab。
 */
export function createStoryProgressionNode(
  bookId: string,
  preferredView: StoryProgressionPreferredView = "outline",
): WorkbenchResourceNode {
  return {
    id: `story-progression:${bookId}`,
    kind: "story-progression",
    title: "故事画布",
    capabilities: {
      open: true,
      readonly: true,
      unsupported: false,
      edit: false,
      delete: false,
      apply: false,
    },
    metadata: {
      isStoryProgression: true,
      bookId,
      preferredView,
    },
  };
}
