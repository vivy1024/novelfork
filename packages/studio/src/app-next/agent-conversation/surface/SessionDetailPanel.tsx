/**
 * SessionDetailPanel — 对标 NarraFork 会话详情面板
 *
 * 通过 info-circle 图标打开的侧面板，包含：
 * 1. 统计卡片网格（消息/成本/输入/输出/缓存/查看者/终端/浏览器/待批权限）
 * 2. 基础信息（状态/ID/类型/工作目录编辑/时间/API会话ID）
 * 3. 会话配置（模型/权限/思考强度/快速模式/宽松规划/自动批准/危险反思/自动裁剪/计划模式）
 * 4. 自定义 Traits + Subagent 模型限制 + 工具限制
 * 5. 关联关系（所属章节/继承模式/分叉消息）
 * 6. 运行状态（查看者/浏览器会话/待处理权限）
 * 7. 访问规则（白名单/黑名单目录+命令）
 */

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import type { ConversationStatus } from "./ConversationStatusBar";
import type { ConversationSurfaceMessage } from "./MessageStream";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionDetailData {
  /** 会话 ID */
  sessionId: string;
  /** 叙述者类型 */
  narratorType?: "primary" | "subagent" | "background";
  /** 创建时间 ISO */
  createdAt?: string;
  /** 更新时间 ISO */
  updatedAt?: string;
  /** 最后消息时间 ISO */
  lastMessageAt?: string;
  /** 本轮开始时间 ISO */
  turnStartedAt?: string;
  /** API 会话 ID */
  apiSessionId?: string;
  /** 工作目录 */
  workDir?: string;
  /** 关联章节 */
  chapterId?: string;
  chapterLabel?: string;
  /** 继承模式 */
  inheritMode?: "full" | "compressed" | "fresh";
  /** 分叉消息 */
  forkMessage?: string;
  /** 父会话 ID */
  parentSessionId?: string;
  /** 自定义 Traits */
  customTraits?: string;
  /** 工具限制（禁用的工具名列表） */
  disabledTools?: string[];
  /** 会话配置 */
  sessionConfig?: {
    mode?: "normal" | "plan";
    toolPolicy?: { allow?: string[]; deny?: string[]; ask?: string[] };
  };
  /** 运行时控制（从 /api/settings 读取） */
  runtimeConfig?: {
    relaxedPlanning?: boolean;
    yoloSkipReadonlyConfirmation?: boolean;
    smartOutputCheck?: boolean;
    translateThinking?: boolean;
  };
  /** Subagent 模型配置（从 /api/settings 读取） */
  subagentModels?: {
    explore?: string;
    plan?: string;
    general?: string;
  };
  /** 访问规则 */
  accessRules?: {
    allowDirs?: Array<{ path: string; permission: string }>;
    denyDirs?: Array<{ path: string }>;
    allowCommands?: string[];
    denyCommands?: string[];
  };
  /** 查看者列表 */
  viewers?: string[];
  /** 浏览器会话 */
  browserSessions?: Array<{ id: string; url?: string }>;
  /** 待处理权限数 */
  pendingPermissions?: number;
  /** 终端数 */
  terminalCount?: number;
  /** 使用统计 */
  stats?: {
    messageCount?: number;
    cost?: number;
    totalInput?: number;
    totalOutput?: number;
    cacheRead?: number;
  };
}

export interface SessionDetailPanelProps {
  status: ConversationStatus;
  messages: readonly ConversationSurfaceMessage[];
  detail?: SessionDetailData;
  onUpdateWorkDir?: (path: string) => Promise<void> | void;
  onUpdateTraits?: (traits: string) => Promise<void> | void;
  onUpdateDisabledTools?: (tools: string[]) => Promise<void> | void;
  onUpdateSessionConfig?: (patch: Record<string, unknown>) => Promise<void> | void;
  onUpdateAccessRules?: (patch: { directoryAllowlist?: string[]; directoryBlocklist?: string[] }) => Promise<void> | void;
  onUpdateSubagentModels?: (patch: { explore?: string; plan?: string; general?: string }) => Promise<void> | void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NARRATOR_STATE_LABELS: Record<string, string> = {
  idle: "空闲",
  working: "工作中",
  waiting: "等待中",
  archived: "已归档",
};

const NARRATOR_STATE_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  idle: "secondary",
  working: "default",
  waiting: "outline",
  archived: "secondary",
};

