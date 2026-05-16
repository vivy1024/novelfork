import { useCallback, useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BookOpen, GitBranch, History, Home } from "lucide-react";
import { WorkbenchCanvas, type WorkbenchCanvasContext, type CandidateActionHandlers, type JingweiActionHandlers } from "./WorkbenchCanvas";
import { WorkbenchResourceTree } from "./WorkbenchResourceTree";
import { CheckpointPanel, type CheckpointEntry } from "./CheckpointPanel";
import { JingweiPanel } from "./jingwei/JingweiPanel";
import type { WorkbenchResourceNode } from "./useWorkbenchResources";
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
  writingActions?: ReactNode;
  /** 引导完成后刷新资源树 */
  onGuideComplete?: () => void;
  /** 候选稿操作回调 */
  candidateActions?: CandidateActionHandlers;
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

export function WritingWorkbenchRoute({ bookId, repositoryPath, nodes, selectedNode, onOpen, onDeselectNode, onSave, onCanvasContextChange, onCreateChapter, writingActions, onGuideComplete, candidateActions, jingweiActions, chapters, chapterEdges, onChapterSelect }: WritingWorkbenchRouteProps) {
  const bookTitle = deriveBookTitle(bookId, nodes);
  const statusLabel = routeStatusLabel(nodes, selectedNode);
  const [viewMode, setViewMode] = useState<"tree" | "graph">("tree");
  const [showCheckpoints, setShowCheckpoints] = useState(false);
  const [checkpoints, setCheckpoints] = useState<CheckpointEntry[]>([]);
  const [checkpointsLoading, setCheckpointsLoading] = useState(false);
  const [showJingwei, setShowJingwei] = useState(false);
  const hasGraphData = chapters && chapters.length > 0;
  const currentChapter = selectedNode?.kind === "chapter" ? (selectedNode.metadata as { chapterNumber?: number })?.chapterNumber : undefined;

  /** Intercept resource tree clicks: jingwei nodes deselect to show graph workspace */
  const handleResourceOpen = useCallback((node: WorkbenchResourceNode) => {
    if (node.id === "jingwei-panel-entry" || node.kind === "jingwei" || node.kind === "jingwei-section" || node.kind === "jingwei-entry") {
      // 取消选中，回到画布默认视图（经纬图谱工作区）
      if (onDeselectNode) {
        onDeselectNode();
      } else {
        // fallback: 打开经纬面板 Dialog
        setShowJingwei(true);
      }
      return;
    }
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
            <WorkbenchResourceTree nodes={nodes} selectedNodeId={selectedNode?.id} onOpen={handleResourceOpen} onAction={async (action) => {
              const nodeId = action.node?.id ?? "";
              if (action.type === "create") {
                const title = prompt("新建条目标题：");
                if (!title?.trim()) return;
                try {
                  const res = await fetch(`/api/books/${encodeURIComponent(bookId ?? "")}/jingwei/entries`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ parentId: nodeId, title: title.trim(), content: `# ${title.trim()}\n\n` }),
                  });
                  if (res.ok) window.location.reload();
                } catch { /* non-fatal */ }
              } else if (action.type === "delete") {
                if (!confirm("确定删除此条目？")) return;
                try {
                  await fetch(`/api/books/${encodeURIComponent(bookId ?? "")}/jingwei/entries/${encodeURIComponent(nodeId)}`, { method: "DELETE" });
                  window.location.reload();
                } catch { /* non-fatal */ }
              } else if (action.type === "rename") {
                const newTitle = prompt("新标题：");
                if (!newTitle?.trim()) return;
                try {
                  await fetch(`/api/books/${encodeURIComponent(bookId ?? "")}/jingwei/entries/${encodeURIComponent(nodeId)}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ title: newTitle.trim() }),
                  });
                  window.location.reload();
                } catch { /* non-fatal */ }
              }
            }} />
          </section>
          {/* 右侧编辑区 */}
          <div className="flex flex-1 min-w-0 flex-col">
            <section aria-label="当前资源画布" className="min-h-0 flex-1">
              <WorkbenchCanvas node={selectedNode} nodes={nodes} bookId={bookId} onSave={onSave} onCanvasContextChange={onCanvasContextChange} onGuideComplete={onGuideComplete} candidateActions={candidateActions} jingweiActions={jingweiActions} />
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

      {/* Jingwei Panel Dialog */}
      <Dialog open={showJingwei} onOpenChange={setShowJingwei}>
        <DialogContent className="max-w-4xl h-[70vh] p-0 overflow-hidden">
          <DialogHeader className="px-4 pt-3 pb-0">
            <DialogTitle>经纬资料管理</DialogTitle>
          </DialogHeader>
          {bookId && (
            <div className="flex-1 min-h-0 h-full">
              <JingweiPanel bookId={bookId} />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
