/**
 * 故事脉络（Storyline）侧栏面板。
 *
 * 1. 提供关系网络、时间线、矛盾地图三个全景图谱入口，点击后在编辑区打开图谱 Tab；
 * 2. 复用 NarrativeMemoryPanel，展示章后事实、待审队列与事实纠正能力。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Bookmark, BookOpen, ChevronDown, ChevronRight, Clock, FilePlus2, FileText, GitBranch, GitFork, ListTree, Network, Sparkles, Swords } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NarrativeMemoryPanel } from "../NarrativeMemoryPanel";
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

  const memorySectionRef = useRef<HTMLDivElement>(null);
  const scrollToMemory = useCallback(() => {
    memorySectionRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-card text-xs" data-testid="storyline-and-planning-panel">
      <div className="shrink-0 border-b border-border bg-muted/15 p-2 space-y-2">
        <div className="flex items-center justify-between px-0.5">
          <div>
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
              <Sparkles className="size-3.5 text-primary" />
              <span>故事支撑</span>
            </div>
            <p className="mt-0.5 text-[10px] text-muted-foreground">写作前看方向，写作后看变化。</p>
          </div>
          <Button size="xs" variant="ghost" className="h-6 text-[10px]" onClick={() => onSwitchView("write")}>
            <BookOpen className="size-3" />
            当前语境
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <Button
            size="xs"
            variant="outline"
            className="h-8 justify-start gap-1.5 bg-card/80 text-[10px]"
            disabled={!storyMapNode}
            onClick={() => { if (storyMapNode) onOpen(storyMapNode); }}
          >
            <GitFork className="size-3.5 text-emerald-500" />
            <span className="truncate">故事主支线</span>
          </Button>
          <Button
            size="xs"
            variant="outline"
            className="h-8 justify-start gap-1.5 bg-card/80 text-[10px]"
            onClick={() => document.getElementById("storyline-chapter-outline")?.scrollIntoView({ block: "start", behavior: "smooth" })}
          >
            <ListTree className="size-3.5 text-sky-500" />
            <span className="truncate">章节与大纲</span>
          </Button>
          <Button
            size="xs"
            variant="outline"
            className="h-8 justify-start gap-1.5 bg-card/80 text-[10px]"
            onClick={() => openGraphTab("event_chain", "故事演进")}
          >
            <GitBranch className="size-3.5 text-rose-500" />
            <span className="truncate">故事演进</span>
          </Button>
          <Button
            size="xs"
            variant="outline"
            className="h-8 justify-start gap-1.5 bg-card/80 text-[10px]"
            disabled={!foreshadowingNode}
            onClick={() => { if (foreshadowingNode) onOpen(foreshadowingNode); }}
          >
            <Bookmark className="size-3.5 text-indigo-500" />
            <span className="truncate">伏笔账本</span>
          </Button>
          <Button
            size="xs"
            variant="outline"
            className="h-8 justify-start gap-1.5 bg-card/80 text-[10px] col-span-2"
            onClick={scrollToMemory}
          >
            <Sparkles className="size-3.5 text-amber-500" />
            <span className="truncate">章后事实</span>
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-1">
          <Button size="xs" variant="ghost" className="h-6 justify-start gap-1 text-[10px]" onClick={() => openGraphTab("relationship", "关系图")}>
            <Network className="size-3 text-primary" />关系图
          </Button>
          <Button size="xs" variant="ghost" className="h-6 justify-start gap-1 text-[10px]" onClick={() => openGraphTab("timeline", "时间线")}>
            <Clock className="size-3 text-ring" />时间线
          </Button>
          <Button size="xs" variant="ghost" className="h-6 justify-start gap-1 text-[10px]" onClick={() => openGraphTab("conflict", "矛盾地图")}>
            <Swords className="size-3 text-destructive" />冲突地图
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2">
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

        <div ref={memorySectionRef} data-testid="storyline-memory-section">
          <section className="mb-2 rounded-lg border border-border bg-card px-3 py-2">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold">
              <Sparkles className="size-3.5 text-amber-500" />
              <span>章后事实与故事状态</span>
            </div>
            <p className="mt-0.5 text-[10px] text-muted-foreground">写完一章后查看当前事实、待审变化和结算历史。</p>
          </section>
          <NarrativeMemoryPanel
            bookId={bookId}
            memoryNodes={memoryNodes}
            selectedNodeId={selectedNodeId}
            onOpen={onOpen}
            onAction={onAction}
            onOpenEntityDetail={onOpenEntityDetail}
          />
        </div>
      </div>
    </div>
  );
}
