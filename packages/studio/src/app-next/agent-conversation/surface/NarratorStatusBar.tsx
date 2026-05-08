/**
 * NarratorStatusBar — 对标 NarraFork 状态指示器行
 *
 * 位于 Composer 上方，包含：
 * - 左侧：状态圆点 + 状态文案 + 耗时
 * - 右侧：上下文% + 模型按钮 + 推理按钮 + Fast Mode + 权限按钮
 */

import { useRef, useState } from "react";
import { Shield, ShieldOff, Zap } from "lucide-react";
import type { NarratorState, NarratorSubstatus, ConversationStatus, ConversationModelOption } from "./ConversationStatusBar";
import type { SessionPermissionMode, SessionReasoningEffort } from "@/shared/session-types";

export interface NarratorStatusBarProps {
  status: ConversationStatus;
  onUpdateModel?: (providerId: string, modelId: string) => void;
  onUpdateReasoningEffort?: (effort: SessionReasoningEffort) => void;
  onUpdatePermissionMode?: (mode: SessionPermissionMode) => void;
  onToggleFastMode?: () => void;
  fastMode?: boolean;
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

const REASONING_OPTIONS: readonly { value: SessionReasoningEffort; label: string }[] = [
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
];

const REASONING_LABELS: Record<string, string> = {
  low: "低",
  medium: "中",
  high: "高",
};

const REASONING_INITIALS: Record<string, string> = {
  low: "L",
  medium: "M",
  high: "H",
};

const PERMISSION_OPTIONS: readonly { value: SessionPermissionMode; label: string }[] = [
  { value: "ask", label: "逐项询问" },
  { value: "edit", label: "允许编辑" },
  { value: "allow", label: "全部允许" },
  { value: "read", label: "只读" },
  { value: "plan", label: "计划模式" },
];

const PERMISSION_LABELS: Record<string, string> = {
  ask: "逐项询问",
  edit: "允许编辑",
  allow: "全部允许",
  read: "只读",
  plan: "计划模式",
};

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return minutes > 0 ? `${minutes}:${secs.toString().padStart(2, "0")}` : `0:${secs.toString().padStart(2, "0")}`;
}

export function NarratorStatusBar({ status, onUpdateModel, onUpdateReasoningEffort, onUpdatePermissionMode, onToggleFastMode, fastMode }: NarratorStatusBarProps) {
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

  // 模型首字母
  const modelInitial = (status.modelLabel ?? status.modelId ?? "?").charAt(0).toUpperCase();
  // 推理强度首字母
  const reasoningInitial = REASONING_INITIALS[status.reasoningEffort ?? "medium"] ?? "M";
  // 权限图标
  const permissionIsOpen = status.permissionMode === "allow";

  return (
    <div className="flex shrink-0 items-center justify-between border-t border-border px-4 py-1.5">
      {/* Left: status dot + label + duration */}
      <div className="flex items-center gap-1.5">
        <div className={`size-2 shrink-0 rounded-full ${dotColor}`} />
        <span className="text-xs text-muted-foreground">{stateLabel}</span>
        {status.lastTurnDurationMs != null && narratorState === "idle" && (
          <span className="text-xs text-muted-foreground">· 上轮耗时 {formatDuration(status.lastTurnDurationMs)}</span>
        )}
      </div>

      {/* Right: controls */}
      <div className="flex items-center gap-1">
        {/* Context usage */}
        {status.contextUsage && status.contextUsage.maxTokens && (
          <span className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground" title={`上下文：${status.contextUsage.usedTokens} / ${status.contextUsage.maxTokens}`}>
            {Math.round((status.contextUsage.usedTokens / status.contextUsage.maxTokens) * 100)}%
          </span>
        )}

        {/* Model button */}
        <PopoverButton
          label={modelInitial}
          title={`模型：${status.modelLabel ?? status.modelId ?? "未选择"}`}
          className="font-semibold"
        >
          {(close) => (
            <ModelMenu
              options={status.modelOptions}
              currentProviderId={status.providerId}
              currentModelId={status.modelId}
              onSelect={(providerId, modelId) => { onUpdateModel?.(providerId, modelId); close(); }}
            />
          )}
        </PopoverButton>

        {/* Reasoning effort button */}
        <PopoverButton
          label={reasoningInitial}
          title={`推理强度：${REASONING_LABELS[status.reasoningEffort ?? "medium"]}`}
        >
          {(close) => (
            <div className="space-y-0.5">
              <p className="px-2 py-1 text-[10px] font-medium text-muted-foreground">推理强度</p>
              {REASONING_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`flex w-full items-center justify-between rounded px-2 py-1 text-xs hover:bg-muted ${status.reasoningEffort === opt.value ? "font-medium text-primary" : ""}`}
                  onClick={() => { onUpdateReasoningEffort?.(opt.value); close(); }}
                >
                  <span>{opt.label}</span>
                  {status.reasoningEffort === opt.value && <span className="text-primary">✓</span>}
                </button>
              ))}
            </div>
          )}
        </PopoverButton>

        {/* Fast Mode toggle */}
        <button
          type="button"
          className={`rounded-md p-1.5 ${fastMode ? "text-yellow-500 bg-yellow-500/10" : "text-muted-foreground"} hover:bg-muted transition-colors`}
          title={fastMode ? "Fast Mode 开启" : "Fast Mode 关闭"}
          onClick={onToggleFastMode}
        >
          <Zap className="size-4" />
        </button>

        {/* Permission mode button */}
        <PopoverButton
          icon={permissionIsOpen ? <ShieldOff className="size-3.5" /> : <Shield className="size-3.5" />}
          title={`权限：${PERMISSION_LABELS[status.permissionMode ?? "edit"]}`}
        >
          {(close) => (
            <div className="space-y-0.5">
              <p className="px-2 py-1 text-[10px] font-medium text-muted-foreground">权限模式</p>
              {PERMISSION_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`flex w-full items-center justify-between rounded px-2 py-1 text-xs hover:bg-muted ${status.permissionMode === opt.value ? "font-medium text-primary" : ""}`}
                  onClick={() => { onUpdatePermissionMode?.(opt.value); close(); }}
                >
                  <span>{opt.label}</span>
                  {status.permissionMode === opt.value && <span className="text-primary">✓</span>}
                </button>
              ))}
            </div>
          )}
        </PopoverButton>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PopoverButton — 轻量弹出面板
