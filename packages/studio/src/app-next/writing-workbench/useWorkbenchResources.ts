import { useMemo } from "react";

import {
  loadResourceTreeFromContract,
  type ContractResourceCapabilities,
  type ContractResourceNode,
  type ResourceDomainClient,
} from "../backend-contract/resource-tree-adapter";

export type WorkbenchResourceKind = ContractResourceNode["kind"] | "bible-entry" | "storyline" | "tool-result";

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
  const open = kind !== "group" && (isCurrent(capabilities.read) || unsupported);

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
