import { useState, useCallback, type ReactNode } from "react";

import { Textarea } from "@/components/ui/textarea";
import type { WorkbenchResourceKind, WorkbenchResourceNode } from "../useWorkbenchResources";

export type ResourceViewerKind =
  | "chapter"
  | "candidate"
  | "draft"
  | "story"
  | "jingwei"
  | "bible-entry"
  | "storyline"
  | "jingwei-section"
  | "jingwei-entry"
  | "narrative-line"
  | "tool-result"
  | "generic";

export interface ResourceViewerRenderOptions {
  onContentChange?: (content: string) => void;
  onTabComplete?: (currentContent: string, cursorPosition: number) => Promise<string | null>;
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

function TextBody({ node, label, onContentChange, onTabComplete }: { node: WorkbenchResourceNode; label: string; onContentChange?: (content: string) => void; onTabComplete?: ResourceViewerRenderOptions["onTabComplete"] }) {
  const readonly = node.capabilities.readonly || !node.capabilities.edit || node.capabilities.unsupported;
  const [completing, setCompleting] = useState(false);

  const handleKeyDown = useCallback(async (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Tab" || event.shiftKey || !onTabComplete || readonly || completing) return;
    event.preventDefault();
    const textarea = event.currentTarget;
    const cursorPos = textarea.selectionStart;
    const content = textarea.value;

    setCompleting(true);
    try {
      const completion = await onTabComplete(content, cursorPos);
      if (completion) {
        const before = content.slice(0, cursorPos);
        const after = content.slice(cursorPos);
        const newContent = before + completion + after;
        onContentChange?.(newContent);
        // Move cursor to end of completion
        requestAnimationFrame(() => {
          textarea.selectionStart = textarea.selectionEnd = cursorPos + completion.length;
        });
      }
    } finally {
      setCompleting(false);
    }
  }, [onTabComplete, readonly, completing, onContentChange]);

  return (
    <div className="relative">
      <Textarea aria-label={label} readOnly={readonly} value={node.content ?? ""} rows={18} onChange={(event) => onContentChange?.(event.currentTarget.value)} onKeyDown={(e) => void handleKeyDown(e)} />
      {completing && (
        <span className="absolute bottom-2 right-2 text-[10px] text-muted-foreground animate-pulse">续写中…</span>
      )}
    </div>
  );
}

function renderEditableText(node: WorkbenchResourceNode, options: ResourceViewerRenderOptions = {}) {
  const label = editableLabels[node.kind] ?? "资源正文";
  return (
    <ViewerShell node={node} label={resourceViewerRegistry[node.kind as ResourceViewerKind]?.label ?? "资源"}>
      <TextBody node={node} label={label} onContentChange={options.onContentChange} onTabComplete={options.onTabComplete} />
    </ViewerShell>
  );
}

function renderTextFile(node: WorkbenchResourceNode, options: ResourceViewerRenderOptions = {}) {
  return (
    <ViewerShell node={node} label={node.kind === "jingwei" ? "经纬资料文件" : "Story 文本文件"}>
      {node.path ? <p className="resource-viewer__path">{node.path}</p> : null}
      <TextBody node={node} label="文本文件正文" onContentChange={options.onContentChange} onTabComplete={options.onTabComplete} />
    </ViewerShell>
  );
}

function renderReadonlySummary(node: WorkbenchResourceNode) {
  const label = node.kind === "storyline" || node.kind === "narrative-line" ? "叙事线" : "经纬资料";
  const content = node.content ?? JSON.stringify(node.metadata?.snapshot ?? node.metadata?.section ?? node.metadata?.entry ?? node.metadata ?? {}, null, 2);
  return (
    <ViewerShell node={node} label={label}>
      <Textarea aria-label="只读内容" readOnly value={content} rows={12} onChange={() => undefined} />
    </ViewerShell>
  );
}

function renderGeneric(node: WorkbenchResourceNode) {
  return (
    <ViewerShell node={node} label="资源">
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <p className="text-sm text-muted-foreground">此资源类型暂不支持直接编辑</p>
        <p className="text-xs text-muted-foreground/60 mt-1">类型：{node.kind}</p>
      </div>
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

function renderCandidateText(node: WorkbenchResourceNode, options: ResourceViewerRenderOptions = {}) {
  // 候选稿默认只读展示，操作通过 CandidateActionsBar 完成
  const readonly = true;
  return (
    <ViewerShell node={node} label="候选稿">
      <Textarea
        aria-label="候选稿正文"
        readOnly={readonly}
        value={node.content ?? ""}
        rows={18}
        onChange={(event) => options.onContentChange?.(event.currentTarget.value)}
      />
    </ViewerShell>
  );
}

export const resourceViewerRegistry: Record<ResourceViewerKind, ResourceViewerDefinition> = {
  chapter: { kind: "chapter", label: "章节", render: renderEditableText },
  candidate: { kind: "candidate", label: "候选稿", render: renderCandidateText },
  draft: { kind: "draft", label: "草稿", render: renderEditableText },
  story: { kind: "story", label: "Story 文件", render: renderTextFile },
  jingwei: { kind: "jingwei", label: "经纬资料", render: renderTextFile },
  "bible-entry": { kind: "bible-entry", label: "经纬资料", render: renderReadonlySummary },
  storyline: { kind: "storyline", label: "叙事线", render: renderReadonlySummary },
  "jingwei-section": { kind: "jingwei-section", label: "经纬分区", render: renderReadonlySummary },
  "jingwei-entry": { kind: "jingwei-entry", label: "经纬条目", render: renderReadonlySummary },
  "narrative-line": { kind: "narrative-line", label: "叙事线", render: renderReadonlySummary },
  "tool-result": { kind: "tool-result", label: "工具结果", render: renderToolResult },
  generic: { kind: "generic", label: "通用资源", render: renderGeneric },
};

const viewerKinds = new Set<WorkbenchResourceKind | ResourceViewerKind>([
  "chapter",
  "candidate",
  "draft",
  "story",
  "jingwei",
  "bible-entry",
  "storyline",
  "jingwei-section",
  "jingwei-entry",
  "narrative-line",
  "tool-result",
]);

export function getResourceViewer(node: WorkbenchResourceNode): ResourceViewerDefinition {
  if (!viewerKinds.has(node.kind) || node.capabilities.unsupported) {
    return resourceViewerRegistry.generic;
  }

  return resourceViewerRegistry[node.kind as ResourceViewerKind] ?? resourceViewerRegistry.generic;
}

export function ResourceViewer({ node, onContentChange, onTabComplete }: { node: WorkbenchResourceNode; onContentChange?: (content: string) => void; onTabComplete?: ResourceViewerRenderOptions["onTabComplete"] }) {
  return <>{getResourceViewer(node).render(node, { onContentChange, onTabComplete })}</>;
}
