/**
 * NarratorStatusBar — 对标 NarraFork 状态指示器行
 *
 * 位于 Composer 上方，包含：
 * - 左侧：状态圆点 + 状态文案 + 耗时
 * - 右侧：上下文% + 模型按钮 + 推理按钮 + Fast Mode + 权限按钮
 *
 * 使用 shadcn DropdownMenu + Tooltip 组件（基于 @base-ui/react）
 */

import { useState } from "react";
import { Shield, ShieldOff, Zap } from "lucide-react";
import type { NarratorState, NarratorSubstatus, ConversationStatus, ConversationModelOption } from "./ConversationStatusBar";
import type { SessionPermissionMode, SessionReasoningEffort } from "@/shared/session-types";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";

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
    <TooltipProvider>
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
            <Tooltip>
              <TooltipTrigger className="cursor-default rounded px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {Math.round((status.contextUsage.usedTokens / status.contextUsage.maxTokens) * 100)}%
              </TooltipTrigger>
              <TooltipContent side="top">
                上下文：{status.contextUsage.usedTokens} / {status.contextUsage.maxTokens}
              </TooltipContent>
            </Tooltip>
          )}

          {/* Model dropdown */}
          <ModelDropdown
            options={status.modelOptions}
            currentProviderId={status.providerId}
            currentModelId={status.modelId}
            modelInitial={modelInitial}
            modelLabel={status.modelLabel ?? status.modelId ?? "未选择"}
            onSelect={(providerId, modelId) => onUpdateModel?.(providerId, modelId)}
          />

          {/* Reasoning effort dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex items-center justify-center rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title={`推理强度：${REASONING_LABELS[status.reasoningEffort ?? "medium"]}`}
            >
              {reasoningInitial}
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end" className="min-w-[120px]">
              <DropdownMenuGroup>
                <DropdownMenuLabel>推理强度</DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup value={status.reasoningEffort ?? "medium"} onValueChange={(v) => onUpdateReasoningEffort?.(v as SessionReasoningEffort)}>
                {REASONING_OPTIONS.map((opt) => (
                  <DropdownMenuRadioItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Fast Mode toggle */}
          <Tooltip>
            <TooltipTrigger
              className={`rounded-md p-1.5 ${fastMode ? "text-yellow-500 bg-yellow-500/10" : "text-muted-foreground"} hover:bg-muted transition-colors`}
              onClick={onToggleFastMode}
            >
              <Zap className="size-4" />
            </TooltipTrigger>
            <TooltipContent side="top">{fastMode ? "Fast Mode 开启" : "Fast Mode 关闭"}</TooltipContent>
          </Tooltip>

          {/* Permission mode dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex items-center justify-center rounded-md px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title={`权限：${PERMISSION_LABELS[status.permissionMode ?? "edit"]}`}
            >
              {permissionIsOpen ? <ShieldOff className="size-3.5" /> : <Shield className="size-3.5" />}
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end" className="min-w-[120px]">
              <DropdownMenuGroup>
                <DropdownMenuLabel>权限模式</DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup value={status.permissionMode ?? "edit"} onValueChange={(v) => onUpdatePermissionMode?.(v as SessionPermissionMode)}>
                {PERMISSION_OPTIONS.map((opt) => (
                  <DropdownMenuRadioItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </TooltipProvider>
  );
}

// ---------------------------------------------------------------------------
// ModelDropdown — 模型选择下拉菜单（带搜索）
// ---------------------------------------------------------------------------

function ModelDropdown({
  options,
  currentProviderId,
  currentModelId,
  modelInitial,
  modelLabel,
  onSelect,
}: {
  options?: readonly ConversationModelOption[];
  currentProviderId?: string;
  currentModelId?: string;
  modelInitial: string;
  modelLabel: string;
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
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex items-center justify-center rounded-md px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        title={`模型：${modelLabel}`}
      >
        {modelInitial}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="min-w-[200px] max-h-[300px]">
        <DropdownMenuGroup>
          <DropdownMenuLabel>下次发言使用的模型</DropdownMenuLabel>
        </DropdownMenuGroup>
        <div className="px-1.5 py-1">
          <input
            type="text"
            className="w-full rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary"
            placeholder="筛选模型..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </div>
        <DropdownMenuSeparator />
        {groups.size === 0 && (
          <div className="px-2 py-1 text-[10px] text-muted-foreground">无可用模型</div>
        )}
        {[...groups.entries()].map(([provider, models]) => (
          <DropdownMenuGroup key={provider}>
            <DropdownMenuLabel>{provider}</DropdownMenuLabel>
            {models.map((model) => {
              const isSelected = model.providerId === currentProviderId && model.modelId === currentModelId;
              return (
                <DropdownMenuItem
                  key={`${model.providerId}:${model.modelId}`}
                  className={isSelected ? "font-medium text-primary" : ""}
                  onClick={() => onSelect(model.providerId, model.modelId)}
                >
                  <span className="flex-1">{model.modelLabel ?? model.modelId}</span>
                  {isSelected && <span className="text-primary text-xs">✓</span>}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
