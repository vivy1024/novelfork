import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Command,
  Pencil,
  Plus,
  Save,
  TerminalSquare,
  Trash2,
  X,
} from "lucide-react";

import {
  listRuntimeCommands,
  type RuntimeCommandDefinition,
  type RuntimeCommandSource,
  type RuntimeCommandStatus,
} from "@vivy1024/novelfork-core/registry/command-registry";
import { invalidateNarratorCommands } from "../runtime/narrator-command-cache";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldLegend,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/ui/simple-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import {
  createUserPreferencesClient,
  type RuntimeUserPreferences,
} from "../runtime-admin";

const preferencesClient = createUserPreferencesClient();
const ROUTINE_COMMAND_MARKER = /\[routine:[^\]]+\]/u;
const ROUTINE_COMMAND_MARKER_GLOBAL = /\s*\[routine:[^\]]+\]\s*/gu;

type UserCommand = NonNullable<RuntimeUserPreferences["commands"]>[number];
type UserCommandParam = NonNullable<UserCommand["params"]>[number];

let nextParamDraftId = 0;

function createParamDraftId(): string {
  nextParamDraftId += 1;
  return `command-param-${nextParamDraftId}`;
}

interface CommandFormState {
  name: string;
  prompt: string;
  description: string;
  runBashFirst: boolean;
  bashCommand: string;
  params: Array<{
    id: string;
    name: string;
    description: string;
    required: boolean;
    defaultValue: string;
  }>;
  model: string;
  modelMode: "temporary" | "permanent";
}

const EMPTY_COMMAND_FORM: CommandFormState = {
  name: "",
  prompt: "",
  description: "",
  runBashFirst: false,
  bashCommand: "",
  params: [],
  model: "",
  modelMode: "temporary",
};

const COMMAND_STATUS_LABELS: Record<RuntimeCommandStatus, string> = {
  current: "当前可用",
  partial: "部分可用",
  planned: "计划中",
  unsupported: "不支持",
  "reference-only": "仅供参考",
};

const COMMAND_SOURCE_LABELS: Record<RuntimeCommandSource, string> = {
  builtin: "内置",
  "claude-adapter": "Claude 适配器",
  "codex-adapter": "Codex 适配器",
  "novel-agent-pack": "小说 Agent 包",
};

const COMMAND_SCOPE_LABELS: Record<RuntimeCommandDefinition["scope"], string> = {
  session: "会话",
  runtime: "运行时",
  tooling: "工具",
  extension: "扩展",
  novel: "小说",
};

function isRoutineManaged(command: UserCommand): boolean {
  return ROUTINE_COMMAND_MARKER.test(command.description ?? "");
}

function visibleDescription(command: UserCommand): string {
  return (command.description ?? "").replace(ROUTINE_COMMAND_MARKER_GLOBAL, " ").trim();
}

function formFromCommand(command?: UserCommand): CommandFormState {
  if (!command) return EMPTY_COMMAND_FORM;
  return {
    name: command.name,
    prompt: command.prompt,
    description: command.description ?? "",
    runBashFirst: command.runBashFirst ?? false,
    bashCommand: command.bashCommand ?? "",
    params: (command.params ?? []).map((param) => ({
      id: createParamDraftId(),
      name: param.name,
      description: param.description ?? "",
      required: param.required ?? false,
      defaultValue: param.defaultValue ?? "",
    })),
    model: command.modelOverride?.model ?? "",
    modelMode: command.modelOverride?.mode ?? "temporary",
  };
}

