/**
 * ChapterNode — react-flow 自定义节点
 *
 * 对标 NarraFork：每个章节是图中的可拖拽卡片，内嵌对话窗口。
 * 结构：DragHandle(标题+状态) + 内容区(消息列表+状态栏+Composer)
 */

import { memo } from "react";
import { type Node, type NodeProps, NodeResizeControl } from "@xyflow/react";
import { GripVertical } from "lucide-react";

export interface ChapterNodeData {
  [key: string]: unknown;
  id: string;
  title: string;
  status: "active" | "dormant" | "merged" | "abandoned" | "frozen";
  branch?: string;
  changes?: number;
  narratorId?: string;
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

      {/* Content area — will embed ConversationSurface in future */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Git status bar */}
        <div className="flex shrink-0 items-center gap-1.5 border-b border-border bg-muted/30 px-3 py-1 text-[10px] text-muted-foreground">
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

        {/* Placeholder for embedded conversation */}
        <div className="flex flex-1 items-center justify-center p-4 text-xs text-muted-foreground">
          {data.narratorId ? (
            <p>叙述者会话已绑定</p>
          ) : (
            <p>点击新建或绑定叙述者</p>
          )}
        </div>
      </div>
    </div>
  );
}

export const ChapterNode = memo(ChapterNodeComponent);
