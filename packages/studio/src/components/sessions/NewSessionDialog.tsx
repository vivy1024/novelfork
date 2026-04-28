import { useEffect, useMemo, useState } from "react";
import { Bot, PenTool, ShieldAlert, Sparkles } from "lucide-react";

import { fetchJson } from "@/hooks/use-api";
import {
  runtimeModelLabel,
  splitRuntimeModelRef,
  usableRuntimeModels,
  type RuntimeModelOption,
} from "@/lib/runtime-model-options";

import {
  SESSION_PERMISSION_MODE_OPTIONS,
  getRecommendedSessionPermissionMode,
  getSessionPermissionModeOption,
  type NarratorSessionMode,
  type SessionPermissionMode,
} from "@/shared/session-types";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

export interface NewSessionPayload {
  readonly agentId: string;
  readonly title: string;
  readonly sessionMode: NarratorSessionMode;
  readonly sessionConfig: {
    readonly providerId: string;
    readonly modelId: string;
    readonly permissionMode: SessionPermissionMode;
  };
}

export type SessionPresetId = (typeof SESSION_PRESETS)[number]["id"];

interface NewSessionDialogProps {
  readonly open: boolean;
  readonly initialPresetId?: SessionPresetId;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCreate: (payload: NewSessionPayload) => void;
}

export const SESSION_MODE_LABELS: Record<NarratorSessionMode, string> = {
  chat: "对话模式",
  plan: "计划模式",
};

export const SESSION_PRESETS = [
  {
    id: "writer",
    title: "Writer",
    label: "写作 Writer",
    description: "直接进入章节创作与续写。",
    icon: PenTool,
    defaultSessionMode: "chat",
    defaultPermissionMode: "edit",
  },
  {
    id: "planner",
    title: "Planner",
    label: "规划 Planner",
    description: "先拆解章节目标、节奏与结构。",
    icon: Sparkles,
    defaultSessionMode: "plan",
    defaultPermissionMode: "plan",
  },
  {
    id: "auditor",
    title: "Auditor",
    label: "审计 Auditor",
    description: "做连续性、设定与逻辑排查。",
    icon: ShieldAlert,
    defaultSessionMode: "chat",
    defaultPermissionMode: "read",
  },
  {
    id: "architect",
    title: "Architect",
    label: "设定 Architect",
    description: "用于世界观、卷纲与题材设计。",
    icon: Bot,
    defaultSessionMode: "chat",
    defaultPermissionMode: "ask",
  },
] as const;

function defaultTitleFor(presetId: string) {
  const preset = SESSION_PRESETS.find((item) => item.id === presetId) ?? SESSION_PRESETS[0];
  return `${preset.title} 会话`;
}