function commandFromForm(form: CommandFormState): UserCommand {
  const name = form.name.trim().replace(/^\/+/, "");
  const params = form.params
    .map((param): UserCommandParam => ({
      name: param.name.trim(),
      ...(param.description.trim() ? { description: param.description.trim() } : {}),
      ...(param.required ? { required: true } : {}),
      ...(param.defaultValue.trim() ? { defaultValue: param.defaultValue.trim() } : {}),
    }))
    .filter((param) => param.name.length > 0);
  const bashCommand = form.bashCommand.trim();
  const model = form.model.trim();
  return {
    name,
    prompt: form.prompt.trim(),
    ...(form.description.trim() ? { description: form.description.trim() } : {}),
    ...(form.runBashFirst && bashCommand ? { runBashFirst: true, bashCommand } : {}),
    ...(params.length > 0 ? { params } : {}),
    ...(model ? { modelOverride: { model, mode: form.modelMode } } : {}),
  };
}

function errorMessage(error: unknown): string {
  const status = typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status?: unknown }).status)
    : undefined;
  const message = error instanceof Error ? error.message : String(error);
  return status ? `${status} — ${message}` : message;
}

function LoadingCards() {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {[0, 1].map((item) => (
        <Card key={item}>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-full" />
          </CardHeader>
          <CardContent><Skeleton className="h-20 w-full" /></CardContent>
        </Card>
      ))}
    </div>
  );
}