// ---------------------------------------------------------------------------

function PopoverButton({
  label,
  icon,
  title,
  className = "",
  children,
}: {
  label?: string;
  icon?: React.ReactNode;
  title?: string;
  className?: string;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        className={`rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors ${className}`}
        title={title}
        onClick={() => setOpen(!open)}
        onBlur={(e) => {
          // 如果焦点移到了容器外，关闭
          if (!containerRef.current?.contains(e.relatedTarget as Node)) {
            setTimeout(() => setOpen(false), 150);
          }
        }}
      >
        {icon ?? label}
      </button>
      {open && (
        <div className="absolute bottom-full right-0 z-50 mb-1 min-w-[140px] max-h-[300px] overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ModelMenu — 模型选择菜单（带搜索）
// ---------------------------------------------------------------------------

function ModelMenu({
  options,
  currentProviderId,
  currentModelId,
  onSelect,
}: {
  options?: readonly ConversationModelOption[];
  currentProviderId?: string;
  currentModelId?: string;
  onSelect: (providerId: string, modelId: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const filtered = (options ?? []).filter((opt) =>
    !filter || opt.modelId.toLowerCase().includes(filter.toLowerCase()) || (opt.modelLabel ?? "").toLowerCase().includes(filter.toLowerCase()),
  );

  // 按 provider 分组
  const groups = new Map<string, ConversationModelOption[]>();
  for (const opt of filtered) {
    const key = opt.providerId ?? "unknown";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(opt);
  }

  return (
    <div className="space-y-1">
      <p className="px-2 py-1 text-[10px] font-medium text-muted-foreground">下次发言使用的模型</p>
      <input
        type="text"
        className="w-full rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary"
        placeholder="筛选模型..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        autoFocus
      />
      {groups.size === 0 && <p className="px-2 py-1 text-[10px] text-muted-foreground">无可用模型</p>}
      {[...groups.entries()].map(([provider, models]) => (
        <div key={provider}>
          <p className="px-2 pt-1 text-[10px] font-medium text-muted-foreground">{provider}</p>
          {models.map((model) => {
            const isSelected = model.providerId === currentProviderId && model.modelId === currentModelId;
            return (
              <button
                key={`${model.providerId}:${model.modelId}`}
                type="button"
                className={`flex w-full items-center justify-between rounded px-2 py-1 text-xs hover:bg-muted ${isSelected ? "font-medium text-primary" : ""}`}
                onClick={() => onSelect(model.providerId, model.modelId)}
              >
                <span>{model.modelLabel ?? model.modelId}</span>
                {isSelected && <span className="text-primary">✓</span>}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
