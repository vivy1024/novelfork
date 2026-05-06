import { useEffect, useState } from "react";

import { resourceNeedsDetailHydration } from "./ResourceDetailLoader";
import { ResourceViewer } from "./resource-viewers";
import type { CanvasContext, OpenResourceTab, WorkspaceResourceRef, WorkspaceResourceViewKind } from "../../shared/agent-native-workspace";
import type { WorkbenchResourceKind, WorkbenchResourceNode } from "./useWorkbenchResources";

export interface WorkbenchCanvasContext extends CanvasContext {
  activeResourceId: string | null;
  activeKind: WorkbenchResourceKind | null;
  dirty: boolean;
  contentPreview: string;
}

function toWorkspaceResourceRef(node: WorkbenchResourceNode): WorkspaceResourceRef {
  return {
    kind: node.kind,
    id: node.id,
    title: node.title,
    path: node.path,
    ...(typeof node.metadata?.bookId === "string" ? { bookId: node.metadata.bookId } : {}),
  };
}

function toResourceViewKind(kind: WorkbenchResourceKind): WorkspaceResourceViewKind {
  switch (kind) {
    case "chapter":
      return "chapter-editor";
    case "candidate":
      return "candidate-editor";
    case "draft":
      return "draft-editor";
    case "story":
    case "truth":
      return "markdown-viewer";
    case "jingwei-section":
      return "bible-category-view";
    case "jingwei-entry":
    case "bible-entry":
      return "bible-entry-editor";
    case "narrative-line":
    case "storyline":
      return "narrative-line";
    case "tool-result":
      return "tool-result";
    default:
      return "unsupported";
  }
}

function toOpenResourceTab(node: WorkbenchResourceNode, dirty: boolean): OpenResourceTab {
  return {
    id: node.id,
    nodeId: node.id,
    kind: toResourceViewKind(node.kind),
    title: node.title,
    dirty,
    source: "user",
  };
}

function saveErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface WorkbenchCanvasProps {
  node: WorkbenchResourceNode | null;
  onSave: (node: WorkbenchResourceNode, content: string) => Promise<void> | void;
  onCanvasContextChange?: (context: WorkbenchCanvasContext) => void;
}

export function WorkbenchCanvas({ node, onSave, onCanvasContextChange = () => undefined }: WorkbenchCanvasProps) {
  const [content, setContent] = useState(node?.content ?? "");
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setContent(node?.content ?? "");
    setDirty(false);
    setSaveError(null);
  }, [node]);

  useEffect(() => {
    onCanvasContextChange({
      activeResourceId: node?.id ?? null,
      activeKind: node?.kind ?? null,
      activeTabId: node?.id,
      activeResource: node ? toWorkspaceResourceRef(node) : undefined,
      openTabs: node ? [toOpenResourceTab(node, dirty)] : [],
      dirty,
      contentPreview: content.slice(0, 500),
    });
  }, [content, dirty, node, onCanvasContextChange]);

  if (!node) {
    return <section className="workbench-canvas__empty">选择左侧资源开始写作</section>;
  }

  const readonly = node.capabilities.readonly || !node.capabilities.edit || node.capabilities.unsupported;
  const needsHydration = resourceNeedsDetailHydration(node);
  const hydrateError = typeof node.metadata?.detailError === "string" ? node.metadata.detailError : null;

  async function handleSave() {
    if (!node || readonly || needsHydration) return;
    setSaveError(null);
    try {
      await onSave(node, content);
      setDirty(false);
    } catch (error) {
      setSaveError(saveErrorMessage(error));
    }
  }

  return (
    <section className="workbench-canvas">
      <header>
        <h2>{node.title}</h2>
        <span>{dirty ? "未保存" : "已保存"}</span>
      </header>
      {readonly ? <p>只读资源，当前画布禁用编辑。</p> : null}
      {needsHydration ? <p role="alert">章节详情未加载：正在等待详情 hydrate，禁止从空编辑器保存。</p> : null}
      {hydrateError ? <p role="alert">详情加载失败：{hydrateError}</p> : null}
      {saveError ? <p role="alert">保存失败：{saveError}</p> : null}
      {needsHydration ? null : (
        <ResourceViewer node={{ ...node, content }} onContentChange={(nextContent) => {
          setContent(nextContent);
          setDirty(true);
          setSaveError(null);
        }} />
      )}
      <button type="button" disabled={readonly || needsHydration || !dirty} onClick={handleSave}>
        保存
      </button>
    </section>
  );
}