export function NewSessionDialog({ open, initialPresetId = "writer", onOpenChange, onCreate }: NewSessionDialogProps) {
  const [presetId, setPresetId] = useState<(typeof SESSION_PRESETS)[number]["id"]>(initialPresetId);
  const [agentId, setAgentId] = useState<string>(initialPresetId);
  const [title, setTitle] = useState(defaultTitleFor(initialPresetId));
  const [sessionMode, setSessionMode] = useState<NarratorSessionMode>(
    (SESSION_PRESETS.find((item) => item.id === initialPresetId) ?? SESSION_PRESETS[0]).defaultSessionMode,
  );
  const [permissionMode, setPermissionMode] = useState<SessionPermissionMode>(
    (SESSION_PRESETS.find((item) => item.id === initialPresetId) ?? SESSION_PRESETS[0]).defaultPermissionMode,
  );
  const [permissionTouched, setPermissionTouched] = useState(false);
  const [titleTouched, setTitleTouched] = useState(false);
  const [runtimeModels, setRuntimeModels] = useState<RuntimeModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const nextPreset = SESSION_PRESETS.find((item) => item.id === initialPresetId) ?? SESSION_PRESETS[0];
    setPresetId(nextPreset.id);
    setAgentId(nextPreset.id);
    setTitle(defaultTitleFor(nextPreset.id));
    setSessionMode(nextPreset.defaultSessionMode);
    setPermissionMode(nextPreset.defaultPermissionMode);
    setPermissionTouched(false);
    setTitleTouched(false);
  }, [initialPresetId, open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setModelsLoading(true);
    void fetchJson<{ models?: RuntimeModelOption[] }>("/api/providers/models")
      .then((response) => {
        if (!cancelled) {
          setRuntimeModels(usableRuntimeModels(response.models));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRuntimeModels([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setModelsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  const selectedPreset = useMemo(
    () => SESSION_PRESETS.find((item) => item.id === presetId) ?? SESSION_PRESETS[0],
    [presetId],
  );
  const selectedPermission = getSessionPermissionModeOption(permissionMode);
  const selectedRuntimeModel = useMemo(() => runtimeModels[0] ?? null, [runtimeModels]);
  const selectedRuntimeModelRef = selectedRuntimeModel ? splitRuntimeModelRef(selectedRuntimeModel) : null;
  const hasRuntimeModels = runtimeModels.length > 0;

  const handlePresetSelect = (nextPresetId: (typeof SESSION_PRESETS)[number]["id"]) => {
    setPresetId(nextPresetId);
    setAgentId(nextPresetId);
    const nextPreset = SESSION_PRESETS.find((item) => item.id === nextPresetId) ?? SESSION_PRESETS[0];
    setSessionMode(nextPreset.defaultSessionMode);
    setPermissionMode(nextPreset.defaultPermissionMode);
    setPermissionTouched(false);
    if (!titleTouched || !title.trim() || title === defaultTitleFor(presetId)) {
      setTitle(defaultTitleFor(nextPresetId));
    }
  };

  const handleAgentIdChange = (nextAgentId: string) => {
    setAgentId(nextAgentId);
    if (!permissionTouched) {
      setPermissionMode(getRecommendedSessionPermissionMode({ agentId: nextAgentId, sessionMode }));
    }
  };

  const handleSessionModeChange = (nextMode: NarratorSessionMode) => {
    setSessionMode(nextMode);
    if (!permissionTouched) {
      setPermissionMode(getRecommendedSessionPermissionMode({ agentId, sessionMode: nextMode }));
    }
  };

  const handleSubmit = () => {
    const trimmedAgentId = agentId.trim();
    const trimmedTitle = title.trim() || defaultTitleFor(presetId);
    if (!trimmedAgentId || !selectedRuntimeModelRef) return;

    onCreate({
      agentId: trimmedAgentId,
      title: trimmedTitle,
      sessionMode,
      sessionConfig: {
        providerId: selectedRuntimeModelRef.providerId,
        modelId: selectedRuntimeModelRef.modelId,
        permissionMode,
      },
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0" showCloseButton>
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>新建会话</DialogTitle>
          <DialogDescription>
            不再用 prompt 手输 Agent ID，改成结构化表单选择常用会话模板，再补标题与自定义 Agent。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 px-6 pb-6">
          <div className="rounded-2xl border border-border/60 bg-muted/30 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">当前对象</p>
                <h3 className="mt-1 text-sm font-medium text-foreground">{selectedPreset.label}</h3>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[10px] font-medium text-primary">
                  {selectedPreset.title}
                </span>
                <span className="rounded-full border border-border/60 px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
                  {SESSION_MODE_LABELS[sessionMode]}
                </span>
                <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[10px] font-medium text-amber-700">
                  {selectedPermission.label}
                </span>
              </div>
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              当前标题：{title.trim() || defaultTitleFor(selectedPreset.id)}。未手动编辑时会自动生成“{defaultTitleFor(selectedPreset.id)}”，切换模板时也会跟着更新。
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              权限说明：{selectedPermission.description}（适合：{selectedPermission.bestFor}）。
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {SESSION_PRESETS.map((preset) => {
              const Icon = preset.icon;
              const active = preset.id === presetId;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handlePresetSelect(preset.id)}
                  className={`rounded-xl border px-4 py-4 text-left transition-all ${
                    active
                      ? "border-primary bg-primary/5 shadow-sm"
                      : "border-border bg-card hover:border-primary/40 hover:bg-muted/40"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 flex size-9 items-center justify-center rounded-lg ${active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                      <Icon className="size-4" />
                    </div>
                    <div className="space-y-1">
                      <div className="text-sm font-medium text-foreground">{preset.label}</div>
                      <p className="text-xs leading-5 text-muted-foreground">{preset.description}</p>
                      <p className="text-[11px] font-medium text-primary/80">
                        默认权限：{getSessionPermissionModeOption(preset.defaultPermissionMode).label}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="space-y-2">
            <Label>启动模式</Label>
            <div className="flex flex-wrap gap-2">
              {(["chat", "plan"] as NarratorSessionMode[]).map((mode) => (
                <Button
                  key={mode}
                  type="button"
                  variant={sessionMode === mode ? "default" : "outline"}
                  onClick={() => {
                    handleSessionModeChange(mode);
                  }}
                >
                  {SESSION_MODE_LABELS[mode]}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Planner 默认进入计划模式；其他模板默认对话模式，也可以在创建前手动切换。
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <Label>运行时模型</Label>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                新会话默认使用统一运行时模型池中的首个可用模型；模型池为空时禁止创建。
              </p>
            </div>
            {modelsLoading ? (
              <p className="text-xs text-muted-foreground">正在读取统一模型池…</p>
            ) : selectedRuntimeModel ? (
              <div className="rounded-xl border border-border/60 bg-muted/30 px-3 py-3 text-sm text-foreground">
                {runtimeModelLabel(selectedRuntimeModel)}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                尚未配置可用模型
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div>
              <Label>权限模式</Label>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                创建时就决定本会话能否读资料、改正文、运行 Shell 或进入 Worktree；后续仍可在会话详情中调整。
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {SESSION_PERMISSION_MODE_OPTIONS.map((option) => {
                const active = option.value === permissionMode;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      setPermissionMode(option.value);
                      setPermissionTouched(true);
                    }}
                    className={`rounded-xl border px-3 py-3 text-left transition-all ${
                      active
                        ? "border-primary bg-primary/5 shadow-sm"
                        : "border-border bg-card hover:border-primary/40 hover:bg-muted/40"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-foreground">{option.label}</span>
                      <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground">
                        {option.shortLabel}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{option.description}</p>
                    <p className="mt-1 text-[10px] leading-4 text-muted-foreground">适合：{option.bestFor}</p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="new-session-title">会话标题</Label>
              <Input
                id="new-session-title"
                aria-label="会话标题"
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value);
                  setTitleTouched(true);
                }}
                placeholder={defaultTitleFor(presetId)}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-session-agent-id">Agent ID</Label>
              <Input
                id="new-session-agent-id"
                aria-label="Agent ID"
                value={agentId}
                onChange={(event) => handleAgentIdChange(event.target.value)}
                placeholder={selectedPreset.id}
              />
            </div>
          </div>
        </div>

        <DialogFooter className="mt-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={!agentId.trim() || !hasRuntimeModels || modelsLoading}>
            创建会话
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
