import { useState, useEffect } from "react";
import { X, GitBranch, GitMerge } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/ui/simple-select";

import { createGitWorktree, fetchGitBranches, mergeGitBranch } from "../../lib/git-api";

interface GitForkDialogProps {
  repoPath: string;
  onClose: () => void;
}

type ModeType = "fork" | "merge";

export function GitForkDialog({ repoPath, onClose }: GitForkDialogProps) {
  const [mode, setMode] = useState<ModeType>("fork");
  const [branchName, setBranchName] = useState("");
  const [branches, setBranches] = useState<string[]>([]);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    void loadBranches();
  }, [repoPath]);

  async function loadBranches() {
    try {
      const { branches } = await fetchGitBranches(repoPath);
      setBranches(branches);
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleFork() {
    if (!branchName.trim()) {
      setError("请输入分支名");
      return;
    }

    setLoading(true);
    setError("");
    setSuccess("");

    try {
      await createGitWorktree(repoPath, branchName, branchName);
      setSuccess(`Worktree 创建成功: ${branchName}`);
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleMerge() {
    if (!selectedBranch) {
      setError("请选择源分支");
      return;
    }

    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const result = await mergeGitBranch(repoPath, selectedBranch);
      if (result.ok) {
        setSuccess(result.message);
        setTimeout(() => {
          onClose();
        }, 1500);
      } else {
        setError(result.message);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="w-[500px] rounded-lg border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h2 className="text-lg font-semibold">Git Fork/合并</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="flex border-b border-border">
          <Button
            variant="ghost"
            onClick={() => setMode("fork")}
            className={`flex-1 rounded-none ${mode === "fork" ? "border-b-2 border-primary text-primary" : ""}`}
          >
            <GitBranch className="w-4 h-4" />
            Fork
          </Button>
          <Button
            variant="ghost"
            onClick={() => setMode("merge")}
            className={`flex-1 rounded-none ${mode === "merge" ? "border-b-2 border-primary text-primary" : ""}`}
          >
            <GitMerge className="w-4 h-4" />
            Merge
          </Button>
        </div>

        <div className="space-y-4 p-4">
          {error && (
            <div className="rounded border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {success && (
            <div className="rounded border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-600">
              {success}
            </div>
          )}

          {mode === "fork" && (
            <div>
              <label className="block text-sm font-medium mb-2">新分支名</label>
              <Input
                type="text"
                value={branchName}
                onChange={(e) => setBranchName(e.target.value)}
                placeholder="feature/new-branch"
              />
              <p className="text-xs text-muted-foreground mt-1">将创建新的 Worktree</p>
            </div>
          )}

          {mode === "merge" && (
            <div>
              <label className="block text-sm font-medium mb-2">源分支</label>
              <SimpleSelect
                value={selectedBranch}
                onValueChange={setSelectedBranch}
                options={branches.map((branch) => ({ value: branch, label: branch }))}
                placeholder="选择分支..."
                className="w-full"
              />
              <p className="text-xs text-muted-foreground mt-1">合并到当前分支</p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border p-4">
          <Button
            onClick={mode === "fork" ? handleFork : handleMerge}
            disabled={loading}
          >
            {loading ? "处理中..." : mode === "fork" ? "创建 Fork" : "合并"}
          </Button>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
        </div>
      </div>
    </div>
  );
}
