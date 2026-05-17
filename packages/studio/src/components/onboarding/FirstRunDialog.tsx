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

type FirstRunDialogProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfigureModel: () => void;
  readonly onCreateBook: () => void;
  readonly onOpenLearnCenter: () => void;
  readonly onDismiss: () => void;
};

function EntryCard({
  title,
  badge,
  description,
  onClick,
}: {
  readonly title: string;
  readonly badge?: string;
  readonly description: string;
  readonly onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      className="h-auto w-full justify-start rounded-xl p-0 text-left hover:bg-transparent"
      onClick={onClick}
    >
      <Card className="w-full border border-border/70 bg-card/90 transition hover:border-primary/40 hover:bg-muted/30" size="sm">
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>{title}</CardTitle>
            {badge ? <Badge variant="secondary">{badge}</Badge> : null}
          </div>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
      </Card>
    </Button>
  );
}

export function FirstRunDialog({
  open,
  onOpenChange,
  onConfigureModel,
  onCreateBook,
  onOpenLearnCenter,
  onDismiss,
}: FirstRunDialogProps) {
  const dismiss = () => {
    onDismiss();
    onOpenChange(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && open) {
      onDismiss();
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent aria-label="首次欢迎" className="max-w-2xl sm:max-w-2xl" showCloseButton>
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle className="text-xl">欢迎使用 NovelFork</DialogTitle>
            <Badge>新手指导</Badge>
          </div>
          <DialogDescription>
            建议先配置 AI 模型；未配置也可以先创建书籍、整理经纬、编辑章节。AI 叙述者会在你需要时提供写作辅助。
          </DialogDescription>
        </DialogHeader>

        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="space-y-2">
            <p className="font-medium text-foreground">配置模型是推荐第一步，但不是使用门槛。</p>
            <p className="text-sm text-muted-foreground">
              配置后可使用续写、改写、评点、消 AI 味、经纬生成和叙述者对话；未配置时，本地写作流程仍然可用。
            </p>
          </CardContent>
        </Card>

        <div className="grid gap-3 sm:grid-cols-3">
          <EntryCard
            title="配置 AI 模型"
            badge="推荐第一步"
            description="连接 AI 供应商、填入 API Key，开启全部 AI 写作能力。"
            onClick={onConfigureModel}
          />
          <EntryCard
            title="创建第一本书"
            description="创建作品后进入工作台，AI 叙述者会引导你完成题材和设定。"
            onClick={onCreateBook}
          />
          <EntryCard
            title="打开学习中心"
            description="查看教程、了解叙述者分工、经纬系统和预设节拍的用法。"
            onClick={onOpenLearnCenter}
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={dismiss}>
            暂时跳过
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
