import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { BookOpen, GitBranch, History, Home } from "lucide-react";
import { WorkbenchCanvas, type WorkbenchCanvasContext, type CandidateActionHandlers, type DraftActionHandlers, type ChapterActionHandlers, type JingweiActionHandlers } from "./WorkbenchCanvas";
import { WorkbenchResourceTree } from "./WorkbenchResourceTree";
import { CheckpointPanel, type CheckpointEntry } from "./CheckpointPanel";
import type { WorkbenchResourceNode } from "./useWorkbenchResources";
import { createToolSectionNodes } from "./useWorkbenchResources";
import { ChapterGraph, type ChapterGraphChapter, type ChapterGraphEdge } from "@/app-next/chapter-graph";

export interface WritingWorkbenchRouteProps {
  bookId?: string;
  repositoryPath?: string;
  nodes: readonly WorkbenchResourceNode[];
  selectedNode: WorkbenchResourceNode | null;
  onOpen: (node: WorkbenchResourceNode) => void;
  onDeselectNode?: () => void;
  onSave: (node: WorkbenchResourceNode, content: string) => Promise<void> | void;
  onCanvasContextChange?: (context: WorkbenchCanvasContext) => void;
  onCreateChapter?: () => void;
  /** 引导完成后刷新资源树 */
  onGuideComplete?: () => void;
  /** 候选稿操作回调 */
  candidateActions?: CandidateActionHandlers;
  /** 草稿操作回调 */
  draftActions?: DraftActionHandlers;
  /** 章节操作回调 */
  chapterActions?: ChapterActionHandlers;
  /** 经纬资料操作回调 */
  jingweiActions?: JingweiActionHandlers;
  /** 章节图数据（用于图视图） */
  chapters?: ChapterGraphChapter[];
  chapterEdges?: ChapterGraphEdge[];
  onChapterSelect?: (chapterId: string) => void;
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

export function WritingWorkbenchRoute({ bookId, repositoryPath, nodes, selectedNode, onOpen, onDeselectNode, onSave, onCanvasContextChange, onCreateChapter, onGuideComplete, candidateActions, draftActions, chapterActions, jingweiActions, chapters, chapterEdges, onChapterSelect }: WritingWorkbenchRouteProps) {
  const bookTitle = deriveBookTitle(bookId, nodes);
  const statusLabel = routeStatusLabel(nodes, selectedNode);
  const [viewMode, setViewMode] = useState<"tree" | "graph">("tree");
  const [showCheckpoints, setShowCheckpoints] = useState(false);
  const [checkpoints, setCheckpoints] = useState<CheckpointEntry[]>([]);
  const [checkpointsLoading, setCheckpointsLoading] = useState(false);
  const hasGraphData = chapters && chapters.length > 0;

  // Dialog state for resource tree actions (replacing native prompt/confirm)
  const [dialogType, setDialogType] = useState<"create" | "rename" | "delete" | null>(null);
  const [dialogNodeId, setDialogNodeId] = useState("");
  const [dialogInputValue, setDialogInputValue] = useState("");
  const dialogInputRef = useRef<HTMLInputElement>(null);

  const closeDialog = useCallback(() => {
    setDialogType(null);
    setDialogNodeId("");
    setDialogInputValue("");
  }, []);

  const handleDialogConfirm = useCallback(async () => {
    if (!bookId) return;
    try {
      if (dialogType === "create") {
        if (!dialogInputValue.trim()) return;
        const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/jingwei/entries`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ parentId: dialogNodeId, title: dialogInputValue.trim(), content: `# ${dialogInputValue.trim()}\n\n` }),
        });
        if (res.ok) onGuideComplete?.();
      } else if (dialogType === "rename") {
        if (!dialogInputValue.trim()) return;
        await fetch(`/api/books/${encodeURIComponent(bookId)}/jingwei/entries/${encodeURIComponent(dialogNodeId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: dialogInputValue.trim() }),
        });
        onGuideComplete?.();
      } else if (dialogType === "delete") {
        await fetch(`/api/books/${encodeURIComponent(bookId)}/jingwei/entries/${encodeURIComponent(dialogNodeId)}`, { method: "DELETE" });
        onGuideComplete?.();
      }
    } catch { /* non-fatal */ }
    closeDialog();
  }, [bookId, dialogType, dialogNodeId, dialogInputValue, onGuideComplete, closeDialog]);

  // Merge tool section into the resource tree
  const nodesWithTools = useMemo(() => {
    const toolSection = createToolSectionNodes();
    return [...nodes, toolSection];
  }, [nodes]);

  /** Intercept resource tree clicks: jingwei nodes → 回到默认视图（JingweiPanel 全屏） */
  const handleResourceOpen = useCallback((node: WorkbenchResourceNode) => {
    if (node.id === "jingwei-panel-entry" || node.kind === "jingwei" || node.kind === "jingwei-section" || node.kind === "jingwei-entry") {
      // 取消选中，回到默认画布视图（现在是 JingweiPanel 全屏）
      if (onDeselectNode) {
        onDeselectNode();
      }
      return;
    }
    // 其他节点正常打开
    onOpen(node);
  }, [onOpen, onDeselectNode]);

  const loadCheckpoints = useCallback(async () => {
    if (!bookId) return;
    setCheckpointsLoading(true);
    try {
      const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/checkpoints`);
      if (res.ok) {
        const data = await res.json();
        setCheckpoints(Array.isArray(data.checkpoints) ? data.checkpoints : Array.isArray(data) ? data : []);
      }
    } finally {
      setCheckpointsLoading(false);
    }
  }, [bookId]);