export function CommandsSection() {
  const [preferences, setPreferences] = useState<RuntimeUserPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [editor, setEditor] = useState<{ mode: "create" | "edit"; currentName?: string } | null>(null);
  const [form, setForm] = useState<CommandFormState>(EMPTY_COMMAND_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteName, setDeleteName] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPreferences(await preferencesClient.get());
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const allCommands = preferences?.commands ?? [];
  const managedCommands = useMemo(() => allCommands.filter(isRoutineManaged), [allCommands]);
  const customCommands = useMemo(() => allCommands.filter((command) => !isRoutineManaged(command)), [allCommands]);
  const runtimeCommands = useMemo(() => listRuntimeCommands(), []);

  async function persistCustomCommands(nextCustomCommands: readonly UserCommand[]) {
    setPending(true);
    setError(null);
    try {
      const latest = await preferencesClient.get();
      const latestManaged = (latest.commands ?? []).filter(isRoutineManaged);
      const updated = await preferencesClient.patch({
        commands: [...latestManaged, ...nextCustomCommands],
      });
      setPreferences(updated);
      await invalidateNarratorCommands();
    } catch (saveError) {
      setError(errorMessage(saveError));
      throw saveError;
    } finally {
      setPending(false);
    }
  }

  function openCreate() {
    setForm(EMPTY_COMMAND_FORM);
    setFormError(null);
    setEditor({ mode: "create" });
  }

  function openEdit(command: UserCommand) {
    setForm(formFromCommand(command));
    setFormError(null);
    setEditor({ mode: "edit", currentName: command.name });
  }

  async function saveCommand() {
    if (!editor) return;
    const command = commandFromForm(form);
    if (!command.name) {
      setFormError("命令名称不能为空。");
      return;
    }
    if (command.name.length > 50) {
      setFormError("命令名称不能超过 50 个字符。");
      return;
    }
    if (!/^[a-zA-Z0-9_-]+$/u.test(command.name)) {
      setFormError("命令名称只能包含字母、数字、下划线和连字符。");
      return;
    }
    if (!command.prompt) {
      setFormError("提示模板不能为空。");
      return;
    }
    if (command.prompt.length > 400_000) {
      setFormError("提示模板不能超过 400000 个字符。");
      return;
    }
    if (form.runBashFirst && !form.bashCommand.trim()) {
      setFormError("启用运行前 Bash 时必须填写 Bash 命令。");
      return;
    }
    const paramNames = new Set<string>();
    for (const param of command.params ?? []) {
      if (param.name.length > 50) {
        setFormError(`参数名“${param.name}”不能超过 50 个字符。`);
        return;
      }
      if (paramNames.has(param.name)) {
        setFormError(`参数名“${param.name}”重复。`);
        return;
      }
      paramNames.add(param.name);
    }
    const duplicate = allCommands.some((item) => (
      item.name === command.name && item.name !== editor.currentName
    ));
    if (duplicate) {
      setFormError(`命令 /${command.name} 已存在。`);
      return;
    }
    setFormError(null);
    try {
      const next = editor.mode === "create"
        ? [...customCommands, command]
        : customCommands.map((item) => item.name === editor.currentName ? command : item);
      await persistCustomCommands(next);
      setEditor(null);
      setForm(EMPTY_COMMAND_FORM);
    } catch {
      // Section-level error already contains the Runtime response.
    }
  }

  async function deleteCommand() {
    if (!deleteName) return;
    try {
      await persistCustomCommands(customCommands.filter((command) => command.name !== deleteName));
      setDeleteName(null);
    } catch {
      // Section-level error already contains the Runtime response.
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">自定义命令</h2>
          <p className="text-sm text-muted-foreground">
            命令直接保存到当前用户的 Runtime preferences，并立即同步到叙述者 slash menu。
          </p>
        </div>
        <Button type="button" size="sm" onClick={openCreate} disabled={pending}>
          <Plus data-icon="inline-start" />
          添加命令
        </Button>
      </div>

      <Alert>
        <AlertTitle>内置套路命令受保护</AlertTitle>
        <AlertDescription>
          带有 Runtime routine marker 的命令只读展示；保存用户命令时会从最新 preferences 重新合并，避免覆盖套路状态。
        </AlertDescription>
      </Alert>
      {error && <Alert><AlertTitle>命令请求失败</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}

      {loading ? <LoadingCards /> : customCommands.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Command /></EmptyMedia>
            <EmptyTitle>暂无自定义命令</EmptyTitle>
            <EmptyDescription>创建一个命令后，可在叙述者输入框中通过 /名称 调用。</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button type="button" onClick={openCreate}><Plus data-icon="inline-start" />添加命令</Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {customCommands.map((command) => (
            <Card key={command.name}>
              <CardHeader>
                <CardTitle className="font-mono">/{command.name}</CardTitle>
                <CardDescription>{command.description || "未填写描述"}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p className="line-clamp-4 whitespace-pre-wrap text-xs text-muted-foreground">{command.prompt}</p>
                <div className="flex flex-wrap gap-2">
                  {command.runBashFirst && <Badge variant="outline">运行前 Bash</Badge>}
                  {(command.params ?? []).map((param) => (
                    <Badge key={param.name} variant="outline">{param.name}{param.required ? "*" : ""}</Badge>
                  ))}
                  {command.modelOverride && (
                    <Badge variant="outline">{command.modelOverride.mode === "temporary" ? "临时" : "永久"}模型</Badge>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => openEdit(command)}>
                    <Pencil data-icon="inline-start" />编辑
                  </Button>
                  <Button type="button" variant="destructive" size="sm" disabled={pending} onClick={() => setDeleteName(command.name)}>
                    <Trash2 data-icon="inline-start" />删除
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {managedCommands.length > 0 && (
        <section className="flex flex-col gap-3" aria-label="套路生成命令">
          <div>
            <h3 className="font-medium">套路生成命令</h3>
            <p className="text-sm text-muted-foreground">由 Runtime 内置套路维护，需在“内置套路”分区启停。</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {managedCommands.map((command) => (
              <Card key={command.name}>
                <CardHeader>
                  <CardTitle className="font-mono">/{command.name}</CardTitle>
                  <CardDescription>{visibleDescription(command) || "Runtime 套路命令"}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <p className="line-clamp-4 whitespace-pre-wrap text-xs text-muted-foreground">{command.prompt}</p>
                  <Badge className="w-fit" variant="secondary">Runtime 管理</Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3" aria-label="Runtime 原生命令参考">
        <div>
          <h3 className="font-medium">Runtime 原生命令参考</h3>
          <p className="text-sm text-muted-foreground">这些命令来自产品注册表，不存储在用户 preferences 中。</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {runtimeCommands.map((command) => <RuntimeCommandCard key={command.id} command={command} />)}
        </div>
      </section>

      <CommandEditorDialog
        open={editor !== null}
        mode={editor?.mode ?? "create"}
        form={form}
        error={formError}
        saving={pending}
        onFormChange={setForm}
        onOpenChange={(open) => {
          if (!open) {
            setEditor(null);
            setForm(EMPTY_COMMAND_FORM);
            setFormError(null);
          }
        }}
        onSave={() => void saveCommand()}
      />

      <Dialog open={deleteName !== null} onOpenChange={(open) => { if (!open) setDeleteName(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除自定义命令</DialogTitle>
            <DialogDescription>确定删除 /{deleteName ?? "此命令"} 吗？此操作会立即更新 slash menu。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteName(null)}>取消</Button>
            <Button type="button" variant="destructive" disabled={pending} onClick={() => void deleteCommand()}>
              <Trash2 data-icon="inline-start" />
              {pending ? "删除中…" : "删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CommandEditorDialog({
  open,
  mode,
  form,
  error,
  saving,
  onFormChange,
  onOpenChange,
  onSave,
}: {
  readonly open: boolean;
  readonly mode: "create" | "edit";
  readonly form: CommandFormState;
  readonly error: string | null;
  readonly saving: boolean;
  readonly onFormChange: (form: CommandFormState) => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSave: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "添加自定义命令" : "编辑自定义命令"}</DialogTitle>
          <DialogDescription>字段直接映射到 Runtime 用户命令契约。</DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={Boolean(error && !form.name.trim())}>
              <FieldLabel htmlFor="command-name">名称</FieldLabel>
              <Input
                id="command-name"
                aria-invalid={Boolean(error && !form.name.trim())}
                value={form.name}
                onChange={(event) => onFormChange({ ...form, name: event.target.value })}
                placeholder="review-draft"
              />
              <FieldDescription>无需输入前导 /，最多 50 个字符。</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="command-description">描述</FieldLabel>
              <Input
                id="command-description"
                value={form.description}
                onChange={(event) => onFormChange({ ...form, description: event.target.value })}
              />
            </Field>
          </div>

          <Field data-invalid={Boolean(error && !form.prompt.trim())}>
            <FieldLabel htmlFor="command-prompt">提示模板</FieldLabel>
            <Textarea
              id="command-prompt"
              aria-invalid={Boolean(error && !form.prompt.trim())}
              className="min-h-36 font-mono"
              value={form.prompt}
              onChange={(event) => onFormChange({ ...form, prompt: event.target.value })}
              placeholder="审阅当前章节并列出可执行修改。"
            />
          </Field>

          <FieldSet>
            <FieldLegend>运行前 Bash</FieldLegend>
            <Field orientation="horizontal">
              <div className="flex flex-1 flex-col gap-1">
                <span className="text-sm font-medium">先执行命令</span>
                <FieldDescription>执行仍受 Runtime Bash 权限与命令黑白名单约束。</FieldDescription>
              </div>
              <Switch
                aria-label="运行前 Bash"
                checked={form.runBashFirst}
                onCheckedChange={(runBashFirst) => onFormChange({ ...form, runBashFirst })}
              />
            </Field>
            {form.runBashFirst && (
              <Field>
                <FieldLabel htmlFor="command-bash">Bash 命令</FieldLabel>
                <Textarea
                  id="command-bash"
                  className="min-h-24 font-mono"
                  value={form.bashCommand}
                  onChange={(event) => onFormChange({ ...form, bashCommand: event.target.value })}
                />
              </Field>
            )}
          </FieldSet>

          <FieldSet>
            <div className="flex items-center justify-between gap-3">
              <div>
                <FieldLegend>参数</FieldLegend>
                <FieldDescription>参数会显示在 slash menu，并可提供默认值。</FieldDescription>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onFormChange({
                  ...form,
                  params: [
                    ...form.params,
                    {
                      id: createParamDraftId(),
                      name: "",
                      description: "",
                      required: false,
                      defaultValue: "",
                    },
                  ],
                })}
              >
                <Plus data-icon="inline-start" />添加参数
              </Button>
            </div>
            {form.params.length === 0 ? (
              <p className="text-sm text-muted-foreground">未配置参数。</p>
            ) : form.params.map((param, index) => (
              <Card key={param.id} size="sm">
                <CardContent className="flex flex-col gap-4 pt-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor={`command-param-name-${index}`}>参数名</FieldLabel>
                      <Input
                        id={`command-param-name-${index}`}
                        value={param.name}
                        onChange={(event) => {
                          const params = [...form.params];
                          params[index] = { ...param, name: event.target.value };
                          onFormChange({ ...form, params });
                        }}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`command-param-default-${index}`}>默认值</FieldLabel>
                      <Input
                        id={`command-param-default-${index}`}
                        value={param.defaultValue}
                        onChange={(event) => {
                          const params = [...form.params];
                          params[index] = { ...param, defaultValue: event.target.value };
                          onFormChange({ ...form, params });
                        }}
                      />
                    </Field>
                  </div>
                  <Field>
                    <FieldLabel htmlFor={`command-param-description-${index}`}>描述</FieldLabel>
                    <Input
                      id={`command-param-description-${index}`}
                      value={param.description}
                      onChange={(event) => {
                        const params = [...form.params];
                        params[index] = { ...param, description: event.target.value };
                        onFormChange({ ...form, params });
                      }}
                    />
                  </Field>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <Switch
                        aria-label={`参数必填：${param.name || index + 1}`}
                        checked={param.required}
                        onCheckedChange={(required) => {
                          const params = [...form.params];
                          params[index] = { ...param, required };
                          onFormChange({ ...form, params });
                        }}
                      />
                      <span className="text-sm">必填</span>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => onFormChange({
                        ...form,
                        params: form.params.filter((_, itemIndex) => itemIndex !== index),
                      })}
                    >
                      <X data-icon="inline-start" />移除参数
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </FieldSet>

          <FieldSet>
            <FieldLegend>模型覆盖</FieldLegend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="command-model">模型</FieldLabel>
                <Input
                  id="command-model"
                  value={form.model}
                  onChange={(event) => onFormChange({ ...form, model: event.target.value })}
                  placeholder="留空时继承当前模型"
                />
              </Field>
              <Field>
                <FieldLabel>覆盖模式</FieldLabel>
                <SimpleSelect
                  aria-label="命令模型覆盖模式"
                  value={form.modelMode}
                  disabled={!form.model.trim()}
                  onValueChange={(modelMode) => onFormChange({
                    ...form,
                    modelMode: modelMode as CommandFormState["modelMode"],
                  })}
                  options={[
                    { value: "temporary", label: "仅本次命令" },
                    { value: "permanent", label: "后续会话保持" },
                  ]}
                />
              </Field>
            </div>
          </FieldSet>

          {error && <FieldError>{error}</FieldError>}
        </FieldGroup>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button type="button" disabled={saving} onClick={onSave}>
            <Save data-icon="inline-start" />
            {saving ? "保存中…" : mode === "create" ? "创建命令" : "保存修改"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RuntimeCommandCard({ command }: { readonly command: RuntimeCommandDefinition }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-mono">{command.usage}</CardTitle>
        <CardDescription>{command.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <Badge variant={command.status === "current" ? "secondary" : "outline"}>
            {COMMAND_STATUS_LABELS[command.status]}
          </Badge>
          <Badge variant="outline">{COMMAND_SOURCE_LABELS[command.source]}</Badge>
          <Badge variant="outline">{COMMAND_SCOPE_LABELS[command.scope]}</Badge>
        </div>
        {command.aliases.length > 0 && (
          <div className="text-xs text-muted-foreground">别名：{command.aliases.join(", ")}</div>
        )}
        {command.gaps && <div className="text-xs text-muted-foreground">当前缺口：{command.gaps}</div>}
        {command.status === "current" && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <TerminalSquare />
            Runtime 原生注册
          </div>
        )}
      </CardContent>
    </Card>
  );
}
