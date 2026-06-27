import type { WorkbenchResourceNode } from "./useWorkbenchResources";

export function isChapterWorkflowNode(node: WorkbenchResourceNode): boolean {
  return node.metadata?.isChapter === true;
}
