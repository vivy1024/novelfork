import { useEffect, useMemo, useState } from "react";
import { PenTool } from "lucide-react";

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
import { SimpleSelect } from "../ui/simple-select";

export interface NewSessionPayload {
  readonly agentId: string;
  readonly title: string;
  readonly worktree?: string;
  readonly binding?: { readonly type: "standalone" | "book" | "chapter" };
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
    id: "novelist",
    title: "Novelist",
    label: "小说创作",
    description: "写作、规划、审计、经纬管理一站完成。",
    icon: PenTool,
    defaultSessionMode: "chat",
    defaultPermissionMode: "edit",
  },
] as const;

function defaultTitleFor(_presetId: string) {
  return "小说创作会话";
}

export function NewSessionDialog({ open, initialPresetId = "novelist", onOpenChange, onCreate }: NewSessionDialogProps) {
  const [agentId, setAgentId] = useState<string>("novelist");
  const [title, setTitle] = useState(defaultTitleFor(initialPresetId));
  const [sessionMode, setSessionMode] = useState<NarratorSessionMode>("chat");
  const [permissionMode, setPermissionMode] = useState<SessionPermissionMode>("edit");
  const [permissionTouched, setPermissionTouched] = useState(false);
  const [titleTouched, setTitleTouched] = useState(false);
  const [worktree, setWorktree] = useState("");
  const [binding, setBinding] = useState<"standalone" | "book" | "chapter">("standalone");
  const [bindingTouched, setBindingTouched] = useState(false);
  const [runtimeModels, setRuntimeModels] = useState<RuntimeModelOption[]>([]);
  const [selectedRuntimeModelId, setSelectedRuntimeModelId] = useState("");
  const [modelsLoading, setModelsLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAgentId("novelist");
    setTitle(defaultTitleFor("novelist"));
    setSessionMode("chat");
    setPermissionMode("edit");
    setWorktree("");
    setBinding("standalone");
    setBindingTouched(false);
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
          const usableModels = usableRuntimeModels(response.models);
          setRuntimeModels(usableModels);
          setSelectedRuntimeModelId(usableModels[0]?.modelId ?? "");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRuntimeModels([]);
          setSelectedRuntimeModelId("");
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

  const selectedPermission = getSessionPermissionModeOption(permissionMode);
  const selectedRuntimeModel = useMemo(() => runtimeModels.find((model) => model.modelId === selectedRuntimeModelId) ?? runtimeModels[0] ?? null, [runtimeModels, selectedRuntimeModelId]);
  const selectedRuntimeModelRef = selectedRuntimeModel ? splitRuntimeModelRef(selectedRuntimeModel) : null;
  const hasRuntimeModels = runtimeModels.length > 0;

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
    const trimmedTitle = title.trim() || defaultTitleFor("novelist");
    if (!trimmedAgentId || !selectedRuntimeModelRef) return;

    const trimmedWorktree = worktree.trim();
    onCreate({
      agentId: trimmedAgentId,
      title: trimmedTitle,
      ...(trimmedWorktree ? { worktree: trimmedWorktree } : {}),
      ...(bindingTouched ? { binding: { type: binding } } : {}),
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
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto overflow-x-hidden p-0" showCloseButton>
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>新建会话</DialogTitle>
          <DialogDescription>
            创建小说创作会话。统一 Novelist 角色覆盖写作、规划、审计、经纬管理全流程。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 px-6 pb-6">
          <div className="rounded-2xl border border-border/60 bg-muted/30 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">角色</p>
                <h3 className="mt-1 text-sm font-medium text-foreground">Novelist · 小说创作</h3>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[10px] font-medium text-primary">
                  全能
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
              写作、规划、审计、世界观构建、伏笔管理，一个角色全部搞定。根据你的指令自动选择工作流程。
            </p>
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
          </div>

          <div className="space-y-3">
            <div>
              <Label>运行时模型</Label>
            </div>
            {modelsLoading ? (
              <p className="text-xs text-muted-foreground">正在读取统一模型池…</p>
            ) : selectedRuntimeModel ? (
              <SimpleSelect
                aria-label="运行时模型"
                onValueChange={(val) => setSelectedRuntimeModelId(val)}
                value={selectedRuntimeModel.modelId}
                options={runtimeModels.map((model) => ({ value: model.modelId, label: runtimeModelLabel(model) }))}
                className="w-full"
              />
            ) : (
              <div className="rounded-xl border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                尚未配置可用模型
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div>
              <Label>权限模式</Label>
            </div>
            <div className="grid gap-2">
              {SESSION_PERMISSION_MODE_OPTIONS.map((option) => {
                const active = option.value === permissionMode;
                return (
                  <Button
                    key={option.value}
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setPermissionMode(option.value);
                      setPermissionTouched(true);
                    }}
                    className={`h-auto rounded-xl border px-3 py-2 text-left justify-start items-start ${
                      active
                        ? "border-primary bg-primary/5 shadow-sm"
                        : "border-border bg-card hover:border-primary/40 hover:bg-muted/40"
                    }`}
                  >
                    <div className="w-full">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-foreground">{option.label}</span>
                        <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground">
                          {option.shortLabel}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs leading-4 text-muted-foreground">{option.description}</p>
                    </div>
                  </Button>
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
                placeholder="小说创作会话"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-session-agent-id">Agent ID（高级）</Label>
              <Input
                id="new-session-agent-id"
                aria-label="Agent ID"
                value={agentId}
                onChange={(event) => handleAgentIdChange(event.target.value)}
                placeholder="novelist"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="new-session-worktree">工作目录</Label>
              <Input
                id="new-session-worktree"
                aria-label="工作目录"
                value={worktree}
                onChange={(event) => setWorktree(event.target.value)}
                placeholder="例如 D:\\novels\\my-book"
              />
              <p className="text-[10px] text-muted-foreground">书籍叙述者通过书籍页面自动创建，此处新建的是独立叙述者。</p>
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
