import { useState, useEffect } from "react";
import { X, GitBranch, GitMerge } from "lucide-react";
import { execGit, forkBranch, mergeBranch, createWorktree } from "../../api/lib/git-utils";

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
    loadBranches();
  }, [repoPath]);

  async function loadBranches() {
    try {
      const output = await execGit(["branch", "-a"], repoPath);
      const branchList = output
        .split("\n")
        .map((line) => line.replace(/^\*?\s+/, "").trim())
        .filter(Boolean);
      setBranches(branchList);
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
      await createWorktree(repoPath, branchName, branchName);
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
      const result = await mergeBranch(repoPath, selectedBranch);
      if (result.success) {
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-[500px]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b dark:border-gray-700">
          <h2 className="text-lg font-semibold">Git Fork/合并</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode Tabs */}
        <div className="flex border-b dark:border-gray-700">
          <button
            onClick={() => setMode("fork")}
            className={`flex items-center gap-2 px-4 py-2 flex-1 justify-center ${
              mode === "fork"
                ? "border-b-2 border-blue-500 text-blue-600 dark:text-blue-400"
                : "text-gray-600 dark:text-gray-400"
            }`}
          >
            <GitBranch className="w-4 h-4" />
            Fork
          </button>
          <button
            onClick={() => setMode("merge")}
            className={`flex items-center gap-2 px-4 py-2 flex-1 justify-center ${
              mode === "merge"
                ? "border-b-2 border-blue-500 text-blue-600 dark:text-blue-400"
                : "text-gray-600 dark:text-gray-400"
            }`}
          >
            <GitMerge className="w-4 h-4" />
            Merge
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-3 rounded text-sm">
              {error}
            </div>
          )}

          {success && (
            <div className="bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 p-3 rounded text-sm">
              {success}
            </div>
          )}

          {mode === "fork" && (
            <div>
              <label className="block text-sm font-medium mb-2">新分支名</label>
              <input
                type="text"
                value={branchName}
                onChange={(e) => setBranchName(e.target.value)}
                placeholder="feature/new-branch"
                className="w-full px-3 py-2 border dark:border-gray-700 rounded bg-white dark:bg-gray-800"
              />
              <p className="text-xs text-gray-500 mt-1">将创建新的 Worktree</p>
            </div>
          )}

          {mode === "merge" && (
            <div>
              <label className="block text-sm font-medium mb-2">源分支</label>
              <select
                value={selectedBranch}
                onChange={(e) => setSelectedBranch(e.target.value)}
                className="w-full px-3 py-2 border dark:border-gray-700 rounded bg-white dark:bg-gray-800"
              >
                <option value="">选择分支...</option>
                {branches.map((branch) => (
                  <option key={branch} value={branch}>
                    {branch}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">合并到当前分支</p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 p-4 border-t dark:border-gray-700">
          <button
            onClick={mode === "fork" ? handleFork : handleMerge}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {loading ? "处理中..." : mode === "fork" ? "创建 Fork" : "合并"}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
