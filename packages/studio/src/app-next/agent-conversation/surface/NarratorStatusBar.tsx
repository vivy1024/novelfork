/**
 * NarratorStatusBar — 对标 NarraFork 状态指示器行
 *
 * 位于 Composer 上方，包含：
 * - 左侧：状态圆点 + 状态文案 + 耗时
 * - 右侧：上下文% + 模型按钮 + 推理按钮 + Fast Mode + 权限按钮
 *
 * 使用 shadcn DropdownMenu + Tooltip 组件（基于 Radix Primitives）
 */

import { useEffect, useState } from "react";
import { Loader2, Zap } from "lucide-react";
import { Input } from "@/components/ui/input";
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
  streamingStartedAt?: number | null;
  onUpdateModel?: (providerId: string, modelId: string) => void;
  onUpdateReasoningEffort?: (effort: SessionReasoningEffort) => void;
  onUpdatePermissionMode?: (mode: SessionPermissionMode) => void;
  onToggleFastMode?: () => void;
  onCompact?: () => void;
  onReset?: () => void;
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

export function NarratorStatusBar({ status, streamingStartedAt, onUpdateModel, onUpdateReasoningEffort, onUpdatePermissionMode, onToggleFastMode, onCompact, onReset, fastMode }: NarratorStatusBarProps) {
  const narratorState: NarratorState = status.narratorState ?? (status.state === "running" ? "working" : "idle");
  const substatus = status.substatus;

  // 实时计时器
  const isWorking = narratorState === "working";
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!isWorking || !streamingStartedAt) { setElapsed(0); return; }
    setElapsed(Date.now() - streamingStartedAt);
    const interval = setInterval(() => setElapsed(Date.now() - streamingStartedAt), 1000);
    return () => clearInterval(interval);
  }, [isWorking, streamingStartedAt]);

  // 圆点颜色：substatus 优先
  const dotColor = substatus
    ? (SUBSTATUS_DOT_COLORS[substatus] ?? STATE_DOT_COLORS[narratorState] ?? "bg-gray-400")
    : (STATE_DOT_COLORS[narratorState] ?? "bg-gray-400");

  // 状态文案：substatus 优先
  const stateLabel = substatus
    ? SUBSTATUS_LABELS[substatus]
    : STATE_LABELS[narratorState];

  // 模型完整名称：providerLabel:modelLabel 格式
  const modelFullName = (status.providerLabel ?? status.providerId) && (status.modelLabel ?? status.modelId)
    ? `${status.providerLabel ?? status.providerId}:${status.modelLabel ?? status.modelId}`
    : (status.modelLabel ?? status.modelId ?? "未选择");
  // 模型首字母（备用）
  const modelInitial = (status.modelLabel ?? status.modelId ?? "?").charAt(0).toUpperCase();
  // 权限完整文字
  const permissionFullLabel = PERMISSION_LABELS[status.permissionMode ?? "edit"] ?? "允许编辑";
  // 条件显示：推理强度和 Fast Mode 仅 Codex API 模式显示
  const showReasoningEffort = status.apiMode === "codex";
  // 条件显示：Fast Mode 仅 Codex 显示
  const showFastMode = status.apiMode === "codex";

  const isWaiting = narratorState === "waiting";

  return (
    <TooltipProvider>
      <div className="relative flex shrink-0 items-center justify-between border-t border-border/50 px-4 py-1">
        {/* Progress bar — 工作中/等待中时显示底部进度线 */}
        {(isWorking || isWaiting) && (
          <div className="absolute inset-x-0 bottom-0 h-[2px] overflow-hidden">
            <div
              className={`h-full w-1/3 rounded-full ${isWaiting ? "bg-yellow-500/60" : "bg-blue-500/60"}`}
              style={{ animation: "shimmer 1.5s ease-in-out infinite" }}
            />
            <style>{`@keyframes shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(400%); } }`}</style>
          </div>
        )}

        {/* Left: status icon + label + timer */}
        <div className="flex items-center gap-1.5">
          {isWorking ? (
            <Loader2 className="size-3.5 animate-spin text-blue-500 shrink-0" />
          ) : isWaiting ? (
            <Loader2 className="size-3.5 animate-spin text-yellow-500 shrink-0" />
          ) : (
            <div className={`size-2 shrink-0 rounded-full ${dotColor}`} />
          )}
          {isWorking && streamingStartedAt && elapsed > 0 ? (
            <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
              思考中 {formatDuration(elapsed)}
            </span>
          ) : isWaiting ? (
            <span className="text-xs font-medium text-yellow-600 dark:text-yellow-400">
              等待中{streamingStartedAt && elapsed > 0 ? ` ${formatDuration(elapsed)}` : ""}
            </span>
          ) : (
            <>
              <span className="text-xs text-muted-foreground">{stateLabel}</span>
              {!isWorking && status.lastTurnDurationMs != null && (
                <span className="text-xs text-muted-foreground">· 上轮耗时 {formatDuration(status.lastTurnDurationMs)}</span>
              )}
            </>
          )}
        </div>

        {/* Right: controls */}
        <div className="flex items-center gap-1">
          {/* Context usage ring — always visible, dropdown menu */}
          <ContextRingMenu
            used={status.contextUsage?.usedTokens ?? 0}
            max={status.contextUsage?.maxTokens ?? 0}
            compactThreshold={status.contextUsage?.compactThreshold}
            onCompact={onCompact}
            onReset={onReset}
          />

          {/* Model dropdown — 显示完整名称 */}
          <ModelDropdown
            options={status.modelOptions}
            currentProviderId={status.providerId}
            currentModelId={status.modelId}
            modelInitial={modelInitial}
            modelLabel={status.modelLabel ?? status.modelId ?? "未选择"}
            modelFullName={modelFullName}
            onSelect={(providerId, modelId) => onUpdateModel?.(providerId, modelId)}
          />

          {/* Reasoning effort dropdown — 仅 Codex/Anthropic/DeepSeek 显示 */}
          {showReasoningEffort && (
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex items-center justify-center rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title={`推理强度：${REASONING_LABELS[status.reasoningEffort ?? "medium"]}`}
            >
              {REASONING_INITIALS[status.reasoningEffort ?? "medium"] ?? "M"}
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
          )}

          {/* Fast Mode toggle — 仅 Codex 显示 */}
          {showFastMode && (
          <Tooltip>
            <TooltipTrigger
              className={`rounded-md p-1.5 ${fastMode ? "text-yellow-500 bg-yellow-500/10" : "text-muted-foreground"} hover:bg-muted transition-colors`}
              onClick={onToggleFastMode}
            >
              <Zap className="size-4" />
            </TooltipTrigger>
            <TooltipContent side="top">{fastMode ? "Fast Mode 开启" : "Fast Mode 关闭"}</TooltipContent>
          </Tooltip>
          )}

          {/* Permission mode dropdown — 显示完整文字 */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted transition-colors"
              title={`权限：${permissionFullLabel}`}
            >
              <span className="text-[10px]">◇</span>
              <span>{permissionFullLabel}</span>
              <span className="text-[10px] text-muted-foreground/60">▾</span>
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
  modelFullName,
  onSelect,
}: {
  options?: readonly ConversationModelOption[];
  currentProviderId?: string;
  currentModelId?: string;
  modelInitial: string;
  modelLabel: string;
  modelFullName: string;
  onSelect: (providerId: string, modelId: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const filtered = (options ?? []).filter((opt) =>
    !filter || opt.modelId.toLowerCase().includes(filter.toLowerCase()) || (opt.modelLabel ?? "").toLowerCase().includes(filter.toLowerCase()),
  );

  // 按 provider 分组
  const groups = new Map<string, ConversationModelOption[]>();
  for (const opt of filtered) {
    const key = opt.providerLabel ?? opt.providerId ?? "unknown";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(opt);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted transition-colors"
        title={`模型：${modelLabel}`}
      >
        <span className="max-w-[160px] truncate">{modelFullName}</span>
        <span className="text-[10px] text-muted-foreground/60">▾</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="min-w-[200px] max-h-[300px]">
        <DropdownMenuGroup>
          <DropdownMenuLabel>下次发言使用的模型</DropdownMenuLabel>
        </DropdownMenuGroup>
        <div className="px-1.5 py-1">
          <Input
            className="h-7 text-xs"
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

// ---------------------------------------------------------------------------
// ContextRingMenu — DropdownMenu wrapping the ContextRing
// ---------------------------------------------------------------------------

function ContextRingMenu({
  used,
  max,
  compactThreshold,
  onCompact,
  onReset,
}: {
  used: number;
  max: number;
  compactThreshold?: number;
  onCompact?: () => void;
  onReset?: () => void;
}) {
  const hasMax = max > 0;
  const percent = hasMax ? Math.min(100, Math.round((used / max) * 100)) : 0;
  const targetPercent = hasMax && compactThreshold ? Math.round((compactThreshold / max) * 100) : 50;
  const autoThresholdPercent = hasMax && compactThreshold ? Math.round((compactThreshold / max) * 100) : 80;

  const handleReset = () => {
    if (window.confirm("确定要清空上下文吗？这将重置当前会话的所有上下文记忆。")) {
      onReset?.();
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="cursor-default rounded px-1 py-0.5">
        <ContextRing used={used} max={max} />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="min-w-[200px]">
        <DropdownMenuLabel>
          {hasMax
            ? `上下文：${percent}% · ${used.toLocaleString()} / ${max.toLocaleString()} tokens (估算)`
            : `上下文：${used.toLocaleString()} tokens（上限未知）`}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onCompact?.()} disabled={!onCompact}>
          压缩到 {targetPercent}%
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleReset} disabled={!onReset}>
          清空上下文
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <div className="px-2 py-1.5 text-xs text-muted-foreground">
          自动压缩阈值：{autoThresholdPercent}%
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------------------
// ContextRing — SVG 圆环显示上下文使用百分比
// ---------------------------------------------------------------------------

function ContextRing({ used, max }: { used: number; max: number }) {
  const hasMax = max > 0;
  const percent = hasMax ? Math.min(100, Math.round((used / max) * 100)) : 0;
  const radius = 8;
  const stroke = 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;

  const color = !hasMax ? "text-gray-400" : percent >= 90 ? "text-red-500" : percent >= 70 ? "text-yellow-500" : "text-blue-500";

  return (
    <span className="inline-flex items-center gap-1">
      <svg width="20" height="20" viewBox="0 0 20 20" className={color}>
        <circle
          cx="10"
          cy="10"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          opacity={0.2}
        />
        <circle
          cx="10"
          cy="10"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 10 10)"
        />
      </svg>
      <span className="text-[10px] text-muted-foreground">{hasMax ? `${percent}%` : "—"}</span>
    </span>
  );
}
