import { useEffect, useState } from "react";

import type { WorkbenchResourceNode } from "./useWorkbenchResources";

export interface WorkbenchCanvasProps {
  node: WorkbenchResourceNode | null;
  onSave: (node: WorkbenchResourceNode, content: string) => Promise<void> | void;
}

export function WorkbenchCanvas({ node, onSave }: WorkbenchCanvasProps) {
  const [content, setContent] = useState(node?.content ?? "");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setContent(node?.content ?? "");
    setDirty(false);
  }, [node]);

  if (!node) {
    return <section className="workbench-canvas__empty">选择左侧资源开始写作</section>;
  }

  const readonly = node.capabilities.readonly || !node.capabilities.edit;

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
      <textarea
        aria-label="资源正文"
        readOnly={readonly}
        value={content}
        onChange={(event) => {
          setContent(event.currentTarget.value);
          setDirty(true);
        }}
      />
      <button type="button" disabled={readonly || !dirty} onClick={handleSave}>
        保存
      </button>
    </section>
  );
}
