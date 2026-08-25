/**
 * 故事脉络（Storyline）侧栏面板 —— IA 收敛后的纯导航形态。
 *
 * 每个能力只有一个权威入口，侧栏只负责导航与轻量摘要：
 * 1. 「章节与大纲」：章节树 + 大纲树 + 一键提拔（★大纲唯一权威入口）；
 * 2. 「章后事实」：轻量摘要卡（待审/高风险计数），完整面板在中央 Tab 打开；
 * 3. 「故事画布」：单按钮打开中央画布（发展历程/双螺旋/地图在画布内切换）；
 * 4. 「伏笔账本」：点击即在中央打开全屏看板（★伏笔唯一权威入口）。
 */

import { useEffect, useState } from "react";
import { Bookmark, BookOpen, ChevronDown, ChevronRight, FilePlus2, FileText, ListTree, Map as MapIcon, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { NarrativeMemorySummary } from "../NarrativeMemoryPanel";
import { createMemoryCenterNode, createStoryProgressionNode } from "../useWorkbenchResources";
import type { ResourceTreeAction } from "../WorkbenchResourceTree";
import type { WorkbenchResourceNode } from "../useWorkbenchResources";

export interface StorylineAndPlanningSidebarPanelProps {
  bookId: string;
  chapterTreeNodes?: readonly WorkbenchResourceNode[];
  outlineTreeNodes?: readonly WorkbenchResourceNode[];
  selectedNodeId: string | null;
  onOpen: (node: WorkbenchResourceNode) => void;
  onSwitchView: (view: "write") => void;
  onAction?: (action: ResourceTreeAction) => void;
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

type StorylineSubTab = "outline" | "memory" | "canvas" | "foreshadowing";

export function StorylineAndPlanningSidebarPanel({
  bookId,
  chapterTreeNodes = [],
  outlineTreeNodes = [],
  selectedNodeId,
  onOpen,
  onSwitchView,
  onAction,
}: StorylineAndPlanningSidebarPanelProps) {
  const [activeSubTab, setActiveSubTab] = useState<StorylineSubTab>("outline");

  /** 跳转到统一的大屏「故事画布」：同一本书共用一个 Tab，画布内部切换 map/evolution/chronicle 视图。 */
  const openProgressionCanvas = (view: "map" | "evolution" | "chronicle") => {
    onOpen(createStoryProgressionNode(bookId, view));
  };

  const handleSubTabChange = (tab: StorylineSubTab) => {
    setActiveSubTab(tab);
    // 伏笔账本与故事画布都是"点击即在中央打开大屏"，侧栏只保留入口说明。
    if (tab === "foreshadowing") {
      onOpen({
        id: "tool:foreshadowing",
        kind: "tool",
        title: "伏笔看板",
        content: "",
        capabilities: { open: true, readonly: true, unsupported: false, edit: false, delete: false, apply: false },
        metadata: { toolPanel: "foreshadowing", bookId },
      });
    }
    if (tab === "canvas") {
      // 直接打开大屏画布（默认发展历程视图），消除"点了只看到一段说明文字"的空转。
      openProgressionCanvas("evolution");
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
            variant={activeSubTab === "canvas" ? "default" : "outline"}
            className={cn(
              "h-8 justify-start gap-1.5 text-[11px] font-medium transition-colors",
              activeSubTab === "canvas" ? "bg-primary text-primary-foreground shadow-xs" : "bg-card/80 text-foreground hover:bg-muted"
            )}
            onClick={() => handleSubTabChange("canvas")}
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
      </div>

      {/* 主体内容区：根据选中的 SubTab 互斥渲染 */}
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
            <NarrativeMemorySummary
              bookId={bookId}
              onOpenCenter={() => onOpen(createMemoryCenterNode(bookId))}
            />
          </div>
        )}

        {activeSubTab === "canvas" && (
          <div className="flex flex-col items-center justify-center p-6 text-center space-y-2 text-muted-foreground">
            <MapIcon className="size-8 text-primary/60" />
            <p className="text-xs font-medium text-foreground">故事画布已在中央打开</p>
            <p className="text-[11px] leading-relaxed">
              发展历程 / 双螺旋编年史 / 故事地图三个视图共用同一个画布 Tab，在画布顶部切换。
            </p>
            <Button size="xs" variant="outline" className="h-7 justify-start text-[11px]" onClick={() => openProgressionCanvas("evolution")}>
              📈 打开发展历程
            </Button>
            <Button size="xs" variant="outline" className="h-7 justify-start text-[11px]" onClick={() => openProgressionCanvas("chronicle")}>
              🧬 打开双螺旋编年史
            </Button>
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
