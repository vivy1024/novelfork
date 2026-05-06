import type { ReactNode } from "react";

import { WorkbenchCanvas, type WorkbenchCanvasContext } from "./WorkbenchCanvas";
import { WorkbenchResourceTree } from "./WorkbenchResourceTree";
import type { WorkbenchResourceNode } from "./useWorkbenchResources";

export interface WritingWorkbenchRouteProps {
  bookId?: string;
  nodes: readonly WorkbenchResourceNode[];
  selectedNode: WorkbenchResourceNode | null;
  onOpen: (node: WorkbenchResourceNode) => void;
  onSave: (node: WorkbenchResourceNode, content: string) => Promise<void> | void;
  onCanvasContextChange?: (context: WorkbenchCanvasContext) => void;
  writingActions?: ReactNode;
}

export function WritingWorkbenchRoute({ bookId, nodes, selectedNode, onOpen, onSave, onCanvasContextChange, writingActions }: WritingWorkbenchRouteProps) {
  return (
    <main className="writing-workbench-route" data-testid="writing-workbench-route" data-book-id={bookId}>
      <WorkbenchResourceTree nodes={nodes} selectedNodeId={selectedNode?.id} onOpen={onOpen} />
      <div className="writing-workbench-route__workspace">
        {writingActions}
        <WorkbenchCanvas node={selectedNode} onSave={onSave} onCanvasContextChange={onCanvasContextChange} />
      </div>
    </main>
  );
}
