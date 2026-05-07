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

function deriveBookTitle(bookId: string | undefined, nodes: readonly WorkbenchResourceNode[]): string {
  const rootTitle = nodes.find((node) => node.kind === "book" || !node.capabilities.open)?.title;
  if (rootTitle?.trim()) return rootTitle;
  return bookId ? `作品 ${bookId}` : "作品工作台";
}

function routeStatusLabel(nodes: readonly WorkbenchResourceNode[], selectedNode: WorkbenchResourceNode | null): string {
  if (nodes.length === 0) return "当前状态：等待资源加载";
  if (!selectedNode) return "当前状态：请选择左侧资源";
  return "当前状态：资源已加载";
}

export function WritingWorkbenchRoute({ bookId, nodes, selectedNode, onOpen, onSave, onCanvasContextChange, writingActions }: WritingWorkbenchRouteProps) {
  const bookTitle = deriveBookTitle(bookId, nodes);

  return (
    <main className="writing-workbench-route" data-testid="writing-workbench-route" data-book-id={bookId}>
      <header className="writing-workbench-route__header">
        <p>作品工作台</p>
        <h1>{bookTitle}</h1>
        <p>{routeStatusLabel(nodes, selectedNode)}</p>
      </header>
      <section aria-label="资源树" className="writing-workbench-route__resources">
        <WorkbenchResourceTree nodes={nodes} selectedNodeId={selectedNode?.id} onOpen={onOpen} />
      </section>
      <div className="writing-workbench-route__workspace">
        <section aria-label="写作动作" className="writing-workbench-route__actions">
          {writingActions ?? <p>暂无可用写作动作。</p>}
        </section>
        <section aria-label="当前资源画布" className="writing-workbench-route__canvas">
          <WorkbenchCanvas node={selectedNode} onSave={onSave} onCanvasContextChange={onCanvasContextChange} />
        </section>
      </div>
    </main>
  );
}
