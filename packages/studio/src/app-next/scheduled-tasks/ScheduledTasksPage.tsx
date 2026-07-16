import { useCallback, useEffect, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  scheduledTasksClient,
  type ScheduledTask,
  type ScheduledTaskInput,
  type ScheduledTaskLocale,
  type ScheduledTaskNarratorMode,
  type ScheduledTaskPermissionMode,
  type ScheduledTaskRun,
  type ScheduledTaskRunContext,
  type ScheduledTaskStatus,
} from "../runtime-admin/scheduled-tasks";

interface TaskDraft {
  name: string;
  cronExpr: string;
  timezone: string;
  prompt: string;
  systemPrompt: string;
  model: string;
  permissionMode: ScheduledTaskPermissionMode;
  locale: ScheduledTaskLocale;
  runContext: ScheduledTaskRunContext;
  cwd: string;
  projectId: string;
  chapterId: string;
  narratorMode: ScheduledTaskNarratorMode;
  enabled: boolean;
}

const EMPTY_DRAFT: TaskDraft = {
  name: "",
  cronExpr: "0 9 * * *",
  timezone: "",
  prompt: "",
  systemPrompt: "",
  model: "",
  permissionMode: "bypassPermissions",
  locale: "zh-CN",
  runContext: "standalone",
  cwd: "",
  projectId: "",
  chapterId: "",
  narratorMode: "new",
  enabled: true,
};

const PERMISSION_MODES: ReadonlyArray<{ value: ScheduledTaskPermissionMode; label: string }> = [
  { value: "default", label: "默认询问" },
  { value: "acceptEdits", label: "接受编辑" },
  { value: "bypassPermissions", label: "绕过权限" },
  { value: "readOnly", label: "只读" },
  { value: "dontAsk", label: "禁止询问" },
];

function draftFromTask(task: ScheduledTask): TaskDraft {
  return {
    name: task.name,
    cronExpr: task.cronExpr,
    timezone: task.timezone ?? "",
    prompt: task.prompt,
    systemPrompt: task.systemPrompt ?? "",
    model: task.model ?? "",
    permissionMode: task.permissionMode,
    locale: task.locale,
    runContext: task.runContext,
    cwd: task.cwd ?? "",
    projectId: task.projectId ?? "",
    chapterId: task.chapterId ?? "",
    narratorMode: task.narratorMode,
    enabled: task.enabled,
  };
}

export function buildScheduledTaskInput(draft: TaskDraft): ScheduledTaskInput {
  const chapterContext = draft.runContext === "chapter";
  return {
    name: draft.name.trim(),
    cronExpr: draft.cronExpr.trim(),
    timezone: draft.timezone.trim() || null,
    prompt: draft.prompt,
    systemPrompt: draft.systemPrompt.trim() || null,
    model: draft.model.trim() || null,
    permissionMode: draft.permissionMode,
    locale: draft.locale,
    runContext: draft.runContext,
    cwd: chapterContext ? null : draft.cwd.trim() || null,
    projectId: chapterContext ? draft.projectId.trim() || null : null,
    chapterId: chapterContext ? draft.chapterId.trim() || null : null,
    narratorMode: draft.narratorMode,
    enabled: draft.enabled,
  };
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") return `${status} · ${message}`;
  }
  return message;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN");
}

function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return "—";
  if (durationMs < 1000) return `${durationMs} ms`;
  return `${(durationMs / 1000).toFixed(1)} s`;
}

function statusLabel(status: ScheduledTaskStatus | null): string {
  if (status === "success") return "成功";
  if (status === "failed") return "失败";
  if (status === "skipped") return "已跳过";
  return "尚未运行";
}

function statusVariant(status: ScheduledTaskStatus | null): "secondary" | "destructive" | "outline" {
  if (status === "success") return "secondary";
  if (status === "failed") return "destructive";
  return "outline";
}

