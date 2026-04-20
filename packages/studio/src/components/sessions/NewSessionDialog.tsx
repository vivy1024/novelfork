import { useEffect, useMemo, useState } from "react";
import { Bot, PenTool, ShieldAlert, Sparkles } from "lucide-react";

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
}

interface NewSessionDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCreate: (payload: NewSessionPayload) => void;
}

const SESSION_PRESETS = [
  {
    id: "writer",
    title: "Writer",
    label: "写作 Writer",
    description: "直接进入章节创作与续写。",
    icon: PenTool,
  },
  {
    id: "planner",
    title: "Planner",
    label: "规划 Planner",
    description: "先拆解章节目标、节奏与结构。",
    icon: Sparkles,
  },
  {
    id: "auditor",
    title: "Auditor",
    label: "审计 Auditor",
    description: "做连续性、设定与逻辑排查。",
    icon: ShieldAlert,
  },
  {
    id: "architect",
    title: "Architect",
    label: "设定 Architect",
    description: "用于世界观、卷纲与题材设计。",
    icon: Bot,
  },
] as const;

function defaultTitleFor(presetId: string) {
  const preset = SESSION_PRESETS.find((item) => item.id === presetId) ?? SESSION_PRESETS[0];
  return `${preset.title} 会话`;
}

export function NewSessionDialog({ open, onOpenChange, onCreate }: NewSessionDialogProps) {
  const [presetId, setPresetId] = useState<(typeof SESSION_PRESETS)[number]["id"]>("writer");
  const [agentId, setAgentId] = useState("writer");
  const [title, setTitle] = useState(defaultTitleFor("writer"));
  const [titleTouched, setTitleTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPresetId("writer");
    setAgentId("writer");
    setTitle(defaultTitleFor("writer"));
    setTitleTouched(false);
  }, [open]);

  const selectedPreset = useMemo(
    () => SESSION_PRESETS.find((item) => item.id === presetId) ?? SESSION_PRESETS[0],
    [presetId],
  );

  const handlePresetSelect = (nextPresetId: (typeof SESSION_PRESETS)[number]["id"]) => {
    setPresetId(nextPresetId);
    setAgentId(nextPresetId);
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
