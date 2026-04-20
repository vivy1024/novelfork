import { useState, useEffect } from "react";
import { X, FileText, GitCommit, List } from "lucide-react";
import { commitGitChanges, fetchGitOverview, stageGitFile } from "../../lib/git-api";

interface GitLogDialogProps {
  repoPath: string;
  onClose: () => void;
}

interface Commit {
  hash: string;
  message: string;
}

type TabType = "log" | "diff" | "status";

export function GitLogDialog({ repoPath, onClose }: GitLogDialogProps) {
  const [activeTab, setActiveTab] = useState<TabType>("log");
  const [commits, setCommits] = useState<Commit[]>([]);
  const [diff, setDiff] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void loadGitData();
  }, [repoPath]);

  async function loadGitData() {
    setLoading(true);
    setError("");
    try {
      const { log, diff, status } = await fetchGitOverview(repoPath);
      const commitList = log
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [hash, ...messageParts] = line.split(" ");
          return { hash, message: messageParts.join(" ") };
        });

      setCommits(commitList);
      setDiff(diff || "无变更");
      setStatus(status || "工作区干净");
    } catch (err: any) {
      setError(err.message || "加载 Git 数据失败");
    } finally {
      setLoading(false);
    }
  }

  async function handleStage(file: string) {
    try {
      await stageGitFile(repoPath, file);
      await loadGitData();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleCommit() {
    const message = prompt("提交信息:");
    if (!message) return;

    try {
      await commitGitChanges(repoPath, message);
      await loadGitData();
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-[800px] max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b dark:border-gray-700">
          <h2 className="text-lg font-semibold">Git 日志</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex border-b dark:border-gray-700">
          <button
            onClick={() => setActiveTab("log")}
            className={`flex items-center gap-2 px-4 py-2 ${
              activeTab === "log"
                ? "border-b-2 border-blue-500 text-blue-600 dark:text-blue-400"
                : "text-gray-600 dark:text-gray-400"
            }`}
          >
            <GitCommit className="w-4 h-4" />
            Log
          </button>
          <button
            onClick={() => setActiveTab("diff")}
            className={`flex items-center gap-2 px-4 py-2 ${
              activeTab === "diff"
                ? "border-b-2 border-blue-500 text-blue-600 dark:text-blue-400"
                : "text-gray-600 dark:text-gray-400"
            }`}
          >
            <FileText className="w-4 h-4" />
            Diff
          </button>
          <button
            onClick={() => setActiveTab("status")}
            className={`flex items-center gap-2 px-4 py-2 ${
              activeTab === "status"
                ? "border-b-2 border-blue-500 text-blue-600 dark:text-blue-400"
                : "text-gray-600 dark:text-gray-400"
            }`}
          >
            <List className="w-4 h-4" />
            Status
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {loading && <div className="text-center text-gray-500">加载中...</div>}
          {error && <div className="text-red-500 text-sm">{error}</div>}

          {!loading && !error && (
            <>
              {activeTab === "log" && (
                <div className="space-y-2">
                  {commits.map((commit) => (
                    <div
                      key={commit.hash}
                      className="flex items-start gap-3 p-2 hover:bg-gray-50 dark:hover:bg-gray-800 rounded"
                    >
                      <code className="text-xs text-gray-500 font-mono">{commit.hash}</code>
                      <span className="text-sm">{commit.message}</span>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === "diff" && (
                <pre className="text-xs font-mono whitespace-pre-wrap bg-gray-50 dark:bg-gray-800 p-3 rounded">
                  {diff}
                </pre>
              )}

              {activeTab === "status" && (
                <div className="space-y-2">
                  {status.split("\n").map((line, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm font-mono">
                      <span className="text-gray-500">{line.substring(0, 2)}</span>
                      <span>{line.substring(3)}</span>
                      {line.trim() && (
                        <button
                          onClick={() => handleStage(line.substring(3))}
                          className="ml-auto text-xs text-blue-600 hover:underline"
                        >
                          Stage
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 p-4 border-t dark:border-gray-700">
          <button
            onClick={handleCommit}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
          >
            Commit
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
