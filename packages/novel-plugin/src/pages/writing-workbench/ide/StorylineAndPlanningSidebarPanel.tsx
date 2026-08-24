/**
 * 故事脉络（Storyline）侧栏面板。
 *
 * 1. 「故事画布」提供大纲总览 / 故事地图 / 发展历程三个大屏画布入口，
 *    点击后在编辑区打开统一的 StoryProgressionCanvas Tab（同一本书共用一个 Tab，内部切换视图）；
 * 2. 复用 NarrativeMemoryPanel，展示章后事实、待审队列与事实纠正能力；
 * 3. 经典独立图谱入口（关系网络/时间线/矛盾冲突/故事演进/DAG 地图）保留为高级快捷方式。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Bookmark, BookOpen, ChevronDown, ChevronRight, Clock, FilePlus2, FileText, GitBranch, GitFork, ListTree, Map as MapIcon, Network, ScrollText, Sparkles, Swords } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { NarrativeMemoryPanel } from "../NarrativeMemoryPanel";
import { createStoryProgressionNode } from "../useWorkbenchResources";
import type { ResourceTreeAction } from "../WorkbenchResourceTree";
import type { WorkbenchResourceNode } from "../useWorkbenchResources";

export interface StorylineAndPlanningSidebarPanelProps {
  bookId: string;
  chapterTreeNodes?: readonly WorkbenchResourceNode[];
  outlineTreeNodes?: readonly WorkbenchResourceNode[];
  memoryNodes?: WorkbenchResourceNode[];
  foreshadowingNode?: WorkbenchResourceNode | null;
  storyMapNode?: WorkbenchResourceNode | null;
  selectedNodeId: string | null;
  onOpen: (node: WorkbenchResourceNode) => void;
  onSwitchView: (view: "write") => void;
  onAction?: (action: ResourceTreeAction) => void;
  onOpenEntityDetail?: (entity: string) => void;
}

function StorylineResourceTree({
  nodes,
  emptyLabel,
  onOpen,
  onAction,
}: {
  nodes: readonly WorkbenchResourceNode[];
  emptyLabel: string;
  onOpen: (node: WorkbenchResourceNode) => void;
  onAction?: (action: ResourceTreeAction) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(nodes.map((node) => node.id)));

  useEffect(() => {
    setExpanded((previous) => {
      const next = new Set(previous);
      for (const node of nodes) next.add(node.id);
      return next;
    });
  }, [nodes]);

  const toggle = (nodeId: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const renderNode = (node: WorkbenchResourceNode, depth = 0) => {
    const hasChildren = (node.children?.length ?? 0) > 0;
    const isExpanded = expanded.has(node.id);
    const isOutline = node.kind === "jingwei-entry" || node.kind === "story";
    return (
      <div key={node.id}>
        <div className="group/node flex items-center justify-between gap-1 rounded hover:bg-muted pr-1">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-1 rounded px-1.5 py-1 text-left text-[11px]"
            style={{ paddingLeft: `${depth * 12 + 4}px` }}
            onClick={() => (hasChildren ? toggle(node.id) : onOpen(node))}
          >
            {hasChildren ? (isExpanded ? <ChevronDown className="size-3 shrink-0" /> : <ChevronRight className="size-3 shrink-0" />) : <span className="w-3 shrink-0" />}
            {node.kind === "chapter" ? <FileText className="size-3 shrink-0 text-blue-500" /> : <ListTree className="size-3 shrink-0 text-sky-500" />}
            <span className="min-w-0 flex-1 truncate">{node.title}</span>
          </button>

          {/* 大纲节点一键提拔落稿到手稿章节 */}
          {isOutline && onAction ? (
            <button
              type="button"
              title="将大纲提拔至手稿章节"
              className="opacity-0 group-hover/node:opacity-100 size-5 flex items-center justify-center rounded text-primary hover:bg-primary/10 transition-opacity"
              onClick={(e) => {
                e.stopPropagation();
                onAction({
                  type: "promote-outline",
                  node,
                });
              }}
            >
              <FilePlus2 className="size-3" />
            </button>
          ) : null}
        </div>
        {hasChildren && isExpanded ? node.children!.map((child) => renderNode(child, depth + 1)) : null}
      </div>
    );
  };

  return nodes.length > 0 ? <div className="space-y-0.5">{nodes.map((node) => renderNode(node))}</div> : <p className="px-1 py-2 text-[10px] text-muted-foreground">{emptyLabel}</p>;
}

type StorylineSubTab = "outline" | "memory" | "graph" | "foreshadowing";

