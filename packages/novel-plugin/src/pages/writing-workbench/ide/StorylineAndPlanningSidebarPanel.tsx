/**
 * 故事脉络（Storyline & Planning）侧栏面板。
 *
 * 汇聚长篇故事推进与因果脉络的核心资产：
 * 1. 剧情大纲与卷规划；
 * 2. 伏笔生命周期看板；
 * 3. 关系拓扑图与全景时间线（一键无缝打开全屏画布 Tab）；
 * 4. 章后待审事项队列（折叠展示，有待审时红点提示并支持批量批准）。
 */

import { useCallback, useState } from "react";
import {
  Brain,
  Clock,
  ExternalLink,
  GitBranch,
  Network,
  RefreshCw,
  Route,
  Scroll,
  ShieldAlert,
  Swords,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NarrativeMemoryPanel } from "../NarrativeMemoryPanel";
import { WorkbenchResourceTree, type ResourceTreeAction } from "../WorkbenchResourceTree";
import type { WorkbenchResourceNode } from "../useWorkbenchResources";

export interface StorylineAndPlanningSidebarPanelProps {
  bookId: string;
  outlineNodes?: readonly WorkbenchResourceNode[];
  memoryNodes?: WorkbenchResourceNode[];
  selectedNodeId: string | null;
  onOpen: (node: WorkbenchResourceNode) => void;
  onAction?: (action: ResourceTreeAction) => void;
  onOpenEntityDetail?: (entity: string) => void;
}

export function StorylineAndPlanningSidebarPanel({
  bookId,
  outlineNodes = [],
  memoryNodes,
  selectedNodeId,
  onOpen,
  onAction,
  onOpenEntityDetail,
}: StorylineAndPlanningSidebarPanelProps) {
  const [activeSubTab, setActiveSubTab] = useState<"story-state" | "planning">("story-state");

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

  return (
    <div className="flex h-full flex-col overflow-hidden bg-card text-xs" data-testid="storyline-and-planning-panel">
      {/* 顶部全景画板快捷入口（关系图、时间线、角色弧线） */}
      <div className="shrink-0 border-b border-border bg-muted/15 p-2 space-y-1.5">
        <div className="flex items-center justify-between text-[11px] font-semibold text-foreground px-0.5">
          <span>全景脉络图谱</span>
          <span className="text-[10px] text-muted-foreground">点按打开全屏画布</span>
        </div>
        <div className="grid grid-cols-3 gap-1">
          <Button
            size="xs"
            variant="outline"
            className="h-7 text-[10px] gap-1 px-1.5 justify-start bg-card/80"
            onClick={() => openGraphTab("relationship", "关系网络")}
          >
            <Network className="size-3 text-primary shrink-0" />
            <span className="truncate">关系网络</span>
          </Button>
          <Button
            size="xs"
            variant="outline"
            className="h-7 text-[10px] gap-1 px-1.5 justify-start bg-card/80"
            onClick={() => openGraphTab("timeline", "时间线")}
          >
            <Clock className="size-3 text-ring shrink-0" />
            <span className="truncate">时间线</span>
          </Button>
          <Button
            size="xs"
            variant="outline"
            className="h-7 text-[10px] gap-1 px-1.5 justify-start bg-card/80"
            onClick={() => openGraphTab("conflict", "矛盾地图")}
          >
            <Swords className="size-3 text-destructive shrink-0" />
            <span className="truncate">矛盾地图</span>
          </Button>
        </div>
      </div>

      {/* 故事推进与章后事实面板（复用 NarrativeMemoryPanel 的完整待审与事实能力） */}
      <div className="flex-1 min-h-0 overflow-y-auto">
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
  );
}
