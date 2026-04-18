/**
 * Worktree 管理器页面
 * 提供 worktree 列表、创建、删除功能
 */

import { useState } from "react";
import { Plus, RefreshCw, AlertCircle, FolderGit2, X } from "lucide-react";
import { WorktreeCard } from "../components/WorktreeCard";
import { FileModPanel } from "../components/FileModPanel";
import { useWorktree } from "../hooks/use-worktree";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

interface WorktreeManagerProps {
  onBack: () => void;
}

export function WorktreeManager({ onBack }: WorktreeManagerProps) {
  const { worktrees, loading, error, createWorktree, deleteWorktree, refreshWorktrees } = useWorktree();

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [viewingChangesPath, setViewingChangesPath] = useState<string | null>(null);

  const [newWorktreeName, setNewWorktreeName] = useState("");
  const [newWorktreeBranch, setNewWorktreeBranch] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleCreate = async () => {
    if (!newWorktreeName.trim()) return;

    setCreating(true);
    const success = await createWorktree(
      newWorktreeName.trim(),
      newWorktreeBranch.trim() || undefined
    );
    setCreating(false);

    if (success) {
      setCreateDialogOpen(false);
      setNewWorktreeName("");
      setNewWorktreeBranch("");
    }
  };

  const handleDelete = async () => {
    if (!selectedPath) return;

    setDeleting(true);
    const success = await deleteWorktree(selectedPath, false);
    setDeleting(false);

    if (success) {
      setDeleteDialogOpen(false);
      setSelectedPath(null);
    }
  };

  const handleOpenWorktree = (path: string) => {
    // PWA 环境：复制路径到剪贴板
    void navigator.clipboard.writeText(path);
    alert(`路径已复制到剪贴板：${path}`);
  };

  const handleDeleteClick = (path: string) => {
    setSelectedPath(path);
    setDeleteDialogOpen(true);
  };

  const handleViewChanges = (path: string) => {
    setViewingChangesPath(path);
  };

  const handleCloseChanges = () => {
    setViewingChangesPath(null);
  };

  // 如果正在查看变更，显示 FileModPanel
  if (viewingChangesPath) {
    const worktree = worktrees.find(w => w.path === viewingChangesPath);
    if (!worktree) {
      setViewingChangesPath(null);
      return null;
    }

    // 从 worktree.status 获取实际的文件列表
    // 注意：worktree.status 只有计数，需要调用 API 获取详细文件列表
    return (
      <div className="h-full flex flex-col bg-background">
        {/* 顶部工具栏 */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={handleCloseChanges}>
              ← 返回列表
            </Button>
            <h1 className="text-2xl font-bold">文件变更</h1>
            <span className="text-sm text-muted-foreground">
              {worktree.branch}
            </span>
          </div>
        </div>

        {/* FileModPanel */}
        <div className="flex-1 overflow-hidden p-4">
          <FileModPanel worktreePath={viewingChangesPath} />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background" data-testid="worktree-panel">
      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={onBack}>
            ← 返回
          </Button>
          <h1 className="text-2xl font-bold">Worktree 管理</h1>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={refreshWorktrees}
            disabled={loading}
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            刷新
          </Button>
          <Button
            size="sm"
            onClick={() => setCreateDialogOpen(true)}
            data-testid="create-worktree-btn"
          >
            <Plus size={16} className="mr-1" />
            创建 Worktree
          </Button>
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mx-4 mt-4 p-3 bg-destructive/10 border border-destructive/20 rounded-md flex items-start gap-2">
          <AlertCircle size={18} className="text-destructive flex-shrink-0 mt-0.5" />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Worktree 列表 */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading && worktrees.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            加载中...
          </div>
        ) : worktrees.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <FolderGit2 size={48} className="mb-4 opacity-50" />
            <p>暂无 Worktree</p>
            <p className="text-sm mt-2">点击"创建 Worktree"开始</p>
          </div>
        ) : (
          <div className="space-y-3">
            {worktrees.map((worktree) => (
              <WorktreeCard
                key={worktree.path}
                worktree={worktree}
                onDelete={handleDeleteClick}
                onOpen={handleOpenWorktree}
                onViewChanges={handleViewChanges}
              />
            ))}
          </div>
        )}
      </div>

      {/* 创建对话框 */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建 Worktree</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="worktree-name">Worktree 名称 *</Label>
              <Input
                id="worktree-name"
                placeholder="例如：feature-x"
                value={newWorktreeName}
                onChange={(e) => setNewWorktreeName(e.target.value)}
                disabled={creating}
              />
              <p className="text-xs text-muted-foreground">
                将在 .inkos-worktrees/ 目录下创建
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="worktree-branch">分支名（可选）</Label>
              <Input
                id="worktree-branch"
                placeholder="留空则自动创建 worktree/名称"
                value={newWorktreeBranch}
                onChange={(e) => setNewWorktreeBranch(e.target.value)}
                disabled={creating}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateDialogOpen(false)}
              disabled={creating}
            >
              取消
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!newWorktreeName.trim() || creating}
            >
              {creating ? "创建中..." : "创建"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认对话框 */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
          </DialogHeader>

          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              确定要删除此 Worktree 吗？
            </p>
            <p className="text-sm font-mono mt-2 p-2 bg-muted rounded">
              {selectedPath}
            </p>
            <p className="text-sm text-destructive mt-3">
              如果有未提交的更改，删除将失败。
            </p>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={deleting}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "删除中..." : "删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