  useEffect(() => { if (showCheckpoints) void loadCheckpoints(); }, [showCheckpoints, loadCheckpoints]);

  return (
    <div className="flex h-full w-full flex-col min-h-0" data-testid="writing-workbench-route" data-book-id={bookId}>
      {/* 顶部标题栏 */}
      <header className="shrink-0 border-b border-border px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BookOpen className="size-5 text-primary" />
            <div>
              <h1 className="text-lg font-semibold">{bookTitle}</h1>
              <p className="text-xs text-muted-foreground">{repositoryPath ? `📁 ${repositoryPath}` : statusLabel}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* 返回总览 */}
            {selectedNode && onDeselectNode && (
              <Button size="xs" variant="ghost" onClick={onDeselectNode} title="返回总览/引导">
                <Home className="size-3 mr-1" />
                总览
              </Button>
            )}
            {/* 视图切换 */}
            <div className="flex gap-0.5 rounded-lg border border-border p-0.5">
              <Button
                variant={viewMode === "tree" ? "default" : "ghost"}
                size="xs"
                onClick={() => setViewMode("tree")}
              >
                资源树
              </Button>
              <Button
                variant={viewMode === "graph" ? "default" : "ghost"}
                size="xs"
                onClick={() => setViewMode("graph")}
                disabled={!hasGraphData}
                title={hasGraphData ? "章节图视图" : "暂无章节数据"}
              >
                <GitBranch className="size-3" />
                章节图
              </Button>
            </div>
            {/* 新建章节保留 */}
            {onCreateChapter && (
              <Button size="xs" variant="outline" onClick={onCreateChapter}>
                + 新建章节
              </Button>
            )}
            {bookId && (
              <Button size="xs" variant={showCheckpoints ? "default" : "outline"} onClick={() => setShowCheckpoints(!showCheckpoints)}>
                <History className="size-3 mr-1" />
                快照
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* 内容区 */}
      {viewMode === "graph" && hasGraphData ? (
        <section aria-label="章节图" className="flex-1 min-h-0">
          <ChapterGraph chapters={chapters} edges={chapterEdges ?? []} onChapterSelect={onChapterSelect} />
        </section>
      ) : (
        <div className="flex flex-1 min-h-0">
          {/* 左侧资源树 */}
          <section aria-label="资源树" className="w-64 shrink-0 border-r border-border overflow-y-auto p-2">
            <WorkbenchResourceTree nodes={nodesWithTools} selectedNodeId={selectedNode?.id} onOpen={handleResourceOpen} onAction={(action) => {
              const nodeId = action.node?.id ?? "";
              if (action.type === "create") {
                setDialogNodeId(nodeId);
                setDialogInputValue("");
                setDialogType("create");
              } else if (action.type === "delete") {
                setDialogNodeId(nodeId);
                setDialogType("delete");
              } else if (action.type === "rename") {
                setDialogNodeId(nodeId);
                setDialogInputValue(action.node?.title ?? "");
                setDialogType("rename");
              }
            }} />
          </section>
          {/* 右侧编辑区 */}
          <div className="flex flex-1 min-w-0 flex-col">
            <section aria-label="当前资源画布" className="min-h-0 flex-1">
              <WorkbenchCanvas node={selectedNode} nodes={nodes} bookId={bookId} onSave={onSave} onCanvasContextChange={onCanvasContextChange} onGuideComplete={onGuideComplete} candidateActions={candidateActions} draftActions={draftActions} chapterActions={chapterActions} jingweiActions={jingweiActions} />
            </section>
            {showCheckpoints && bookId && (
              <section aria-label="快照与回滚" className="flex-1 min-h-0 border-t border-border overflow-y-auto p-3">
                <CheckpointPanel
                  checkpoints={checkpoints}
                  loading={checkpointsLoading}
                  onPreviewRewind={async (id) => {
                    const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/checkpoints/${encodeURIComponent(id)}/rewind/preview`);
                    if (!res.ok) throw new Error("预览失败");
                    return res.json();
                  }}
                  onApplyRewind={async (id) => {
                    const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/checkpoints/${encodeURIComponent(id)}/rewind/apply`, { method: "POST" });
                    if (!res.ok) throw new Error("回滚失败");
                  }}
                  onRefresh={loadCheckpoints}
                />
              </section>
            )}
          </div>
        </div>
      )}

      {/* Dialog for resource tree actions (create/rename/delete) */}
      <Dialog open={dialogType === "create" || dialogType === "rename"} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialogType === "create" ? "新建条目" : "重命名"}</DialogTitle>
            <DialogDescription>{dialogType === "create" ? "请输入新条目的标题" : "请输入新的标题"}</DialogDescription>
          </DialogHeader>
          <Input
            ref={dialogInputRef}
            value={dialogInputValue}
            onChange={(e) => setDialogInputValue(e.target.value)}
            placeholder={dialogType === "create" ? "条目标题" : "新标题"}
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") void handleDialogConfirm(); }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>取消</Button>
            <Button onClick={() => void handleDialogConfirm()} disabled={!dialogInputValue.trim()}>确定</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogType === "delete"} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>确定要删除此条目吗？此操作不可撤销。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>取消</Button>
            <Button variant="destructive" onClick={() => void handleDialogConfirm()}>删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
