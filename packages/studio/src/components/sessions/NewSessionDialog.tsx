import { useEffect, useState, type FormEvent } from "react";
import { PenTool } from "lucide-react";

import { fetchJson } from "@/hooks/use-api";
import {
  runtimeModelLabel,
  usableRuntimeModels,
  type RuntimeModelOption,
} from "@/lib/runtime-model-options";
import type {
  RuntimePermissionMode,
  RuntimeReasoningEffort,
} from "@/app-next/runtime/runtime-narrator-client";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "../ui/field";
import { Input } from "../ui/input";
import { SimpleSelect } from "../ui/simple-select";

export interface NewSessionPayload {
  readonly title: string;
  readonly model?: string;
  readonly permissionMode: RuntimePermissionMode;
  readonly reasoningEffort?: RuntimeReasoningEffort;
  readonly startInPlanMode: boolean;
  readonly cwd?: string;
}

interface NewSessionDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCreate: (payload: NewSessionPayload) => void | Promise<void>;
  readonly busy?: boolean;
}

const PERMISSION_OPTIONS: ReadonlyArray<{
  value: RuntimePermissionMode;
  label: string;
}> = [
  { value: "default", label: "按需询问" },
  { value: "acceptEdits", label: "自动接受编辑" },
  { value: "bypassPermissions", label: "全部允许" },
  { value: "readOnly", label: "只读" },
  { value: "dontAsk", label: "不再询问" },
];

const REASONING_OPTIONS = [
  { value: "default", label: "跟随模型默认" },
  { value: "none", label: "无" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "xhigh", label: "极高" },
  { value: "max", label: "最大" },
] as const;

export function NewSessionDialog({ open, onOpenChange, onCreate, busy = false }: NewSessionDialogProps) {
  const [title, setTitle] = useState("小说创作会话");
  const [startInPlanMode, setStartInPlanMode] = useState(false);
  const [permissionMode, setPermissionMode] = useState<RuntimePermissionMode>("acceptEdits");
  const [reasoningEffort, setReasoningEffort] = useState<(typeof REASONING_OPTIONS)[number]["value"]>("default");
  const [cwd, setCwd] = useState("");
  const [runtimeModels, setRuntimeModels] = useState<RuntimeModelOption[]>([]);
  const [selectedRuntimeModelId, setSelectedRuntimeModelId] = useState("");
  const [modelsLoading, setModelsLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle("小说创作会话");
    setStartInPlanMode(false);
    setPermissionMode("acceptEdits");
    setReasoningEffort("default");
    setCwd("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setModelsLoading(true);
    void fetchJson<{ models?: RuntimeModelOption[] }>("/api/providers/models")
      .then((response) => {
        if (cancelled) return;
        const models = usableRuntimeModels(response.models);
        setRuntimeModels(models);
        setSelectedRuntimeModelId(models[0]?.modelId ?? "");
      })
      .catch(() => {
        if (cancelled) return;
        setRuntimeModels([]);
        setSelectedRuntimeModelId("");
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const model = selectedRuntimeModelId.trim();
    if (busy || modelsLoading) return;
    const trimmedCwd = cwd.trim();
    void onCreate({
      title: title.trim() || "小说创作会话",
      ...(model ? { model } : {}),
      permissionMode,
      ...(reasoningEffort === "default" ? {} : { reasoningEffort: reasoningEffort as RuntimeReasoningEffort }),
      startInPlanMode,
      ...(trimmedCwd ? { cwd: trimmedCwd } : {}),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto p-0" showCloseButton>
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>新建独立叙述者</DialogTitle>
          <DialogDescription>
            创建由 NarraFork Runtime 持久化的长期叙述者。书籍内叙述者仍由写作工作台管理。
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="flex flex-col gap-6 px-6 pb-6">
            <div className="flex items-start justify-between gap-3 rounded-2xl border border-border/60 bg-muted/30 p-4">
              <div className="flex min-w-0 items-start gap-3">
                <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                  <PenTool aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium">Novelist · 小说创作</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    写作、规划、审计、经纬管理和工具执行统一使用原生 Runtime 能力。
                  </p>
                </div>
              </div>
              <Badge variant="secondary">独立</Badge>
            </div>

            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="new-narrator-title">标题</FieldLabel>
                <Input
                  id="new-narrator-title"
                  aria-label="叙述者标题"
                  value={title}
                  onChange={(event) => setTitle(event.currentTarget.value)}
                  autoFocus
                />
              </Field>

              <div className="grid gap-5 sm:grid-cols-2">
                <Field>
                  <FieldLabel>启动模式</FieldLabel>
                  <SimpleSelect
                    aria-label="启动模式"
                    value={startInPlanMode ? "plan" : "chat"}
                    onValueChange={(value) => setStartInPlanMode(value === "plan")}
                    options={[
                      { value: "chat", label: "对话模式" },
                      { value: "plan", label: "计划模式" },
                    ]}
                  />
                </Field>
                <Field>
                  <FieldLabel>权限模式</FieldLabel>
                  <SimpleSelect
                    aria-label="权限模式"
                    value={permissionMode}
                    onValueChange={(value) => setPermissionMode(value as RuntimePermissionMode)}
                    options={[...PERMISSION_OPTIONS]}
                  />
                </Field>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <Field data-disabled={modelsLoading || runtimeModels.length === 0}>
                  <FieldLabel>运行时模型</FieldLabel>
                  {modelsLoading ? (
                    <p className="text-sm text-muted-foreground">正在读取统一模型池…</p>
                  ) : runtimeModels.length > 0 ? (
                    <SimpleSelect
                      aria-label="运行时模型"
                      value={selectedRuntimeModelId}
                      onValueChange={setSelectedRuntimeModelId}
                      options={runtimeModels.map((model) => ({ value: model.modelId, label: runtimeModelLabel(model) }))}
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground">将跟随 Runtime 默认模型；可在设置中稍后配置。</p>
                  )}
                </Field>
                <Field>
                  <FieldLabel>推理强度</FieldLabel>
                  <SimpleSelect
                    aria-label="推理强度"
                    value={reasoningEffort}
                    onValueChange={(value) => setReasoningEffort(value as (typeof REASONING_OPTIONS)[number]["value"])}
                    options={[...REASONING_OPTIONS]}
                  />
                </Field>
              </div>

              <Field>
                <FieldLabel htmlFor="new-narrator-cwd">工作目录</FieldLabel>
                <Input
                  id="new-narrator-cwd"
                  aria-label="工作目录"
                  value={cwd}
                  onChange={(event) => setCwd(event.currentTarget.value)}
                  placeholder="例如 D:\\novels\\my-book"
                />
                <FieldDescription>留空时由 Runtime 使用默认工作目录。</FieldDescription>
              </Field>
            </FieldGroup>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              取消
            </Button>
            <Button type="submit" disabled={busy || modelsLoading}>
              {busy ? "创建中…" : "创建叙述者"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
