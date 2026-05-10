import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { BookOpen, GitBranch, Wrench } from "lucide-react";
import { WorkbenchCanvas, type WorkbenchCanvasContext, type CandidateActionHandlers, type JingweiActionHandlers } from "./WorkbenchCanvas";
import { WorkbenchResourceTree } from "./WorkbenchResourceTree";
import { WritingToolsPanel } from "./WritingToolsPanel";
import type { WorkbenchResourceNode } from "./useWorkbenchResources";
import { ChapterGraph, type ChapterGraphChapter, type ChapterGraphEdge } from "../chapter-graph";

export interface WritingWorkbenchRouteProps {
  bookId?: string;
  nodes: readonly WorkbenchResourceNode[];
  selectedNode: WorkbenchResourceNode | null;
  onOpen: (node: WorkbenchResourceNode) => void;
  onSave: (node: WorkbenchResourceNode, content: string) => Promise<void> | void;
  onCanvasContextChange?: (context: WorkbenchCanvasContext) => void;
  onCreateChapter?: () => void;
  writingActions?: ReactNode;
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

export function WritingWorkbenchRoute({ bookId, nodes, selectedNode, onOpen, onSave, onCanvasContextChange, onCreateChapter, writingActions, candidateActions, jingweiActions, chapters, chapterEdges, onChapterSelect }: WritingWorkbenchRouteProps) {
  const bookTitle = deriveBookTitle(bookId, nodes);
  const statusLabel = routeStatusLabel(nodes, selectedNode);
  const [viewMode, setViewMode] = useState<"tree" | "graph">("tree");
  const [showToolsPanel, setShowToolsPanel] = useState(false);
  const hasGraphData = chapters && chapters.length > 0;
  const currentChapter = selectedNode?.kind === "chapter" ? (selectedNode.metadata as { chapterNumber?: number })?.chapterNumber : undefined;

  return (
    <div className="flex h-full w-full flex-col min-h-0" data-testid="writing-workbench-route" data-book-id={bookId}>
      {/* 顶部标题栏 */}
      <header className="shrink-0 border-b border-border px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BookOpen className="size-5 text-primary" />
            <div>
              <h1 className="text-lg font-semibold">{bookTitle}</h1>
              <p className="text-xs text-muted-foreground">{statusLabel}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
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
            {/* 写作动作 + 新建章节 */}
            {writingActions && (
              <section aria-label="写作动作" className="flex items-center gap-2">
                {writingActions}
              </section>
            )}
            {onCreateChapter && (
              <Button size="xs" variant="outline" onClick={onCreateChapter}>
                + 新建章节
              </Button>
            )}
            {bookId && (
              <Button size="xs" variant={showToolsPanel ? "default" : "outline"} onClick={() => setShowToolsPanel(!showToolsPanel)}>
                <Wrench className="size-3 mr-1" />
                写作工具
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
            <WorkbenchResourceTree nodes={nodes} selectedNodeId={selectedNode?.id} onOpen={onOpen} />
          </section>
          {/* 右侧编辑区 */}
          <div className="flex flex-1 min-w-0 flex-col">
            <section aria-label="当前资源画布" className={`min-h-0 ${showToolsPanel ? "flex-[2]" : "flex-1"}`}>
              <WorkbenchCanvas node={selectedNode} nodes={nodes} bookId={bookId} onSave={onSave} onCanvasContextChange={onCanvasContextChange} candidateActions={candidateActions} jingweiActions={jingweiActions} />
            </section>
            {showToolsPanel && bookId && (
              <section aria-label="写作工具面板" className="flex-1 min-h-0 border-t border-border overflow-y-auto p-3">
                <WritingToolsPanel bookId={bookId} currentChapter={currentChapter} chapterContent={selectedNode?.content ?? ""} onRunTool={async () => ({})} />
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
