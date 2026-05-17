import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export interface GettingStartedStatus {
  readonly dismissedGettingStarted: boolean;
  readonly provider: {
    readonly hasUsableModel: boolean;
    readonly defaultProvider?: string;
    readonly defaultModel?: string;
  };
  readonly tasks: {
    readonly modelConfigured: boolean;
    readonly hasAnyBook: boolean;
    readonly hasMetNarrator: boolean;
    readonly hasOpenedJingwei: boolean;
    readonly hasTriedAiWriting: boolean;
  };
}

interface GettingStartedChecklistProps {
  readonly status: GettingStartedStatus;
  readonly onConfigureModel: () => void;
  readonly onCreateBook: () => void;
  readonly onMeetNarrator: () => void;
  readonly onOpenJingwei: () => void;
  readonly onTryAiWriting: () => void;
  readonly onDismiss: () => void;
}

interface TaskItem {
  readonly title: string;
  readonly description: string;
  readonly completed: boolean;
  readonly recommended?: boolean;
  readonly actionLabel: string;
  readonly onClick: () => void;
  readonly statusText?: string;
}

function TaskRow({ task }: { readonly task: TaskItem }) {
  return (
    <li className="rounded-xl border border-border/60 bg-background/60 p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <div
            aria-hidden="true"
            className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${
              task.completed
                ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-600"
                : "border-primary/30 bg-primary/10 text-primary"
            }`}
          >
            {task.completed ? "✓" : "·"}
          </div>
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span data-testid="task-title" className="font-medium text-foreground">
                {task.title}
              </span>
              {task.recommended ? <Badge variant="secondary">推荐第一步</Badge> : null}
              {task.completed ? <Badge className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/10">已完成</Badge> : null}
            </div>
            <p className="text-sm text-muted-foreground">{task.statusText ?? task.description}</p>
          </div>
        </div>
        <Button
          type="button"
          variant={task.completed ? "outline" : "default"}
          size="sm"
          aria-label={`${task.title}：${task.actionLabel}`}
          onClick={task.onClick}
        >
          {task.actionLabel}
        </Button>
      </div>
    </li>
  );
}

export function GettingStartedChecklist({
  status,
  onConfigureModel,
  onCreateBook,
  onMeetNarrator,
  onOpenJingwei,
  onTryAiWriting,
  onDismiss,
}: GettingStartedChecklistProps) {
  if (status.dismissedGettingStarted) {
    return null;
  }

  const modelStatusText = status.provider.hasUsableModel
    ? `${status.provider.defaultProvider ?? "provider"} / ${status.provider.defaultModel ?? "model"}`
    : "未配置模型，不影响本地写作";

  const tasks: TaskItem[] = [
    {
      title: "配置 AI 模型",
      description: "连接 AI 供应商、填入 API Key，开启全部 AI 写作能力。",
      completed: status.tasks.modelConfigured,
      recommended: true,
      actionLabel: status.tasks.modelConfigured ? "查看配置" : "配置模型",
      statusText: modelStatusText,
      onClick: onConfigureModel,
    },
    {
      title: "创建第一本书",
      description: "创建作品后进入工作台，AI 叙述者会引导你完成题材和设定。",
      completed: status.tasks.hasAnyBook,
      actionLabel: status.tasks.hasAnyBook ? "继续管理" : "创建书籍",
      onClick: onCreateBook,
    },
    {
      title: "进入书籍工作台",
      description: "创建书后点击进入工作台，书籍叙述者会自动引导你完成题材、设定和大纲。",
      completed: status.tasks.hasMetNarrator,
      actionLabel: status.tasks.hasMetNarrator ? "继续写作" : "进入工作台",
      onClick: onMeetNarrator,
    },
    {
      title: "了解经纬系统",
      description: "经纬是本书的长期记忆：人物、世界观、大纲、设定都在这里管理。",
      completed: status.tasks.hasOpenedJingwei,
      actionLabel: "打开经纬",
      onClick: onOpenJingwei,
    },
    {
      title: "试用 AI 写作",
      description: "让叙述者帮你续写、改写或评点，体验 AI 辅助创作。",
      completed: status.tasks.hasTriedAiWriting,
      actionLabel: status.provider.hasUsableModel ? "试用写作" : "先配置模型",
      onClick: onTryAiWriting,
    },
  ];

  const completedCount = tasks.filter((t) => t.completed).length;

  return (
    <Card className="border-primary/20 bg-primary/[0.03]">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>开始使用 NovelFork</CardTitle>
            <CardDescription>
              {completedCount === tasks.length
                ? "全部完成！你已经掌握了基本用法。"
                : `完成 ${completedCount}/${tasks.length} 步，按推荐顺序逐步上手。`}
            </CardDescription>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
            关闭任务清单
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <ol className="space-y-2">
          {tasks.map((task) => (
            <TaskRow key={task.title} task={task} />
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
