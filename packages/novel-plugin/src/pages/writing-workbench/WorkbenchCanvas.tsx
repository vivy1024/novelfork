import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Save, FileText, AlertCircle, Loader2 } from "lucide-react";
import { resourceNeedsDetailHydration } from "./ResourceDetailLoader";
import { ResourceViewer } from "./resource-viewers";
import { CandidateActionsBar, type CandidateAcceptAction } from "./CandidateActionsBar";

import { JingweiEntryEditor } from "./JingweiEntryEditor";
import { JingweiPanel } from "./jingwei/JingweiPanel";
import { StatusBar } from "./StatusBar";
import { ExpandablePanel, type PanelType } from "./ExpandablePanel";
import type { CanvasContext, OpenResourceTab, WorkspaceResourceRef, WorkspaceResourceViewKind } from "@/shared/agent-native-workspace";
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
    case "jingwei":
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

const resourceTypeLabels: Partial<Record<WorkbenchResourceKind, string>> = {
  chapter: "章节",
  candidate: "候选稿",
  draft: "草稿",
  story: "大纲与设定",
  jingwei: "经纬资料",
  "jingwei-section": "经纬分区",
  "jingwei-entry": "经纬条目",
  "bible-entry": "经纬资料",
  "narrative-line": "叙事线",
  storyline: "叙事线",
  "tool-result": "工具结果",
  unsupported: "不支持",
};

function resourceTypeLabel(kind: WorkbenchResourceKind): string {
  return resourceTypeLabels[kind] ?? kind;
}

export interface CandidateActionHandlers {
  onAccept: (candidateId: string, action: CandidateAcceptAction) => Promise<void>;
  onReject: (candidateId: string) => Promise<void>;
  onArchive: (candidateId: string) => Promise<void>;
  onDelete: (candidateId: string) => Promise<void>;
}

export interface JingweiActionHandlers {
  onSave: (entryId: string, payload: { title: string; contentMd: string }) => Promise<void>;
  onDelete?: (entryId: string) => Promise<void>;
}

export interface WorkbenchCanvasProps {
  node: WorkbenchResourceNode | null;
  nodes?: readonly WorkbenchResourceNode[];
  bookId?: string;
  onSave: (node: WorkbenchResourceNode, content: string) => Promise<void> | void;
  onCanvasContextChange?: (context: WorkbenchCanvasContext) => void;
  onGuideComplete?: () => void;
  candidateActions?: CandidateActionHandlers;
  jingweiActions?: JingweiActionHandlers;
}

