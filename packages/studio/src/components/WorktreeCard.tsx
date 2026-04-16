/**
 * Worktree 卡片组件
 * 显示单个 worktree 的信息和操作按钮
 */

import { FolderGit2, Trash2, ExternalLink, FileText } from "lucide-react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";

export interface WorktreeCardProps {
  worktree: {
    path: string;
    branch: string;
    head: string;
    status: {
      modified: number;
      added: number;
      deleted: number;
      untracked: number;
    };
  };
  onDelete: (path: string) => void;
  onOpen: (path: string) => void;
  onViewChanges?: (path: string) => void;
}

export function WorktreeCard({ worktree, onDelete, onOpen, onViewChanges }: WorktreeCardProps) {
  const hasChanges =
    worktree.status.modified > 0 ||
    worktree.status.added > 0 ||
    worktree.status.deleted > 0 ||
    worktree.status.untracked > 0;

  return (
    <Card className="p-4 hover:bg-accent/50 transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <FolderGit2 size={20} className="text-primary flex-shrink-0" />
            <h3 className="text-lg font-semibold truncate">{worktree.branch}</h3>
          </div>

          <div className="space-y-1 text-sm text-muted-foreground">
            <p className="truncate" title={worktree.path}>
              {worktree.path}
            </p>
            <p className="font-mono text-xs">
              HEAD: {worktree.head.substring(0, 8)}
            </p>
          </div>

          {hasChanges && (
            <div className="flex flex-wrap gap-2 mt-3">
              {worktree.status.modified > 0 && (
                <Badge variant="default" className="bg-yellow-500/20 text-yellow-700 dark:text-yellow-300">
                  {worktree.status.modified} 修改
                </Badge>
              )}
              {worktree.status.added > 0 && (
                <Badge variant="default" className="bg-green-500/20 text-green-700 dark:text-green-300">
                  {worktree.status.added} 新增
                </Badge>
              )}
              {worktree.status.deleted > 0 && (
                <Badge variant="default" className="bg-red-500/20 text-red-700 dark:text-red-300">
                  {worktree.status.deleted} 删除
                </Badge>
              )}
              {worktree.status.untracked > 0 && (
                <Badge variant="default" className="bg-blue-500/20 text-blue-700 dark:text-blue-300">
                  {worktree.status.untracked} 未跟踪
                </Badge>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          {hasChanges && onViewChanges && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onViewChanges(worktree.path)}
              className="whitespace-nowrap"
            >
              <FileText size={14} className="mr-1" />
              查看变更
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => onOpen(worktree.path)}
            className="whitespace-nowrap"
          >
            <ExternalLink size={14} className="mr-1" />
            打开
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onDelete(worktree.path)}
            className="whitespace-nowrap text-destructive hover:bg-destructive/10"
          >
            <Trash2 size={14} className="mr-1" />
            删除
          </Button>
        </div>
      </div>
    </Card>
  );
}
