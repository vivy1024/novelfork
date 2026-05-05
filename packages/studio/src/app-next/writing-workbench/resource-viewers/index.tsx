import type { ReactNode } from "react";

import type { WorkbenchResourceKind, WorkbenchResourceNode } from "../useWorkbenchResources";

export type ResourceViewerKind =
  | "chapter"
  | "candidate"
  | "draft"
  | "story"
  | "truth"
  | "bible-entry"
  | "storyline"
  | "tool-result"
  | "generic";

export interface ResourceViewerRenderOptions {
  onContentChange?: (content: string) => void;
}

export interface ResourceViewerDefinition {
  kind: ResourceViewerKind;
  label: string;
  render: (node: WorkbenchResourceNode, options?: ResourceViewerRenderOptions) => ReactNode;
}

const editableLabels: Record<string, string> = {
  chapter: "章节正文",
  candidate: "候选稿正文",
  draft: "草稿正文",
};

function CapabilityNotice({ node }: { node: WorkbenchResourceNode }) {
  return (
    <div className="resource-viewer__capabilities" aria-label="资源能力">
      {node.capabilities.readonly ? <span>只读资源</span> : null}
      {node.capabilities.unsupported ? <span>不支持的资源类型</span> : null}
      {node.capabilities.apply ? <span>可应用</span> : null}
    </div>
  );
}

function ViewerShell({ node, label, children }: { node: WorkbenchResourceNode; label: string; children: ReactNode }) {
  return (
    <section className="resource-viewer" data-resource-kind={node.kind}>
      <header className="resource-viewer__header">
        <p>{label}</p>
        <h2>{node.title}</h2>
        <CapabilityNotice node={node} />
      </header>
      {children}
    </section>
  );
}

function TextBody({ node, label, onContentChange }: { node: WorkbenchResourceNode; label: string; onContentChange?: (content: string) => void }) {
  const readonly = node.capabilities.readonly || !node.capabilities.edit || node.capabilities.unsupported;

  return <textarea aria-label={label} readOnly={readonly} value={node.content ?? ""} rows={18} onChange={(event) => onContentChange?.(event.currentTarget.value)} />;
}

function renderEditableText(node: WorkbenchResourceNode, options: ResourceViewerRenderOptions = {}) {
  const label = editableLabels[node.kind] ?? "资源正文";
  return (
    <ViewerShell node={node} label={resourceViewerRegistry[node.kind as ResourceViewerKind]?.label ?? "资源"}>
      <TextBody node={node} label={label} onContentChange={options.onContentChange} />
    </ViewerShell>
  );
}

function renderTextFile(node: WorkbenchResourceNode, options: ResourceViewerRenderOptions = {}) {
  return (
    <ViewerShell node={node} label={node.kind === "truth" ? "Truth 文本文件" : "Story 文本文件"}>
      {node.path ? <p className="resource-viewer__path">{node.path}</p> : null}
      <TextBody node={node} label="文本文件正文" onContentChange={options.onContentChange} />
    </ViewerShell>
  );
}

function renderReadonlySummary(node: WorkbenchResourceNode) {
  return (
    <ViewerShell node={node} label={node.kind === "storyline" ? "叙事线" : "经纬资料"}>
      <textarea aria-label="只读内容" readOnly value={node.content ?? ""} rows={12} onChange={() => undefined} />
    </ViewerShell>
  );
}

function renderGeneric(node: WorkbenchResourceNode) {
  return (
    <ViewerShell node={node} label="通用资源">
      <pre data-testid="raw-resource-node">{JSON.stringify(node, null, 2)}</pre>
    </ViewerShell>
  );
}

function renderToolResult(node: WorkbenchResourceNode) {
  return (
    <ViewerShell node={node} label="工具结果">
      <pre data-testid="raw-resource-node">{node.content ?? JSON.stringify(node.metadata ?? {}, null, 2)}</pre>
    </ViewerShell>
  );
}

export const resourceViewerRegistry: Record<ResourceViewerKind, ResourceViewerDefinition> = {
  chapter: { kind: "chapter", label: "章节", render: renderEditableText },
  candidate: { kind: "candidate", label: "候选稿", render: renderEditableText },
  draft: { kind: "draft", label: "草稿", render: renderEditableText },
  story: { kind: "story", label: "Story 文件", render: renderTextFile },
  truth: { kind: "truth", label: "Truth 文件", render: renderTextFile },
  "bible-entry": { kind: "bible-entry", label: "经纬资料", render: renderReadonlySummary },
  storyline: { kind: "storyline", label: "叙事线", render: renderReadonlySummary },
  "tool-result": { kind: "tool-result", label: "工具结果", render: renderToolResult },
  generic: { kind: "generic", label: "通用资源", render: renderGeneric },
};

const viewerKinds = new Set<WorkbenchResourceKind | ResourceViewerKind>([
  "chapter",
  "candidate",
  "draft",
  "story",
  "truth",
  "bible-entry",
  "storyline",
  "tool-result",
]);

export function getResourceViewer(node: WorkbenchResourceNode): ResourceViewerDefinition {
  if (!viewerKinds.has(node.kind) || node.capabilities.unsupported) {
    return resourceViewerRegistry.generic;
  }

  return resourceViewerRegistry[node.kind as ResourceViewerKind] ?? resourceViewerRegistry.generic;
}

export function ResourceViewer({ node, onContentChange }: { node: WorkbenchResourceNode; onContentChange?: (content: string) => void }) {
  return <>{getResourceViewer(node).render(node, { onContentChange })}</>;
}