export function WorkbenchCanvas({ node, nodes = [], bookId, onSave, onCanvasContextChange = () => undefined, onGuideComplete, candidateActions, jingweiActions }: WorkbenchCanvasProps) {
  const [content, setContent] = useState(node?.content ?? "");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
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
    if (bookId) {
      return <DefaultCockpitView bookId={bookId} />;
    }
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p>请先选择或创建一本作品</p>
      </div>
    );
  }

  const readonly = node.capabilities.readonly || !node.capabilities.edit || node.capabilities.unsupported;
  const needsHydration = resourceNeedsDetailHydration(node);
  const hydrateError = typeof node.metadata?.detailError === "string" ? node.metadata.detailError : null;

  async function handleSave() {
    if (!node || readonly || needsHydration || saving) return;
    setSaveError(null);
    setSaving(true);
    try {
      await onSave(node, content);
      setDirty(false);
    } catch (error) {
      setSaveError(saveErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full flex-col min-h-0">
      {/* Header */}
      <header className="shrink-0 flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-sm font-semibold truncate">{node.title}</h2>
          <Badge variant="secondary" className="text-[10px] shrink-0">{resourceTypeLabel(node.kind)}</Badge>
          {readonly && <Badge variant="outline" className="text-[10px] shrink-0">只读</Badge>}
          {dirty && <Badge className="text-[10px] shrink-0 bg-yellow-500/10 text-yellow-600 border-yellow-500/20">未保存</Badge>}
          {!dirty && !needsHydration && !readonly && <span className="text-[10px] text-muted-foreground">已保存</span>}
        </div>
        <div className="flex items-center gap-2">
          {saveError && <span className="text-xs text-destructive truncate max-w-48">{saveError}</span>}
          <Button
            size="sm"
            disabled={readonly || needsHydration || !dirty || saving}
            onClick={handleSave}
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            <span className="ml-1">保存</span>
          </Button>
        </div>
      </header>

      {/* Alerts */}
      {needsHydration && (
        <div className="shrink-0 flex items-center gap-2 bg-yellow-50 dark:bg-yellow-900/10 px-4 py-2 text-xs text-yellow-700 dark:text-yellow-300">
          <Loader2 className="size-3.5 animate-spin" />
          正在加载内容...
        </div>
      )}
      {hydrateError && (
        <div className="shrink-0 flex items-center gap-2 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          <AlertCircle className="size-3.5" />
          加载失败：{hydrateError}
        </div>
      )}

      {/* Candidate actions bar */}
      {node.kind === "candidate" && candidateActions && (
        <div className="shrink-0 border-b border-border px-4 py-2">
          <CandidateActionsBar
            candidateId={String(node.metadata?.candidateId ?? node.id.replace("candidate:", ""))}
            bookId={String(node.metadata?.bookId ?? "")}
            status={(node.metadata?.status as "candidate" | "accepted" | "rejected" | "archived") ?? "candidate"}
            source={typeof node.metadata?.source === "string" ? node.metadata.source : undefined}
            targetChapterId={typeof node.metadata?.targetChapterId === "string" ? node.metadata.targetChapterId : undefined}
            createdAt={typeof node.metadata?.createdAt === "string" ? node.metadata.createdAt : undefined}
            onAccept={candidateActions.onAccept}
            onReject={candidateActions.onReject}
            onArchive={candidateActions.onArchive}
            onDelete={candidateActions.onDelete}
          />
        </div>
      )}

      {/* Editor */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {needsHydration ? null : (node.kind === "jingwei-entry" || node.kind === "bible-entry") && jingweiActions && !node.metadata?.fileName ? (
          <JingweiEntryEditor
            entry={{
              id: String(node.metadata?.entryId ?? node.id.replace("jingwei-entry:", "")),
              title: node.title,
              contentMd: content,
              sectionId: typeof node.metadata?.sectionId === "string" ? node.metadata.sectionId : undefined,
              updatedAt: typeof node.metadata?.updatedAt === "string" ? node.metadata.updatedAt : undefined,
            }}
            onSave={jingweiActions.onSave}
            onDelete={jingweiActions.onDelete}
          />
        ) : (
          <ResourceViewer node={{ ...node, content }} bookId={bookId} onContentChange={(nextContent) => {
            setContent(nextContent);
            setDirty(true);
            setSaveError(null);
          }} onTabComplete={bookId && (node.kind === "chapter" || node.kind === "candidate" || node.kind === "draft") ? async (currentContent, cursorPosition) => {
            const contextBefore = currentContent.slice(Math.max(0, cursorPosition - 500), cursorPosition);
            try {
              const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/inline-write`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mode: "continuation", context: contextBefore, maxTokens: 80 }),
              });
              if (!res.ok) return null;
              const data = await res.json();
              return data.text ?? data.content ?? null;
            } catch { return null; }
          } : undefined} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DefaultCockpitView — JingweiPanel + 底部 StatusBar + 可展开面板
// ---------------------------------------------------------------------------

function DefaultCockpitView({ bookId }: { bookId: string }) {
  const [activePanel, setActivePanel] = useState<PanelType>(null);
  const [panelHeight, setPanelHeight] = useState<number>(320);
  const [panelMaximized, setPanelMaximized] = useState(false);

  const handleStatusBarClick = useCallback((panel: NonNullable<PanelType>) => {
    setActivePanel((prev) => (prev === panel ? null : panel));
    setPanelMaximized(false);
  }, []);

  const handlePanelClose = useCallback(() => {
    setActivePanel(null);
    setPanelMaximized(false);
  }, []);

  const handlePanelMaximize = useCallback(() => {
    setPanelMaximized((prev) => !prev);
  }, []);

  return (
    <div className="flex h-full flex-col min-h-0">
      {/* 主区域：JingweiPanel */}
      {!panelMaximized && (
        <div className="flex-1 min-h-0">
          <JingweiPanel bookId={bookId} />
        </div>
      )}

      {/* 可展开面板 */}
      {activePanel && (
        <ExpandablePanel
          activePanel={activePanel}
          height={panelMaximized ? undefined : panelHeight}
          maximized={panelMaximized}
          bookId={bookId}
          onClose={handlePanelClose}
          onMaximize={handlePanelMaximize}
          onHeightChange={setPanelHeight}
          onSwitchPanel={setActivePanel}
        />
      )}

      {/* 底部状态条 */}
      <StatusBar
        bookId={bookId}
        activePanel={activePanel}
        onPanelClick={handleStatusBarClick}
      />
    </div>
  );
}
