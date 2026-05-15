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
import { Loader2, Zap, PenLine, GitBranch, FolderPlus, Check, Terminal } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { NarratorState, NarratorSubstatus, ConversationStatus, ConversationModelOption } from "./ConversationStatusBar";
import type { SessionPermissionMode, SessionReasoningEffort } from "@/shared/session-types";
import { notify } from "@/lib/notify";
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
  /** 当前 streaming 消息的总字符数（用于计算输出速率） */
  streamingChars?: number;
  onUpdateModel?: (providerId: string, modelId: string) => void;
  onUpdateReasoningEffort?: (effort: SessionReasoningEffort) => void;
  onUpdatePermissionMode?: (mode: SessionPermissionMode) => void;
  onToggleFastMode?: () => void;
  onCompact?: () => void;
  onReset?: () => void;
  onOpenTerminal?: () => void;
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
  reflecting: "bg-amber-500",
  compacting: "bg-orange-400",
  planning: "bg-green-500",
  plan_reflecting: "bg-green-500",
  retrying: "bg-yellow-500",
  queued: "bg-yellow-400",
  unread: "bg-green-400",
  tool_calling: "bg-cyan-500",
  thinking: "bg-blue-500",
};

const SUBSTATUS_LABELS: Record<NarratorSubstatus, string> = {
  unread: "已完成",
  error: "错误",
  interrupted: "已中断",
  suspended: "已暂停",
  manual_override: "手动接管",
  reasoning: "推理中",
  reflecting: "安全评估中",
  compacting: "压缩中",
  planning: "计划中",
  plan_reflecting: "计划审核中",
  retrying: "重试中",
  queued: "排队中",
  tool_calling: "调用工具中",
  thinking: "思考中",
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

export function NarratorStatusBar({ status, streamingStartedAt, streamingChars, onUpdateModel, onUpdateReasoningEffort, onUpdatePermissionMode, onToggleFastMode, onCompact, onReset, onOpenTerminal, fastMode }: NarratorStatusBarProps) {
  const narratorState: NarratorState = status.narratorState ?? (status.state === "running" ? "working" : "idle");
  const substatus = status.substatus;

  // 目录白名单按钮状态
  const [dirAdded, setDirAdded] = useState(false);

  // 实时计时器 — 基于 turnActive 状态，不依赖后端 turnStartedAt
  const isWorking = narratorState === "working";
  const [elapsed, setElapsed] = useState(0);
  const [turnStartTime, setTurnStartTime] = useState<number | null>(null);

  useEffect(() => {
    if (isWorking) {
      // Turn 开始：记录本地开始时间（如果后端有 streamingStartedAt 就用后端的，否则用当前时间）
      const startTime = streamingStartedAt ?? Date.now();
      setTurnStartTime(startTime);
      setElapsed(Date.now() - startTime);
      const interval = setInterval(() => setElapsed(Date.now() - startTime), 1000);
      return () => clearInterval(interval);
    } else {
      // Turn 结束：停止计时
      setTurnStartTime(null);
      setElapsed(0);
    }
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
      <div className="relative flex shrink-0 items-center justify-between border-t border-border/50 px-4 py-1.5 min-h-[36px]">
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
          {isWorking ? (
            <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
              {substatus === "tool_calling" && status.toolName
                ? `调用 ${status.toolName}... ${formatDuration(elapsed)}`
                : substatus === "reflecting"
                ? `安全评估中 ${formatDuration(elapsed)}`
                : substatus === "plan_reflecting"
                ? `计划审核中 ${formatDuration(elapsed)}`
                : substatus === "retrying"
                ? `重试中 ${formatDuration(elapsed)}`
                : substatus === "planning"
                ? `计划中 ${formatDuration(elapsed)}`
                : substatus === "reasoning"
                ? `推理中 ${formatDuration(elapsed)}`
                : `思考中 ${formatDuration(elapsed)}${streamingChars && elapsed > 1000 ? ` · ${Math.round(streamingChars / (elapsed / 1000))}字/秒` : ""}`}
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

        {/* Center: Git branch + changes (if available) */}
        {status.workspace?.branch && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <GitBranch className="size-3 shrink-0" />
            <span className="max-w-[120px] truncate font-mono text-[11px]" title={status.workspace.branch}>
              {status.workspace.branch}
            </span>
            {typeof status.workspace.changes === "number" && status.workspace.changes > 0 && (
              <span className="rounded-full bg-orange-500/15 px-1.5 py-px text-[10px] font-medium text-orange-600 dark:text-orange-400">
                {status.workspace.changes}
              </span>
            )}
          </div>
        )}

        {/* Right: context ring + model + reasoning + fast + permission */}
        <div className="flex items-center gap-1.5">
          {/* Writing preset quick switch — only when a book is bound */}
          {status.binding?.projectId && (
            <WritingPresetQuickSwitch bookId={status.binding.projectId} />
          )}
          {/* Terminal panel entry */}
          {onOpenTerminal && (
          <Tooltip>
            <TooltipTrigger
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted transition-colors"
              onClick={onOpenTerminal}
            >
              <Terminal className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent side="top">终端</TooltipContent>
          </Tooltip>
          )}
          {/* Context usage ring — 在模型下拉左边 */}
          <ContextRingMenu
            used={status.contextUsage?.usedTokens ?? 0}
            max={status.contextUsage?.maxTokens ?? 0}
            compactThreshold={status.contextUsage?.compactThreshold}
            trimThreshold={status.contextUsage?.trimThreshold}
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

          {/* Directory whitelist quick-add button */}
          {status.workspace?.path && (
          <Tooltip>
            <TooltipTrigger
              className={`rounded-md p-1.5 transition-colors ${dirAdded ? "text-green-500 cursor-default" : "text-muted-foreground hover:bg-muted"}`}
              disabled={dirAdded}
              onClick={async () => {
                if (dirAdded) return;
                try {
                  const getResp = await fetch("/api/settings");
                  const config = getResp.ok ? await getResp.json() : {};
                  const currentList: string[] = config?.runtimeControls?.toolAccess?.directoryAllowlist ?? [];
                  const workPath = status.workspace!.path!;
                  if (currentList.includes(workPath)) {
                    setDirAdded(true);
                    notify.info(`${workPath} 已在目录白名单中`);
                    return;
                  }
                  const newList = [...currentList, workPath];
                  const putResp = await fetch("/api/settings", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ runtimeControls: { toolAccess: { directoryAllowlist: newList } } }),
                  });
                  if (putResp.ok) {
                    setDirAdded(true);
                    notify.success(`已添加 ${workPath} 到目录白名单`);
                  } else {
                    notify.error("添加目录白名单失败");
                  }
                } catch {
                  notify.error("添加目录白名单失败");
                }
              }}
            >
              {dirAdded ? <Check className="size-3.5" /> : <FolderPlus className="size-3.5" />}
            </TooltipTrigger>
            <TooltipContent side="top">
              {dirAdded ? "已添加到白名单" : "添加工作目录到白名单"}
            </TooltipContent>
          </Tooltip>
          )}

          {/* Permission mode dropdown — 显示完整文字 */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted transition-colors h-7"
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
        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted transition-colors h-7"
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
// WritingPresetQuickSwitch — 写作预设快速切换
// ---------------------------------------------------------------------------

interface PresetQuickItem {
  id: string;
  name: string;
  category: string;
}

function WritingPresetQuickSwitch({ bookId }: { bookId: string }) {
  const [presets, setPresets] = useState<PresetQuickItem[]>([]);
  const [enabledIds, setEnabledIds] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Lazy-load presets and enabled IDs when dropdown opens
  async function loadData() {
    if (loaded) return;
    try {
      const [presetsResp, bookResp] = await Promise.all([
        fetch("/api/presets").then((r) => r.ok ? r.json() : { presets: [] }),
        fetch(`/api/books/${bookId}`).then((r) => r.ok ? r.json() : {}),
      ]);
      setPresets((presetsResp.presets ?? []).slice(0, 20));
      setEnabledIds(bookResp.enabledPresetIds ?? []);
      setLoaded(true);
    } catch {
      setLoaded(true);
    }
  }

  async function togglePreset(presetId: string) {
    const nextIds = enabledIds.includes(presetId)
      ? enabledIds.filter((id) => id !== presetId)
      : [...enabledIds, presetId];
    setEnabledIds(nextIds);
    try {
      await fetch(`/api/books/${bookId}/presets`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabledPresetIds: nextIds }),
      });
      const label = presets.find((p) => p.id === presetId)?.name ?? presetId;
      const action = nextIds.includes(presetId) ? "启用" : "关闭";
      notify.success(`已${action}预设「${label}」`);
    } catch {
      setEnabledIds(enabledIds); // revert
      notify.error("预设切换失败");
    }
  }

  const enabledCount = enabledIds.length;

  return (
    <DropdownMenu onOpenChange={(open) => { if (open) void loadData(); }}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger
            className="relative rounded-md p-1.5 text-muted-foreground hover:bg-muted transition-colors"
          >
            <PenLine className="size-3.5" />
            {enabledCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex size-3 items-center justify-center rounded-full bg-primary text-[8px] font-bold text-primary-foreground">
                {enabledCount}
              </span>
            )}
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">写作预设</TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="top" align="end" className="min-w-[200px] max-h-[300px] overflow-y-auto">
        <DropdownMenuGroup>
          <DropdownMenuLabel>写作预设快速切换</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {!loaded && (
          <div className="px-2 py-2 text-xs text-muted-foreground">加载中…</div>
        )}
        {loaded && presets.length === 0 && (
          <div className="px-2 py-2 text-xs text-muted-foreground">暂无可用预设</div>
        )}
        {presets.map((preset) => (
          <DropdownMenuItem
            key={preset.id}
            onClick={() => void togglePreset(preset.id)}
            className="flex items-center justify-between gap-2"
          >
            <span className="truncate text-xs">{preset.name}</span>
            {enabledIds.includes(preset.id) && (
              <Check className="size-3 text-primary shrink-0" />
            )}
          </DropdownMenuItem>
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
  trimThreshold,
  onCompact,
  onReset,
}: {
  used: number;
  max: number;
  compactThreshold?: number;
  trimThreshold?: number;
  onCompact?: () => void;
  onReset?: () => void;
}) {
  const hasMax = max > 0;
  const percent = hasMax ? Math.min(100, (used / max) * 100) : 0;
  const trimPercent = hasMax && trimThreshold ? Math.round((trimThreshold / max) * 100) : 80;
  const compactPercent = hasMax && compactThreshold ? Math.round((compactThreshold / max) * 100) : 95;

  const handleReset = () => {
    if (window.confirm("确定要清空上下文吗？这将重置当前会话的所有上下文记忆。")) {
      onReset?.();
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="cursor-default rounded px-1 py-0.5 h-7 inline-flex items-center">
        <ContextRing used={used} max={max} />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="min-w-[240px] p-0">
        {/* 顶部阈值信息 */}
        <div className="px-3 py-2 text-[10px] text-muted-foreground border-b border-border">
          开始裁剪 {trimPercent}% · 开始压缩 {compactPercent}%
        </div>

        <div className="px-3 py-2 space-y-2">
          {/* 上下文百分比 */}
          <div className="text-sm font-medium">
            上下文: {percent.toFixed(1)}%
          </div>

          {/* Token 计数 */}
          <div className="text-xs text-muted-foreground">
            {used.toLocaleString()} / {hasMax ? max.toLocaleString() : "?"} tokens {hasMax ? "(估算)" : ""}
          </div>

          {/* 进度条 */}
          {hasMax && (
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${percent >= 90 ? "bg-red-500" : percent >= 70 ? "bg-yellow-500" : "bg-blue-500"}`}
                style={{ width: `${Math.min(100, percent)}%` }}
              />
            </div>
          )}
        </div>

        <DropdownMenuSeparator />

        {/* 操作按钮 */}
        <DropdownMenuItem onClick={() => onCompact?.()} disabled={!onCompact} className="gap-2">
          <span className="text-xs">※</span>
          <span>立即压缩</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleReset} disabled={!onReset} className="gap-2">
          <span className="text-xs">◇</span>
          <span>清空上下文</span>
        </DropdownMenuItem>
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
