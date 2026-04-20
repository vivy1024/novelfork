import { useEffect, useState } from "react";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

export type NewProjectTarget = "project-create" | "book-create";

interface NewProjectDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSelect: (target: NewProjectTarget) => void;
}

const ENTRY_OPTIONS: ReadonlyArray<{
  readonly target: NewProjectTarget;
  readonly title: string;
  readonly description: string;
  readonly badge?: string;
}> = [
  {
    target: "project-create",
    title: "正式项目创建",
    description: "先整理仓库来源、工作流模式、模板偏向与 Git 预留字段，再进入书籍骨架。",
    badge: "推荐",
  },
  {
    target: "book-create",
    title: "兼容直接建书",
    description: "继续走旧 BookCreate 单页入口，保持现在的一步式兼容链路。",
  },
];

export function NewProjectDialog({ open, onOpenChange, onSelect }: NewProjectDialogProps) {
  const [target, setTarget] = useState<NewProjectTarget>("project-create");

  useEffect(() => {
    if (open) {
      setTarget("project-create");
    }
  }, [open]);

  const handleSubmit = () => {
    onSelect(target);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0" showCloseButton>
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>新建项目</DialogTitle>
          <DialogDescription>
            Phase B 先把创建入口拉回正式对象流：从 NewProjectDialog 进入，再决定走 ProjectCreate 还是兼容 BookCreate。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 px-6 pb-6 sm:grid-cols-2">
          {ENTRY_OPTIONS.map((option) => {
            const active = option.target === target;
            return (
              <button
                key={option.target}
                type="button"
                onClick={() => setTarget(option.target)}
                className={`rounded-xl border px-4 py-4 text-left transition-all ${
                  active
                    ? "border-primary bg-primary/5 shadow-sm"
                    : "border-border bg-card hover:border-primary/40 hover:bg-muted/40"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium text-foreground">{option.title}</div>
                  {option.badge && (
                    <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                      {option.badge}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{option.description}</p>
              </button>
            );
          })}
        </div>

        <DialogFooter className="mt-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSubmit}>
            进入所选入口
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
