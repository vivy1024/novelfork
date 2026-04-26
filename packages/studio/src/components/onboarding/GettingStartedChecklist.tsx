import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export interface GettingStartedStatus {
  readonly dismissedGettingStarted: boolean;
  readonly provider: {
    readonly hasUsableModel: boolean;
    readonly defaultProvider?: string;
    readonly defaultModel?: string;
    readonly lastConnectionError?: string;
  };
  readonly tasks: {
    readonly modelConfigured: boolean;
    readonly hasAnyBook: boolean;
    readonly hasOpenedJingwei: boolean;
    readonly hasAnyChapter: boolean;
    readonly hasTriedAiWriting: boolean;
    readonly hasTriedAiTasteScan: boolean;
    readonly hasReadWorkbenchIntro: boolean;
  };
}

interface GettingStartedChecklistProps {
  readonly status: GettingStartedStatus;
  readonly onConfigureModel: () => void;
  readonly onCreateBook: () => void;
  readonly onOpenJingwei: () => void;
  readonly onCreateChapter: () => void;
  readonly onTryAiWriting: () => void;
  readonly onTryAiTasteScan: () => void;
  readonly onOpenWorkbenchIntro: () => void;
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
  onOpenJingwei,
  onCreateChapter,
  onTryAiWriting,
  onTryAiTasteScan,
  onOpenWorkbenchIntro,
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
      description: "连接 provider、API Key 和默认模型。",
      completed: status.tasks.modelConfigured,
      recommended: true,
      actionLabel: status.tasks.modelConfigured ? "查看配置" : "配置模型",
      statusText: modelStatusText,
      onClick: onConfigureModel,
    },
    {
      title: "创建第一本书",
      description: "先创建本地书籍，之后再逐步接入 AI 初始化。",
      completed: status.tasks.hasAnyBook,
      actionLabel: status.tasks.hasAnyBook ? "继续管理" : "创建书籍",
      onClick: onCreateBook,
    },
    {
      title: "认识故事经纬",
      description: "了解本书长期记忆与结构脉络。",
      completed: status.tasks.hasOpenedJingwei,
      actionLabel: "打开经纬",
      onClick: onOpenJingwei,
    },
    {
      title: "创建第一章 / 导入正文",
      description: "写入或导入正文，让工作台开始围绕文本运转。",
      completed: status.tasks.hasAnyChapter,
      actionLabel: "开始章节",
      onClick: onCreateChapter,
    },
    {
      title: "试用 AI 写作与评点",
      description: "模型配置完成后再试用续写、改写和评点。",
      completed: status.tasks.hasTriedAiWriting,
      actionLabel: status.provider.hasUsableModel ? "试用 AI 写作" : "先配置模型",
      onClick: onTryAiWriting,
    },
    {
      title: "试用 AI 味检测",
      description: "检测当前文本的 AI 痕迹，基础检测可先本地体验。",
      completed: status.tasks.hasTriedAiTasteScan,
      actionLabel: "打开检测",
      onClick: onTryAiTasteScan,
    },
    {
      title: "了解工作台模式",
      description: "查看高级 Agent、工具调用和更高 token 消耗的边界。",
      completed: status.tasks.hasReadWorkbenchIntro,
      actionLabel: "了解模式",
      onClick: onOpenWorkbenchIntro,
    },
  ];

  return (
    <Card className="border-primary/20 bg-primary/[0.03]">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>开始使用 NovelFork</CardTitle>
            <CardDescription>
              按推荐顺序完成首用任务。模型配置排第一，但未配置也可以继续本地写作。
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
