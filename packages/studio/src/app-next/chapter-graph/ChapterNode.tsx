/**
 * ChapterNode — react-flow 自定义节点
 *
 * 对标 NarraFork：每个章节是图中的可拖拽卡片，内嵌对话窗口。
 * 结构：DragHandle(标题+状态) + Git状态栏 + 内容区(绑定状态+操作)
 */

import { memo } from "react";
import { type Node, type NodeProps, NodeResizeControl } from "@xyflow/react";
import { GripVertical, MessageSquareText, Plus, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface ChapterNodeData {
  [key: string]: unknown;
  id: string;
  title: string;
  status: "active" | "dormant" | "merged" | "abandoned" | "frozen";
  branch?: string;
  changes?: number;
  narratorId?: string;
  messageCount?: number;
  lastActivity?: string;
}

export type ChapterNodeType = Node<ChapterNodeData, "chapterNode">;

const STATUS_COLORS: Record<string, string> = {
  active: "border-green-400",
  dormant: "border-yellow-400",
  merged: "border-blue-400",
  abandoned: "border-gray-400",
  frozen: "border-cyan-400",
};

const STATUS_LABELS: Record<string, string> = {
  active: "活跃",
  dormant: "休眠",
  merged: "已合并",
  abandoned: "已放弃",
  frozen: "已冻结",
};

const STATUS_BADGE_COLORS: Record<string, string> = {
  active: "bg-green-500/10 text-green-600",
  dormant: "bg-yellow-500/10 text-yellow-600",
  merged: "bg-blue-500/10 text-blue-600",
  abandoned: "bg-gray-500/10 text-gray-600",
  frozen: "bg-cyan-500/10 text-cyan-600",
};

function ChapterNodeComponent({ data }: NodeProps<ChapterNodeType>) {
  const borderColor = STATUS_COLORS[data.status] ?? "border-border";
  const badgeColor = STATUS_BADGE_COLORS[data.status] ?? "bg-muted text-muted-foreground";

  return (
    <div className={`flex h-full w-full flex-col overflow-hidden rounded-lg border ${borderColor} bg-card shadow-sm`}>
      {/* Resize handle */}
      <NodeResizeControl
        minWidth={320}
        minHeight={400}
        className="absolute bottom-0 right-0 cursor-nwse-resize opacity-0 hover:opacity-70"
      >
        <div className="size-3 rounded-full bg-primary/50" />
      </NodeResizeControl>

      {/* Drag handle */}
      <div className="flex shrink-0 cursor-grab items-center justify-between border-b border-border px-3 py-2 active:cursor-grabbing">
        <div className="flex items-center gap-2 min-w-0">
          <GripVertical className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-semibold">{data.title}</span>
        </div>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${badgeColor}`}>
          {STATUS_LABELS[data.status] ?? data.status}
        </span>
      </div>

      {/* Content area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Git status bar */}
        <div className="flex shrink-0 items-center gap-1.5 border-b border-border bg-muted/30 px-3 py-1 text-[10px] text-muted-foreground">
          <GitBranch className="size-3 shrink-0" />
          <span className="truncate font-medium">{data.title}</span>
          {data.branch && (
            <>
              <span>·</span>
              <span className="truncate font-mono">{data.branch}</span>
            </>
          )}
          {data.changes != null && (
            <>
              <span>·</span>
              <span className="rounded bg-blue-500/10 px-1 text-blue-600">{data.changes}</span>
            </>
          )}
        </div>

        {/* Narrator binding area */}
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4">
          {data.narratorId ? (
            <>
              <div className="flex items-center gap-2 text-sm text-foreground">
                <MessageSquareText className="size-4 text-primary" />
                <span className="font-medium">叙述者已绑定</span>
              </div>
              {data.messageCount != null && (
                <p className="text-xs text-muted-foreground">{data.messageCount} 条消息</p>
              )}
              {data.lastActivity && (
                <p className="text-[10px] text-muted-foreground">最近活动：{data.lastActivity}</p>
              )}
              <Button variant="outline" size="sm" className="mt-2">
                <MessageSquareText className="size-3.5" />
                打开对话
              </Button>
            </>
          ) : (
            <>
              <div className="rounded-full bg-muted/50 p-3">
                <MessageSquareText className="size-5 text-muted-foreground" />
              </div>
              <p className="text-xs text-muted-foreground text-center">尚未绑定叙述者</p>
              <Button variant="outline" size="sm">
                <Plus className="size-3.5" />
                新建叙述者
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export const ChapterNode = memo(ChapterNodeComponent);
