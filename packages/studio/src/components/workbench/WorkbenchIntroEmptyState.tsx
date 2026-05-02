import { useState } from "react";

import { FeatureEmptyState } from "@/components/layout/FeatureEmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface WorkbenchIntroEmptyStateProps {
  onEnable: () => Promise<unknown> | unknown;
}

export function WorkbenchIntroEmptyState({ onEnable }: WorkbenchIntroEmptyStateProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleConfirm = async () => {
    await onEnable();
    setConfirmOpen(false);
  };

  return (
    <>
      <FeatureEmptyState
        preset="workbench-mode"
        onPrimaryAction={() => setConfirmOpen(true)}
        onSecondaryAction={() => setConfirmOpen(true)}
      >
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Badge variant="secondary">高级 Agent</Badge>
          <Badge variant="outline">工具调用记录</Badge>
          <Badge variant="outline">终端 / 浏览器 / MCP</Badge>
          <Badge variant="outline">会话权限模式</Badge>
          <Badge variant="outline">诊断与工具日志</Badge>
          <Badge variant="outline">更高 token 消耗</Badge>
        </div>
      </FeatureEmptyState>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent aria-label="开启工作台模式确认">
          <DialogHeader>
            <DialogTitle>开启工作台模式？</DialogTitle>
            <DialogDescription>
              工作台模式会暴露高级 Agent、Terminal / Shell、Browser 原始抓取、MCP、Worktree、Admin 诊断、Pipeline 工具详情与更高 token 消耗。普通写作通常不需要开启。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>开启后你会看到：</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Agent 控制台与工具调用记录</li>
              <li>Terminal / Shell、Browser 原始抓取、MCP 工具、Worktree 与高级运行治理</li>
              <li>逐项询问 / 允许编辑 / 全部允许 / 只读 / 规划模式的权限入口</li>
              <li>资源、请求、日志诊断面板，以及清晰的返回作者模式路径</li>
            </ul>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>
              先保持作者模式
            </Button>
            <Button type="button" onClick={() => void handleConfirm()}>
              确认开启
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
