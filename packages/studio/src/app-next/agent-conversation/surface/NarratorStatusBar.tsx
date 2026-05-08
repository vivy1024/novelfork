/**
 * NarratorStatusBar — 对标 NarraFork 状态指示器行
 *
 * 位于 Composer 上方，包含：
 * - 左侧：状态圆点 + 状态文案 + 耗时
 * - 右侧：模型/推理/权限/Fast Mode 控件（后续 Task 3-6 填充）
 */

import type { NarratorState, NarratorSubstatus, ConversationStatus } from "./ConversationStatusBar";

export interface NarratorStatusBarProps {
  status: ConversationStatus;
  onUpdateModel?: (modelValue: string) => void;
  onUpdateReasoningEffort?: (effort: string) => void;
  onUpdatePermissionMode?: (mode: string) => void;
  onToggleFastMode?: () => void;
}

const STATE_DOT_COLORS: Record<string, string> = {
  idle: "bg-gray-400",
  working: "bg-blue-500",
  waiting: "bg-yellow-500",
  archived: "bg-gray-300",
};

const SUBSTATUS_DOT_COLORS: Partial<Record<NarratorSubstatus, string>> = {
  error: "bg-red-500",
  interrupted: "bg-orange-500",
  reasoning: "bg-purple-500",
  compacting: "bg-orange-400",
  planning: "bg-green-500",
  retrying: "bg-yellow-500",
  queued: "bg-yellow-400",
  unread: "bg-green-400",
};

const SUBSTATUS_LABELS: Record<NarratorSubstatus, string> = {
  unread: "已完成",
  error: "错误",
  interrupted: "已中断",
  suspended: "已暂停",
  manual_override: "手动接管",
  reasoning: "推理中",
  compacting: "压缩中",
  planning: "计划中",
  retrying: "重试中",
  queued: "排队中",
};

const STATE_LABELS: Record<NarratorState, string> = {
  idle: "空闲",
  working: "工作中",
  waiting: "等待中",
  archived: "已归档",
};

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return minutes > 0 ? `${minutes}:${secs.toString().padStart(2, "0")}` : `0:${secs.toString().padStart(2, "0")}`;
}

export function NarratorStatusBar({ status }: NarratorStatusBarProps) {
  const narratorState: NarratorState = status.narratorState ?? (status.state === "running" ? "working" : "idle");
  const substatus = status.substatus;

  // 圆点颜色：substatus 优先
  const dotColor = substatus
    ? (SUBSTATUS_DOT_COLORS[substatus] ?? STATE_DOT_COLORS[narratorState] ?? "bg-gray-400")
    : (STATE_DOT_COLORS[narratorState] ?? "bg-gray-400");

  // 状态文案：substatus 优先
  const stateLabel = substatus
    ? SUBSTATUS_LABELS[substatus]
    : STATE_LABELS[narratorState];

  return (
    <div className="flex shrink-0 items-center justify-between border-t border-border px-4 py-2">
      {/* Left: status dot + label + duration */}
      <div className="flex items-center gap-1.5">
        <div className={`size-2 shrink-0 rounded-full ${dotColor}`} />
        <span className="text-xs text-muted-foreground">{stateLabel}</span>
        {status.lastTurnDurationMs != null && narratorState === "idle" && (
          <span className="text-xs text-muted-foreground">· 上轮耗时 {formatDuration(status.lastTurnDurationMs)}</span>
        )}
      </div>

      {/* Right: controls placeholder — Task 3-6 will add ActionIcon menus here */}
      <div className="flex items-center gap-1">
        {/* Context usage ring placeholder */}
        {status.contextUsage && status.contextUsage.maxTokens && (
          <span className="text-[10px] text-muted-foreground" title={`上下文：${Math.round((status.contextUsage.usedTokens / status.contextUsage.maxTokens) * 100)}%`}>
            {Math.round((status.contextUsage.usedTokens / status.contextUsage.maxTokens) * 100)}%
          </span>
        )}
      </div>
    </div>
  );
}
