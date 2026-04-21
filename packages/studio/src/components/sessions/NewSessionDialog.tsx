import { useEffect, useMemo, useState } from "react";
import { Bot, PenTool, ShieldAlert, Sparkles } from "lucide-react";

import type { NarratorSessionMode } from "@/shared/session-types";

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
  },
  {
    id: "planner",
    title: "Planner",
    label: "规划 Planner",
    description: "先拆解章节目标、节奏与结构。",
    icon: Sparkles,
    defaultSessionMode: "plan",
  },
  {
    id: "auditor",
    title: "Auditor",
    label: "审计 Auditor",
    description: "做连续性、设定与逻辑排查。",
    icon: ShieldAlert,
    defaultSessionMode: "chat",
  },
  {
    id: "architect",
    title: "Architect",
    label: "设定 Architect",
    description: "用于世界观、卷纲与题材设计。",
    icon: Bot,
    defaultSessionMode: "chat",
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
  const [titleTouched, setTitleTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    const nextPreset = SESSION_PRESETS.find((item) => item.id === initialPresetId) ?? SESSION_PRESETS[0];
    setPresetId(nextPreset.id);
    setAgentId(nextPreset.id);
    setTitle(defaultTitleFor(nextPreset.id));
    setSessionMode(nextPreset.defaultSessionMode);
    setTitleTouched(false);
  }, [initialPresetId, open]);

  const selectedPreset = useMemo(
    () => SESSION_PRESETS.find((item) => item.id === presetId) ?? SESSION_PRESETS[0],
    [presetId],
  );

  const handlePresetSelect = (nextPresetId: (typeof SESSION_PRESETS)[number]["id"]) => {
    setPresetId(nextPresetId);
    setAgentId(nextPresetId);
    const nextPreset = SESSION_PRESETS.find((item) => item.id === nextPresetId) ?? SESSION_PRESETS[0];
    setSessionMode(nextPreset.defaultSessionMode);
    if (!titleTouched || !title.trim() || title === defaultTitleFor(presetId)) {
      setTitle(defaultTitleFor(nextPresetId));
    }
  };

  const handleSubmit = () => {
    const trimmedAgentId = agentId.trim();
    const trimmedTitle = title.trim() || defaultTitleFor(presetId);
    if (!trimmedAgentId) return;

    onCreate({
      agentId: trimmedAgentId,
      title: trimmedTitle,
      sessionMode,
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
              </div>
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              当前标题：{title.trim() || defaultTitleFor(selectedPreset.id)}。未手动编辑时会自动生成“{defaultTitleFor(selectedPreset.id)}”，切换模板时也会跟着更新。
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
                    setSessionMode(mode);
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
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-session-agent-id">Agent ID</Label>
              <Input
                id="new-session-agent-id"
                aria-label="Agent ID"
                value={agentId}
                onChange={(event) => setAgentId(event.target.value)}
                placeholder={selectedPreset.id}
              />
            </div>
          </div>
        </div>

        <DialogFooter className="mt-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={!agentId.trim()}>
            创建会话
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