const NARRATOR_TYPE_LABELS: Record<string, string> = {
  primary: "主叙述者",
  subagent: "子代理",
  background: "后台叙述者",
};

function formatNumber(n: number | undefined): string {
  if (n === undefined || n === null) return "0";
  return n.toLocaleString("zh-CN");
}

function formatTime(iso: string | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-0.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold tabular-nums">{value}</p>
      {note && <p className="text-[10px] text-muted-foreground">{note}</p>}
    </div>
  );
}

function DetailRow({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className={`text-xs text-right break-all ${mono ? "font-mono" : ""}`}>{children}</span>
    </div>
  );
}

function SectionCard({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      {title && <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{title}</h4>}
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// WorkDirEditor
// ---------------------------------------------------------------------------

function WorkDirEditor({ currentPath, onSave }: { currentPath?: string; onSave?: (path: string) => Promise<void> | void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentPath ?? "");
  const isDirty = value !== (currentPath ?? "");

  const handleSave = () => {
    if (isDirty && onSave) {
      void onSave(value);
    }
    setEditing(false);
  };

  const handleCancel = () => {
    setValue(currentPath ?? "");
    setEditing(false);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">工作目录</span>
      </div>
      <p className="text-[10px] text-muted-foreground">修改后会作为后续工具调用的工作目录，并在历史中记录一条提醒消息。</p>
      <Input
        placeholder="输入绝对路径..."
        value={editing ? value : (currentPath ?? "")}
        onChange={(e) => { setEditing(true); setValue(e.target.value); }}
        onFocus={() => { if (!editing) { setValue(currentPath ?? ""); setEditing(true); } }}
        className="font-mono text-xs"
      />
      <div className="flex gap-2">
        <Button variant="outline" size="xs" disabled={!isDirty} onClick={handleCancel}>
          取消
        </Button>
        <Button size="xs" disabled={!isDirty} onClick={handleSave}>
          保存
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ConfigRow — 三段选择器（继承全局/开启/关闭）
// ---------------------------------------------------------------------------

function TriStateControl({ label, value, effectiveValue, onChange }: {
  label: string;
  value: "inherit" | "on" | "off";
  effectiveValue?: string;
  onChange?: (v: "inherit" | "on" | "off") => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <div className="space-y-1 text-right">
        <div className="inline-flex rounded-md border border-border overflow-hidden text-[10px]">
          {(["inherit", "on", "off"] as const).map((opt) => (
            <button
              key={opt}
              type="button"
              className={`px-2 py-0.5 transition-colors ${value === opt ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              onClick={() => onChange?.(opt)}
            >
              {opt === "inherit" ? "继承全局" : opt === "on" ? "开启" : "关闭"}
            </button>
          ))}
        </div>
        {effectiveValue && <p className="text-[10px] text-muted-foreground">当前：{effectiveValue}</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function SessionDetailPanel({
  status,
  messages,
  detail,
  onUpdateWorkDir,
  onUpdateTraits,
  onUpdateDisabledTools,
  onUpdateSessionConfig,
  onUpdateAccessRules,
  onUpdateSubagentModels,
}: SessionDetailPanelProps) {
  const [traits, setTraits] = useState(detail?.customTraits ?? "");
  const [traitsDirty, setTraitsDirty] = useState(false);
  const [disabledToolsText, setDisabledToolsText] = useState((detail?.disabledTools ?? []).join("\n"));
  const [disabledToolsDirty, setDisabledToolsDirty] = useState(false);
  const [autoApprovePlan, setAutoApprovePlan] = useState<"inherit" | "on" | "off">("inherit");
  const [dangerReflection, setDangerReflection] = useState<"inherit" | "on" | "off">("inherit");
  const [newAllowDir, setNewAllowDir] = useState("");
  const [newDenyDir, setNewDenyDir] = useState("");

  const messageCount = detail?.stats?.messageCount ?? messages.length;
  const narratorState = status.narratorState ?? "idle";

  return (
    <div className="space-y-4 py-2">
      {/* ── 统计卡片网格 ── */}
      <div className="grid grid-cols-2 gap-2">
        <StatCard label="消息" value={formatNumber(messageCount)} />
        <StatCard
          label="成本"
          value={detail?.stats?.cost !== undefined ? `$${detail.stats.cost.toFixed(4)}` : "$0.0000"}
          note="来自使用历史 · 含子代理"
        />
        <StatCard
          label="总输入"
          value={formatNumber(detail?.stats?.totalInput)}
          note="来自使用历史 · 含子代理"
        />
        <StatCard
          label="总输出"
          value={formatNumber(detail?.stats?.totalOutput)}
          note="来自使用历史 · 含子代理"
        />
        <StatCard
          label="缓存读取"
          value={formatNumber(detail?.stats?.cacheRead)}
          note="来自使用历史 · 含子代理"
        />
        <StatCard label="查看者" value={String(detail?.viewers?.length ?? 0)} />
        <StatCard label="终端" value={String(detail?.terminalCount ?? 0)} />
        <StatCard label="浏览器" value={String(detail?.browserSessions?.length ?? 0)} />
      </div>

      <StatCard label="待批权限" value={String(detail?.pendingPermissions ?? 0)} />

      <Separator />

      {/* ── 基础信息 ── */}
      <SectionCard title="基础信息">
        <DetailRow label="状态">
          <Badge variant={NARRATOR_STATE_VARIANTS[narratorState] ?? "secondary"}>
            {NARRATOR_STATE_LABELS[narratorState] ?? narratorState}
          </Badge>
        </DetailRow>
        <DetailRow label="ID" mono>{detail?.sessionId ?? "—"}</DetailRow>
        <DetailRow label="类型">
          {NARRATOR_TYPE_LABELS[detail?.narratorType ?? "primary"] ?? "主叙述者"}
        </DetailRow>

        <Separator className="my-2" />

        <WorkDirEditor currentPath={detail?.workDir ?? status.workspace?.path} onSave={onUpdateWorkDir} />

        <Separator className="my-2" />

        <DetailRow label="创建时间">{formatTime(detail?.createdAt)}</DetailRow>
        <DetailRow label="更新时间">{formatTime(detail?.updatedAt)}</DetailRow>
        <DetailRow label="最后消息">{formatTime(detail?.lastMessageAt)}</DetailRow>
        <DetailRow label="本轮开始">{formatTime(detail?.turnStartedAt)}</DetailRow>
        <DetailRow label="API 会话 ID" mono>{detail?.apiSessionId ?? "—"}</DetailRow>
      </SectionCard>

      {/* ── 会话配置 ── */}
      <SectionCard title="会话配置">
        <DetailRow label="模型">{status.modelLabel ?? status.modelId ?? "—"}</DetailRow>
        <DetailRow label="权限模式">{status.permissionMode ?? "—"}</DetailRow>
        <DetailRow label="思考强度">{status.reasoningEffort ?? "—"}</DetailRow>
        <DetailRow label="快速模式">{detail?.runtimeConfig?.yoloSkipReadonlyConfirmation ? "开启" : "关闭"}</DetailRow>
        <DetailRow label="宽松规划">{detail?.runtimeConfig?.relaxedPlanning ? "开启" : "关闭"}</DetailRow>

        <Separator className="my-2" />

        <TriStateControl
          label="自动批准计划"
          value={autoApprovePlan}
          effectiveValue={autoApprovePlan === "inherit" ? "继承全局" : autoApprovePlan === "on" ? "开启" : "关闭"}
          onChange={(v) => { setAutoApprovePlan(v); onUpdateSessionConfig?.({ autoApprovePlan: v }); }}
        />
        <TriStateControl
          label="危险反思"
          value={dangerReflection}
          effectiveValue={dangerReflection === "inherit" ? "继承全局" : dangerReflection === "on" ? "开启" : "关闭"}
          onChange={(v) => { setDangerReflection(v); onUpdateSessionConfig?.({ dangerReflection: v }); }}
        />

        <Separator className="my-2" />

        <DetailRow label="自动裁剪">{detail?.runtimeConfig?.smartOutputCheck ? "开启" : "关闭"}</DetailRow>
        <DetailRow label="计划模式">{detail?.sessionConfig?.mode === "plan" ? "开启" : "关闭"}</DetailRow>
        <DetailRow label="后台状态">
          {status.narratorState === "working" ? "运行中" : status.narratorState === "waiting" ? "等待中" : "空闲"}
        </DetailRow>
        <DetailRow label="启用工具">
          {detail?.sessionConfig?.toolPolicy?.allow?.length
            ? detail.sessionConfig.toolPolicy.allow.join(", ")
            : detail?.sessionConfig?.toolPolicy?.deny?.length
              ? `排除 ${detail.sessionConfig.toolPolicy.deny.length} 个`
              : "全部"}
        </DetailRow>
      </SectionCard>

      {/* ── 自定义 Traits ── */}
      <SectionCard title="自定义 Traits">
        <Textarea
          placeholder="为此会话添加自定义特征描述..."
          value={traits}
          onChange={(e) => { setTraits(e.target.value); setTraitsDirty(true); }}
          className="min-h-[60px] text-xs"
        />
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="xs"
            disabled={!traitsDirty}
            onClick={() => { setTraits(detail?.customTraits ?? ""); setTraitsDirty(false); }}
          >
            清除 trait
          </Button>
          <Button
            size="xs"
            disabled={!traitsDirty}
            onClick={() => { onUpdateTraits?.(traits); setTraitsDirty(false); }}
          >
            保存
          </Button>
        </div>
      </SectionCard>

      {/* ── Subagent 模型限制 ── */}
      <SectionCard title="Subagent 模型限制">
        <p className="text-[10px] text-muted-foreground">
          为此会话覆盖全局 subagent 模型池，并可说明每个模型的用途。Review 与自定义 subagent 默认使用 General 池。
        </p>
        <div className="space-y-2">
          {(["Explore", "Plan", "General"] as const).map((pool) => {
            const key = pool.toLowerCase() as "explore" | "plan" | "general";
            const currentValue = detail?.subagentModels?.[key] ?? "";
            return (
              <div key={pool}>
                <label className="text-[11px] font-medium">{pool}</label>
                <Input
                  placeholder="providerId:modelId"
                  className="mt-1 text-xs font-mono"
                  defaultValue={currentValue}
                  onBlur={(e) => {
                    const val = e.target.value.trim();
                    if (val !== currentValue) {
                      onUpdateSubagentModels?.({ [key]: val });
                    }
                  }}
                />
              </div>
            );
          })}
        </div>
      </SectionCard>

      {/* ── 工具限制 ── */}
      <SectionCard title="工具限制">
        <p className="text-[10px] text-muted-foreground">
          被选中的工具不会提供给模型；即使模型尝试调用，也会在执行前被拒绝。
        </p>
        <Textarea
          placeholder="每行一个工具名..."
          value={disabledToolsText}
          onChange={(e) => { setDisabledToolsText(e.target.value); setDisabledToolsDirty(true); }}
          className="min-h-[60px] text-xs font-mono"
        />
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="xs"
            disabled={!disabledToolsDirty}
            onClick={() => { setDisabledToolsText((detail?.disabledTools ?? []).join("\n")); setDisabledToolsDirty(false); }}
          >
            重置
          </Button>
          <Button
            size="xs"
            disabled={!disabledToolsDirty}
            onClick={() => {
              const tools = disabledToolsText.split("\n").map(s => s.trim()).filter(Boolean);
              onUpdateDisabledTools?.(tools);
              setDisabledToolsDirty(false);
            }}
          >
            保存
          </Button>
        </div>
      </SectionCard>

      <Separator />

      {/* ── 关联关系 ── */}
      <SectionCard title="关联关系">
        <DetailRow label="所属章节">
          {detail?.chapterLabel ?? "—"}
          {detail?.chapterId && (
            <span className="ml-1 font-mono text-[10px] text-muted-foreground">{detail.chapterId.slice(0, 8)}</span>
          )}
        </DetailRow>
        <DetailRow label="继承模式">
          {detail?.inheritMode === "full" ? "完整继承" : detail?.inheritMode === "compressed" ? "压缩继承" : "全新上下文"}
        </DetailRow>
        <DetailRow label="分叉消息">{detail?.forkMessage ?? "无"}</DetailRow>
      </SectionCard>

      {/* ── 运行状态 ── */}
      <SectionCard title="运行状态">
        <DetailRow label="查看者">
          {detail?.viewers?.length ? detail.viewers.join(", ") : "无"}
        </DetailRow>
        <DetailRow label="浏览器会话">
          {detail?.browserSessions?.length
            ? detail.browserSessions.map((s) => s.id).join(", ")
            : "无"}
        </DetailRow>
        <DetailRow label="待处理权限">
          {detail?.pendingPermissions ? String(detail.pendingPermissions) : "无"}
        </DetailRow>
      </SectionCard>

      {/* ── 访问规则 ── */}
      <SectionCard title="访问规则">
        <div className="space-y-2">
          <div>
            <p className="text-[11px] font-medium">
              白名单目录 · {detail?.accessRules?.allowDirs?.length ?? 0}
            </p>
            {detail?.accessRules?.allowDirs?.length ? (
              <ul className="mt-1 space-y-0.5">
                {detail.accessRules.allowDirs.map((dir) => (
                  <li key={dir.path} className="flex items-center justify-between text-[11px]">
                    <code className="font-mono truncate">{dir.path}</code>
                    <div className="flex items-center gap-1 shrink-0">
                      <Badge variant="outline" className="text-[9px]">{dir.permission}</Badge>
                      <Button
                        variant="ghost"
                        size="xs"
                        className="h-4 w-4 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => {
                          const remaining = (detail.accessRules?.allowDirs ?? []).filter(d => d.path !== dir.path).map(d => d.path);
                          onUpdateAccessRules?.({ directoryAllowlist: remaining });
                        }}
                      >
                        ×
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[10px] text-muted-foreground mt-0.5">无规则</p>
            )}
            <div className="flex gap-1 mt-1">
              <Input
                placeholder="添加白名单目录..."
                value={newAllowDir}
                onChange={(e) => setNewAllowDir(e.target.value)}
                className="text-xs h-6 font-mono"
              />
              <Button
                size="xs"
                className="h-6 shrink-0"
                disabled={!newAllowDir.trim()}
                onClick={() => {
                  const current = (detail?.accessRules?.allowDirs ?? []).map(d => d.path);
                  onUpdateAccessRules?.({ directoryAllowlist: [...current, newAllowDir.trim()] });
                  setNewAllowDir("");
                }}
              >
                添加
              </Button>
            </div>
          </div>

          <div>
            <p className="text-[11px] font-medium">
              黑名单目录 · {detail?.accessRules?.denyDirs?.length ?? 0}
            </p>
            {detail?.accessRules?.denyDirs?.length ? (
              <ul className="mt-1 space-y-0.5">
                {detail.accessRules.denyDirs.map((dir) => (
                  <li key={dir.path} className="flex items-center justify-between text-[11px]">
                    <code className="font-mono truncate">{dir.path}</code>
                    <Button
                      variant="ghost"
                      size="xs"
                      className="h-4 w-4 p-0 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => {
                        const remaining = (detail.accessRules?.denyDirs ?? []).filter(d => d.path !== dir.path).map(d => d.path);
                        onUpdateAccessRules?.({ directoryBlocklist: remaining });
                      }}
                    >
                      ×
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[10px] text-muted-foreground mt-0.5">无规则</p>
            )}
            <div className="flex gap-1 mt-1">
              <Input
                placeholder="添加黑名单目录..."
                value={newDenyDir}
                onChange={(e) => setNewDenyDir(e.target.value)}
                className="text-xs h-6 font-mono"
              />
              <Button
                size="xs"
                className="h-6 shrink-0"
                disabled={!newDenyDir.trim()}
                onClick={() => {
                  const current = (detail?.accessRules?.denyDirs ?? []).map(d => d.path);
                  onUpdateAccessRules?.({ directoryBlocklist: [...current, newDenyDir.trim()] });
                  setNewDenyDir("");
                }}
              >
                添加
              </Button>
            </div>
          </div>

          <div>
            <p className="text-[11px] font-medium">
              命令白名单 · {detail?.accessRules?.allowCommands?.length ?? 0}
            </p>
            {detail?.accessRules?.allowCommands?.length ? (
              <ul className="mt-1 space-y-0.5">
                {detail.accessRules.allowCommands.map((cmd) => (
                  <li key={cmd} className="text-[11px] font-mono">{cmd}</li>
                ))}
              </ul>
            ) : (
              <p className="text-[10px] text-muted-foreground mt-0.5">无规则</p>
            )}
          </div>

          <div>
            <p className="text-[11px] font-medium">
              命令黑名单 · {detail?.accessRules?.denyCommands?.length ?? 0}
            </p>
            {detail?.accessRules?.denyCommands?.length ? (
              <ul className="mt-1 space-y-0.5">
                {detail.accessRules.denyCommands.map((cmd) => (
                  <li key={cmd} className="text-[11px] font-mono">{cmd}</li>
                ))}
              </ul>
            ) : (
              <p className="text-[10px] text-muted-foreground mt-0.5">无规则</p>
            )}
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
