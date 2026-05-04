import { WorkbenchCanvas } from "./WorkbenchCanvas";
import { WorkbenchResourceTree } from "./WorkbenchResourceTree";
import type { WorkbenchResourceNode } from "./useWorkbenchResources";

export interface WritingWorkbenchRouteProps {
  nodes: readonly WorkbenchResourceNode[];
  selectedNode: WorkbenchResourceNode | null;
  onOpen: (node: WorkbenchResourceNode) => void;
  onSave: (node: WorkbenchResourceNode, content: string) => Promise<void> | void;
}

export function WritingWorkbenchRoute({ nodes, selectedNode, onOpen, onSave }: WritingWorkbenchRouteProps) {
  return (
    <main className="writing-workbench-route">
      <WorkbenchResourceTree nodes={nodes} selectedNodeId={selectedNode?.id} onOpen={onOpen} />
      <WorkbenchCanvas node={selectedNode} onSave={onSave} />
    </main>
  );
}