export function ScheduledTasksPage() {
  const [tasks, setTasks] = useState<readonly ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ mode: "create" | "edit"; id?: string } | null>(null);
  const [draft, setDraft] = useState<TaskDraft>(EMPTY_DRAFT);
  const [deletingTask, setDeletingTask] = useState<ScheduledTask | null>(null);
  const [historyTask, setHistoryTask] = useState<ScheduledTask | null>(null);
  const [runs, setRuns] = useState<readonly ScheduledTaskRun[]>([]);
  const [runsCursor, setRunsCursor] = useState<string | null>(null);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsError, setRunsError] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTasks(await scheduledTasksClient.list());
    } catch (loadError) {
      setError(errorText(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  function startCreate() {
    setDraft(EMPTY_DRAFT);
    setEditor({ mode: "create" });
  }

  function startEdit(task: ScheduledTask) {
    setDraft(draftFromTask(task));
    setEditor({ mode: "edit", id: task.id });
  }

  async function saveTask() {
    if (!editor) return;
    const pendingKey = editor.id ?? "create";
    setPending(pendingKey);
    setError(null);
    try {
      const input = buildScheduledTaskInput(draft);
      const saved = editor.mode === "create"
        ? await scheduledTasksClient.create(input)
        : await scheduledTasksClient.update(editor.id!, input);
      setTasks((current) => editor.mode === "create"
        ? [...current, saved]
        : current.map((task) => task.id === saved.id ? saved : task));
      setEditor(null);
      setDraft(EMPTY_DRAFT);
    } catch (saveError) {
      setError(errorText(saveError));
    } finally {
      setPending(null);
    }
  }

  async function toggleTask(task: ScheduledTask) {
    setPending(`toggle:${task.id}`);
    setError(null);
    try {
      const updated = await scheduledTasksClient.setEnabled(task.id, !task.enabled);
      setTasks((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (toggleError) {
      setError(errorText(toggleError));
    } finally {
      setPending(null);
    }
  }

  async function runTask(task: ScheduledTask) {
    setPending(`run:${task.id}`);
    setError(null);
    try {
      const updated = await scheduledTasksClient.runNow(task.id);
      setTasks((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (runError) {
      setError(errorText(runError));
    } finally {
      setPending(null);
    }
  }

  async function deleteTask() {
    if (!deletingTask) return;
    setPending(`delete:${deletingTask.id}`);
    setError(null);
    try {
      await scheduledTasksClient.delete(deletingTask.id);
      setTasks((current) => current.filter((item) => item.id !== deletingTask.id));
      setDeletingTask(null);
    } catch (deleteError) {
      setError(errorText(deleteError));
    } finally {
      setPending(null);
    }
  }

  async function openHistory(task: ScheduledTask) {
    setHistoryTask(task);
    setRuns([]);
    setRunsCursor(null);
    setRunsError(null);
    setRunsLoading(true);
    try {
      const page = await scheduledTasksClient.listRuns(task.id, { limit: 50 });
      setRuns(page.runs);
      setRunsCursor(page.nextCursor);
    } catch (historyError) {
      setRunsError(errorText(historyError));
    } finally {
      setRunsLoading(false);
    }
  }

  async function loadMoreRuns() {
    if (!historyTask || !runsCursor) return;
    setRunsLoading(true);
    setRunsError(null);
    try {
      const page = await scheduledTasksClient.listRuns(historyTask.id, { limit: 50, cursor: runsCursor });
      setRuns((current) => [...current, ...page.runs]);
      setRunsCursor(page.nextCursor);
    } catch (historyError) {
      setRunsError(errorText(historyError));
    } finally {
      setRunsLoading(false);
    }
  }

  const chapterFieldsValid = draft.runContext !== "chapter" || Boolean(draft.projectId.trim() && draft.chapterId.trim());
  const saveDisabled = !draft.name.trim() || !draft.cronExpr.trim() || !draft.prompt.trim() || !chapterFieldsValid;

  return (
    <section className="flex min-h-full flex-col gap-5 p-5 text-foreground">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Runtime automation</p>
          <h1 className="text-2xl font-semibold tracking-tight">Scheduled Tasks</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            用 Cron 调度 Runtime 叙述者，管理执行上下文、权限与逐次运行记录。
          </p>
        </div>
        <Button type="button" onClick={startCreate}>创建计划任务</Button>
      </header>

      {error && (
        <Alert className="border-destructive/30 bg-destructive/5">
          <AlertTitle>Scheduled Tasks 请求失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div aria-label="正在加载计划任务" className="grid gap-3">
          {[0, 1, 2].map((item) => <Skeleton key={item} className="h-24 w-full rounded-xl" />)}
        </div>
      ) : tasks.length === 0 ? (
        <Empty className="min-h-72 border bg-card/50">
          <EmptyHeader>
            <EmptyTitle>暂无计划任务</EmptyTitle>
            <EmptyDescription>创建第一条任务后，Runtime 会按 Cron 表达式自动触发叙述者。</EmptyDescription>
          </EmptyHeader>
          <EmptyContent><Button type="button" onClick={startCreate}>创建计划任务</Button></EmptyContent>
        </Empty>
      ) : (
        <Card>
          <CardHeader className="border-b">
            <CardTitle>任务列表</CardTitle>
            <CardDescription>{tasks.length} 条真实 Runtime 计划任务</CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>任务</TableHead>
                  <TableHead>计划</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>下次运行</TableHead>
                  <TableHead>上次结果</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((task) => (
                  <TableRow key={task.id}>
                    <TableCell>
                      <div className="max-w-64 whitespace-normal">
                        <div className="font-medium">{task.name}</div>
                        <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{task.prompt}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <code className="rounded-md bg-muted px-2 py-1 text-xs">{task.cronExpr}</code>
                      <div className="mt-1 text-xs text-muted-foreground">{task.timezone || "服务器本地时区"}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <Badge variant={task.enabled ? "secondary" : "outline"}>{task.enabled ? "已启用" : "已停用"}</Badge>
                        <Badge variant="outline">{task.runContext === "chapter" ? "章节" : "独立"}</Badge>
                      </div>
                    </TableCell>
                    <TableCell>{formatDate(task.nextRunAt)}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(task.lastStatus)}>{statusLabel(task.lastStatus)}</Badge>
                      {task.lastError && <div className="mt-1 max-w-56 whitespace-normal text-xs text-destructive">{task.lastError}</div>}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button type="button" size="xs" variant="outline" disabled={pending !== null} onClick={() => void openHistory(task)}>历史</Button>
                        <Button type="button" size="xs" variant="outline" disabled={pending !== null} onClick={() => void runTask(task)}>{pending === `run:${task.id}` ? "运行中…" : "立即运行"}</Button>
                        <Button type="button" size="xs" variant="outline" disabled={pending !== null} onClick={() => void toggleTask(task)}>{task.enabled ? "停用" : "启用"}</Button>
                        <Button type="button" size="xs" variant="outline" disabled={pending !== null} onClick={() => startEdit(task)}>编辑</Button>
                        <Button type="button" size="xs" variant="destructive" disabled={pending !== null} onClick={() => setDeletingTask(task)}>删除</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <TaskEditorDialog
        open={editor !== null}
        mode={editor?.mode ?? "create"}
        draft={draft}
        saving={pending === (editor?.id ?? "create")}
        saveDisabled={saveDisabled}
        onDraftChange={setDraft}
        onOpenChange={(open) => { if (!open) setEditor(null); }}
        onSave={() => void saveTask()}
      />

      <Dialog open={deletingTask !== null} onOpenChange={(open) => { if (!open) setDeletingTask(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除计划任务</DialogTitle>
            <DialogDescription>确定删除“{deletingTask?.name ?? "此任务"}”吗？其运行历史也会随数据库级联删除。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeletingTask(null)}>取消</Button>
            <Button type="button" variant="destructive" disabled={pending?.startsWith("delete:")} onClick={() => void deleteTask()}>{pending?.startsWith("delete:") ? "删除中…" : "删除"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RunHistoryDialog
        task={historyTask}
        runs={runs}
        loading={runsLoading}
        error={runsError}
        nextCursor={runsCursor}
        onOpenChange={(open) => { if (!open) setHistoryTask(null); }}
        onLoadMore={() => void loadMoreRuns()}
      />
    </section>
  );
}

function TaskEditorDialog({
  open,
  mode,
  draft,
  saving,
  saveDisabled,
  onDraftChange,
  onOpenChange,
  onSave,
}: {
  readonly open: boolean;
  readonly mode: "create" | "edit";
  readonly draft: TaskDraft;
  readonly saving: boolean;
  readonly saveDisabled: boolean;
  readonly onDraftChange: (draft: TaskDraft) => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSave: () => void;
}) {
  const patch = (value: Partial<TaskDraft>) => onDraftChange({ ...draft, ...value });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "创建计划任务" : "编辑计划任务"}</DialogTitle>
          <DialogDescription>字段直接映射到 Runtime Scheduled Tasks 校验契约；Cron 支持 5 或 6 段表达式。</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="scheduled-task-name">名称</FieldLabel>
              <Input id="scheduled-task-name" maxLength={200} value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
            </Field>
            <Field>
              <FieldLabel htmlFor="scheduled-task-cron">Cron 表达式</FieldLabel>
              <Input id="scheduled-task-cron" className="font-mono" maxLength={200} value={draft.cronExpr} onChange={(event) => patch({ cronExpr: event.target.value })} placeholder="0 9 * * *" />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="scheduled-task-timezone">IANA 时区</FieldLabel>
            <Input id="scheduled-task-timezone" maxLength={100} value={draft.timezone} onChange={(event) => patch({ timezone: event.target.value })} placeholder="Asia/Shanghai；留空使用服务器本地时区" />
          </Field>
          <Field>
            <FieldLabel htmlFor="scheduled-task-prompt">运行提示词</FieldLabel>
            <Textarea id="scheduled-task-prompt" className="min-h-28" maxLength={50000} value={draft.prompt} onChange={(event) => patch({ prompt: event.target.value })} />
          </Field>
          <Field>
            <FieldLabel htmlFor="scheduled-task-system-prompt">系统提示词（可选）</FieldLabel>
            <Textarea id="scheduled-task-system-prompt" className="min-h-20" maxLength={10000} value={draft.systemPrompt} onChange={(event) => patch({ systemPrompt: event.target.value })} />
          </Field>

          <Field>
            <FieldLabel>运行上下文</FieldLabel>
            <Tabs value={draft.runContext} onValueChange={(value) => patch({ runContext: value as ScheduledTaskRunContext })}>
              <TabsList aria-label="运行上下文"><TabsTrigger value="standalone">独立目录</TabsTrigger><TabsTrigger value="chapter">章节绑定</TabsTrigger></TabsList>
            </Tabs>
          </Field>
          {draft.runContext === "standalone" ? (
            <Field>
              <FieldLabel htmlFor="scheduled-task-cwd">工作目录（可选）</FieldLabel>
              <Input id="scheduled-task-cwd" maxLength={4096} value={draft.cwd} onChange={(event) => patch({ cwd: event.target.value })} placeholder="留空使用 Runtime 用户主目录" />
            </Field>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="scheduled-task-project">Runtime 项目 ID</FieldLabel>
                <Input id="scheduled-task-project" maxLength={100} value={draft.projectId} onChange={(event) => patch({ projectId: event.target.value })} />
              </Field>
              <Field>
                <FieldLabel htmlFor="scheduled-task-chapter">章节 ID</FieldLabel>
                <Input id="scheduled-task-chapter" maxLength={100} value={draft.chapterId} onChange={(event) => patch({ chapterId: event.target.value })} />
              </Field>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel>叙述者策略</FieldLabel>
              <Tabs value={draft.narratorMode} onValueChange={(value) => patch({ narratorMode: value as ScheduledTaskNarratorMode })}>
                <TabsList aria-label="叙述者策略"><TabsTrigger value="new">每次新建</TabsTrigger><TabsTrigger value="reuse">复用</TabsTrigger></TabsList>
              </Tabs>
            </Field>
            <Field>
              <FieldLabel>语言</FieldLabel>
              <Tabs value={draft.locale} onValueChange={(value) => patch({ locale: value as ScheduledTaskLocale })}>
                <TabsList aria-label="任务语言"><TabsTrigger value="zh-CN">简体中文</TabsTrigger><TabsTrigger value="en">English</TabsTrigger></TabsList>
              </Tabs>
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="scheduled-task-model">模型 ID（可选）</FieldLabel>
            <Input id="scheduled-task-model" maxLength={200} value={draft.model} onChange={(event) => patch({ model: event.target.value })} placeholder="留空跟随 Runtime 默认模型" />
          </Field>
          <Field>
            <FieldLabel>权限模式</FieldLabel>
            <Tabs value={draft.permissionMode} onValueChange={(value) => patch({ permissionMode: value as ScheduledTaskPermissionMode })}>
              <TabsList aria-label="权限模式" className="h-auto flex-wrap justify-start">
                {PERMISSION_MODES.map((modeOption) => <TabsTrigger key={modeOption.value} value={modeOption.value}>{modeOption.label}</TabsTrigger>)}
              </TabsList>
            </Tabs>
            <FieldDescription>无人值守任务默认使用 bypassPermissions；请只为可信提示词启用。</FieldDescription>
          </Field>
          {draft.permissionMode === "bypassPermissions" && (
            <Alert className="border-destructive/20">
              <AlertTitle>高权限无人值守执行</AlertTitle>
              <AlertDescription>该模式会绕过工具权限确认。请确认提示词、目录与章节绑定均可信。</AlertDescription>
            </Alert>
          )}
          <Field orientation="horizontal" className="items-center justify-between rounded-xl border border-border bg-muted/30 p-3">
            <div>
              <FieldLabel>创建后启用</FieldLabel>
              <FieldDescription>停用任务不会计算下一次运行时间，仍可手动立即运行。</FieldDescription>
            </div>
            <Button type="button" variant={draft.enabled ? "secondary" : "outline"} onClick={() => patch({ enabled: !draft.enabled })}>{draft.enabled ? "已启用" : "已停用"}</Button>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button type="button" disabled={saving || saveDisabled} onClick={onSave}>{saving ? "保存中…" : mode === "create" ? "创建任务" : "保存修改"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RunHistoryDialog({
  task,
  runs,
  loading,
  error,
  nextCursor,
  onOpenChange,
  onLoadMore,
}: {
  readonly task: ScheduledTask | null;
  readonly runs: readonly ScheduledTaskRun[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly nextCursor: string | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onLoadMore: () => void;
}) {
  return (
    <Dialog open={task !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>运行历史 · {task?.name}</DialogTitle>
          <DialogDescription>按最新运行优先展示，记录触发方式、叙述者、耗时和 Runtime 错误。</DialogDescription>
        </DialogHeader>
        {error && <Alert className="border-destructive/30"><AlertTitle>运行历史加载失败</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
        {loading && runs.length === 0 ? (
          <div aria-label="正在加载运行历史" className="flex flex-col gap-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
        ) : runs.length === 0 ? (
          <Empty className="min-h-48 border"><EmptyHeader><EmptyTitle>暂无运行记录</EmptyTitle><EmptyDescription>手动运行或 Cron 首次触发后会在这里生成真实记录。</EmptyDescription></EmptyHeader></Empty>
        ) : (
          <Card size="sm">
            <CardContent className="px-0">
              <Table>
                <TableHeader><TableRow><TableHead>时间</TableHead><TableHead>触发</TableHead><TableHead>结果</TableHead><TableHead>叙述者</TableHead><TableHead>耗时</TableHead><TableHead>错误</TableHead></TableRow></TableHeader>
                <TableBody>
                  {runs.map((run) => (
                    <TableRow key={run.id}>
                      <TableCell>{formatDate(run.createdAt)}</TableCell>
                      <TableCell><Badge variant="outline">{run.manual ? "手动" : "计划"}</Badge></TableCell>
                      <TableCell><Badge variant={statusVariant(run.status)}>{statusLabel(run.status)}</Badge></TableCell>
                      <TableCell><code className="text-xs">{run.narratorId ?? "—"}</code></TableCell>
                      <TableCell>{formatDuration(run.durationMs)}</TableCell>
                      <TableCell><div className="max-w-64 whitespace-normal text-xs text-destructive">{run.error ?? "—"}</div></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
        <DialogFooter>
          {nextCursor && <Button type="button" variant="outline" disabled={loading} onClick={onLoadMore}>{loading ? "加载中…" : "加载更多"}</Button>}
          <Button type="button" onClick={() => onOpenChange(false)}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ScheduledTasksPage;
