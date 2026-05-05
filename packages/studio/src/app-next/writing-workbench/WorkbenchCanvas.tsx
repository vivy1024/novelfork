import { useEffect, useState } from "react";

import { ResourceViewer } from "./resource-viewers";
import type { WorkbenchResourceKind, WorkbenchResourceNode } from "./useWorkbenchResources";

export interface WorkbenchCanvasContext {
  activeResourceId: string | null;
  activeKind: WorkbenchResourceKind | null;
  dirty: boolean;
  contentPreview: string;
}

export interface WorkbenchCanvasProps {
  node: WorkbenchResourceNode | null;
  onSave: (node: WorkbenchResourceNode, content: string) => Promise<void> | void;
  onCanvasContextChange?: (context: WorkbenchCanvasContext) => void;
}

export function WorkbenchCanvas({ node, onSave, onCanvasContextChange = () => undefined }: WorkbenchCanvasProps) {
  const [content, setContent] = useState(node?.content ?? "");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setContent(node?.content ?? "");
    setDirty(false);
  }, [node]);

  useEffect(() => {
    onCanvasContextChange({
      activeResourceId: node?.id ?? null,
      activeKind: node?.kind ?? null,
      dirty,
      contentPreview: content.slice(0, 500),
    });
  }, [content, dirty, node, onCanvasContextChange]);

  if (!node) {
    return <section className="workbench-canvas__empty">选择左侧资源开始写作</section>;
  }

  const readonly = node.capabilities.readonly || !node.capabilities.edit || node.capabilities.unsupported;

  async function handleSave() {
    if (!node || readonly) return;
    await onSave(node, content);
    setDirty(false);
  }

  return (
    <section className="workbench-canvas">
      <header>
        <h2>{node.title}</h2>
        <span>{dirty ? "未保存" : "已保存"}</span>
      </header>
      {readonly ? <p>只读资源，当前画布禁用编辑。</p> : null}
      <ResourceViewer node={{ ...node, content }} onContentChange={(nextContent) => {
        setContent(nextContent);
        setDirty(true);
      }} />
      <button type="button" disabled={readonly || !dirty} onClick={handleSave}>
        保存
      </button>
    </section>
  );
}