export function StorylineAndPlanningSidebarPanel({
  bookId,
  chapterTreeNodes = [],
  outlineTreeNodes = [],
  memoryNodes,
  foreshadowingNode = null,
  storyMapNode = null,
  selectedNodeId,
  onOpen,
  onSwitchView,
  onAction,
  onOpenEntityDetail,
}: StorylineAndPlanningSidebarPanelProps) {
  const [activeSubTab, setActiveSubTab] = useState<StorylineSubTab>("outline");

  const openGraphTab = useCallback(
    (view: "relationship" | "timeline" | "character_arc" | "conflict" | "event_chain", label: string) => {
      onOpen({
        id: "narrative-memory-graph",
        kind: "file",
        title: `全景图谱 · ${label}`,
        capabilities: { open: true, readonly: true, unsupported: false, edit: false, delete: false, apply: false },
        metadata: {
          isNarrativeMemoryEntry: true,
          isNarrativeMemoryGraph: true,
          preferredView: view,
        },
      });
    },
    [onOpen]
  );

  /** 跳转到统一的大屏「故事画布」：同一本书共用一个 Tab，画布内部切换 outline/map/evolution 视图。 */
  const openProgressionCanvas = useCallback(
    (view: "outline" | "map" | "evolution") => {
      onOpen(createStoryProgressionNode(bookId, view));
    },
    [bookId, onOpen]
  );

  const handleSubTabChange = (tab: StorylineSubTab) => {
    setActiveSubTab(tab);
    // 伏笔账本与故事画布都是"点击即在中央打开大屏"，侧栏只保留入口说明，不再堆叠第二份功能面板。
    if (tab === "foreshadowing" && foreshadowingNode) {
      onOpen(foreshadowingNode);
    }
    if (tab === "graph") {
      // 直接打开大屏画布（默认大纲总览视图），消除"点了只看到一段说明文字"的空转。
      openProgressionCanvas("outline");
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-card text-xs" data-testid="storyline-and-planning-panel">
      {/* 顶部子标签切换导航（带常亮高亮） */}
      <div className="shrink-0 border-b border-border bg-muted/20 p-2 space-y-2">
        <div className="flex items-center justify-between px-0.5">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
            <Sparkles className="size-3.5 text-primary" />
            <span>故事推进</span>
          </div>
          <Button size="xs" variant="ghost" className="h-6 text-[10px]" onClick={() => onSwitchView("write")}>
            <BookOpen className="size-3" />
            当前语境
          </Button>
        </div>

        {/* 4 个核心功能 Tab 切换（带明确的高亮状态） */}
        <div className="grid grid-cols-2 gap-1.5">
          <Button
            size="xs"
            variant={activeSubTab === "outline" ? "default" : "outline"}
            className={cn(
              "h-8 justify-start gap-1.5 text-[11px] font-medium transition-colors",
              activeSubTab === "outline" ? "bg-primary text-primary-foreground shadow-xs" : "bg-card/80 text-foreground hover:bg-muted"
            )}
            onClick={() => handleSubTabChange("outline")}
          >
            <ListTree className="size-3.5 text-sky-500" />
            <span className="truncate">章节与大纲</span>
          </Button>

          <Button
            size="xs"
            variant={activeSubTab === "memory" ? "default" : "outline"}
            className={cn(
              "h-8 justify-start gap-1.5 text-[11px] font-medium transition-colors",
              activeSubTab === "memory" ? "bg-primary text-primary-foreground shadow-xs" : "bg-card/80 text-foreground hover:bg-muted"
            )}
            onClick={() => handleSubTabChange("memory")}
          >
            <Sparkles className="size-3.5 text-amber-500" />
            <span className="truncate">章后事实</span>
          </Button>

          <Button
            size="xs"
            variant={activeSubTab === "graph" ? "default" : "outline"}
            className={cn(
              "h-8 justify-start gap-1.5 text-[11px] font-medium transition-colors",
              activeSubTab === "graph" ? "bg-primary text-primary-foreground shadow-xs" : "bg-card/80 text-foreground hover:bg-muted"
            )}
            onClick={() => handleSubTabChange("graph")}
          >
            <MapIcon className="size-3.5 text-primary" />
            <span className="truncate">故事画布</span>
          </Button>

          <Button
            size="xs"
            variant={activeSubTab === "foreshadowing" ? "default" : "outline"}
            className={cn(
              "h-8 justify-start gap-1.5 text-[11px] font-medium transition-colors",
              activeSubTab === "foreshadowing" ? "bg-primary text-primary-foreground shadow-xs" : "bg-card/80 text-foreground hover:bg-muted"
            )}
            onClick={() => handleSubTabChange("foreshadowing")}
          >
            <Bookmark className="size-3.5 text-indigo-500" />
            <span className="truncate">伏笔账本</span>
          </Button>
        </div>

        {/* 当处于故事画布 Tab 时：三个大屏画布主入口 + 经典独立视图快捷方式 */}
        {activeSubTab === "graph" && (
          <div className="space-y-1.5 pt-1 border-t border-border/50" data-testid="storyline-canvas-entries">
            <Button size="xs" variant="outline" className="h-7 w-full justify-start gap-1.5 text-[10px] font-medium text-emerald-700 hover:bg-emerald-600/10 dark:text-emerald-400" onClick={() => openProgressionCanvas("outline")}>
              <ListTree className="size-3 text-sky-500" />
              大纲总览画布 · 全屏编辑
            </Button>
            <Button size="xs" variant="outline" className="h-7 w-full justify-start gap-1.5 text-[10px] font-medium text-emerald-700 hover:bg-emerald-600/10 dark:text-emerald-400" onClick={() => openProgressionCanvas("map")}>
              <GitFork className="size-3 text-emerald-600" />
              故事地图画布 · 剧情节点 DAG
            </Button>
            <Button size="xs" variant="outline" className="h-7 w-full justify-start gap-1.5 text-[10px] font-medium text-emerald-700 hover:bg-emerald-600/10 dark:text-emerald-400" onClick={() => openProgressionCanvas("evolution")}>
              <ScrollText className="size-3 text-amber-500" />
              发展历程画布 · 事件与演化
            </Button>
            <details className="group mt-1">
              <summary className="flex cursor-pointer list-none items-center gap-1 rounded px-1 py-0.5 text-[10px] text-muted-foreground hover:bg-muted">
                <ChevronRight className="size-3 transition-transform group-open:rotate-90" />
                经典独立图谱视图
              </summary>
              <div className="mt-0.5 grid grid-cols-2 gap-1 pl-2">
                <Button size="xs" variant="ghost" className="h-6 justify-start gap-1 text-[10px]" onClick={() => openGraphTab("relationship", "关系网络")}>
                  <Network className="size-3 text-primary" />关系网络
                </Button>
                <Button size="xs" variant="ghost" className="h-6 justify-start gap-1 text-[10px]" onClick={() => openGraphTab("timeline", "时间线")}>
                  <Clock className="size-3 text-ring" />时间线
                </Button>
                <Button size="xs" variant="ghost" className="h-6 justify-start gap-1 text-[10px]" onClick={() => openGraphTab("conflict", "矛盾冲突")}>
                  <Swords className="size-3 text-destructive" />矛盾冲突
                </Button>
                <Button size="xs" variant="ghost" className="h-6 justify-start gap-1 text-[10px]" onClick={() => openGraphTab("event_chain", "故事演进")}>
                  <GitBranch className="size-3 text-rose-500" />故事演进
                </Button>
                {storyMapNode && (
                  <Button size="xs" variant="ghost" className="h-6 col-span-2 justify-start gap-1 text-[10px] text-emerald-600 dark:text-emerald-400" onClick={() => onOpen(storyMapNode)}>
                    <GitFork className="size-3" />独立全屏故事地图 (DAG)
                  </Button>
                )}
              </div>
            </details>
          </div>
        )}
      </div>

      {/* 主体内容区：根据选中的 SubTab 互斥渲染，不再重叠堆积 */}
      <div className="flex-1 min-h-0 overflow-y-auto p-2">
        {activeSubTab === "outline" && (
          <section id="storyline-chapter-outline" className="rounded-lg border border-border bg-card p-2 space-y-2" data-testid="storyline-chapter-outline">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold">
                <ListTree className="size-3.5 text-sky-500" />
                <span>章节与大纲</span>
              </div>
              <span className="text-[10px] text-muted-foreground">章节 {chapterTreeNodes.length} · 大纲 {outlineTreeNodes.length}</span>
            </div>
            <div className="space-y-2">
              <div>
                <div className="mb-1 text-[10px] font-medium text-muted-foreground">章节树</div>
                <StorylineResourceTree nodes={chapterTreeNodes} emptyLabel="暂无章节文件" onOpen={onOpen} onAction={onAction} />
              </div>
              <div>
                <div className="mb-1 text-[10px] font-medium text-muted-foreground">大纲</div>
                <StorylineResourceTree nodes={outlineTreeNodes} emptyLabel="暂无大纲条目" onOpen={onOpen} onAction={onAction} />
              </div>
            </div>
          </section>
        )}

        {activeSubTab === "memory" && (
          <div data-testid="storyline-memory-section">
            <NarrativeMemoryPanel
              bookId={bookId}
              memoryNodes={memoryNodes}
              selectedNodeId={selectedNodeId}
              onOpen={onOpen}
              onAction={onAction}
              onOpenEntityDetail={onOpenEntityDetail}
            />
          </div>
        )}

        {activeSubTab === "graph" && (
          <div className="flex flex-col items-center justify-center p-6 text-center space-y-2 text-muted-foreground">
            <MapIcon className="size-8 text-primary/60" />
            <p className="text-xs font-medium text-foreground">故事画布已在中央打开</p>
            <div className="grid w-full grid-cols-1 gap-1.5 pt-2">
              {([
                ["outline", "📊 大纲总览"],
                ["map", "🗺️ 故事地图"],
                ["evolution", "📈 发展历程"],
              ] as const).map(([view, label]) => (
                <Button key={view} size="xs" variant="outline" className="h-7 justify-start text-[11px]" onClick={() => openProgressionCanvas(view)}>
                  {label}
                </Button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground/70">三个视图共用同一个画布 Tab，在内部切换。</p>
          </div>
        )}

        {activeSubTab === "foreshadowing" && (
          <div className="flex flex-col items-center justify-center p-6 text-center space-y-2 text-muted-foreground">
            <Bookmark className="size-8 text-indigo-500/60" />
            <p className="text-xs font-medium text-foreground">伏笔账本</p>
            <p className="text-[11px]">已在中央编辑区打开全屏伏笔看板。</p>
          </div>
        )}
      </div>
    </div>
  );
}
