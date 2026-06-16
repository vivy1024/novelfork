import { useMemo } from "react";

import {
  loadResourceTreeFromContract,
  type ContractResourceCapabilities,
  type ContractResourceNode,
  type ResourceDomainClient,
} from "@/app-next/backend-contract/resource-tree-adapter";

export type WorkbenchResourceKind = ContractResourceNode["kind"] | "bible-entry" | "storyline" | "tool-result" | "tool" | "tool-group";

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

export function useWorkbenchResources(nodes: readonly ContractResourceNode[]) {
  return useMemo(() => createWorkbenchResourcesResult(buildWorkbenchResourceTree(nodes)), [nodes]);
}

// ---------------------------------------------------------------------------
// Tool section — 工具分区节点（供资源树使用）
// ---------------------------------------------------------------------------

export type ToolPanelId = "quality" | "health" | "progress" | "arcs" | "drift" | "compliance" | "foreshadowing" | "runtime" | "coreshift";

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
      { id: "tool:progress", title: "每日进度", toolPanel: "progress" },
      { id: "tool:health", title: "全书健康", toolPanel: "health" },
    ],
  },
  {
    id: "tool-group:quality",
    title: "🔍 质量类",
    tools: [
      { id: "tool:quality", title: "质量监控", toolPanel: "quality" },
      { id: "tool:drift", title: "文风一致性", toolPanel: "drift" },
      { id: "tool:compliance", title: "平台合规", toolPanel: "compliance" },
    ],
  },
  {
    id: "tool-group:structure",
    title: "📐 结构类",
    tools: [
      { id: "tool:arcs", title: "角色弧线", toolPanel: "arcs" },
      { id: "tool:foreshadowing", title: "伏笔看板", toolPanel: "foreshadowing" },
      { id: "tool:coreshift", title: "关键转折点", toolPanel: "coreshift" },
      { id: "tool:runtime", title: "状态总览", toolPanel: "runtime" },
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
