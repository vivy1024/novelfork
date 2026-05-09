import { useState, useEffect } from "react";
import { X, FileText, GitCommit, List } from "lucide-react";

import { Button } from "@/components/ui/button";

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="flex max-h-[80vh] w-[800px] flex-col rounded-lg border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h2 className="text-lg font-semibold">Git 日志</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="flex border-b border-border">
          <Button
            variant="ghost"
            onClick={() => setActiveTab("log")}
            className={`rounded-none ${activeTab === "log" ? "border-b-2 border-primary text-primary" : ""}`}
          >
            <GitCommit className="w-4 h-4" />
            Log
          </Button>
          <Button
            variant="ghost"
            onClick={() => setActiveTab("diff")}
            className={`rounded-none ${activeTab === "diff" ? "border-b-2 border-primary text-primary" : ""}`}
          >
            <FileText className="w-4 h-4" />
            Diff
          </Button>
          <Button
            variant="ghost"
            onClick={() => setActiveTab("status")}
            className={`rounded-none ${activeTab === "status" ? "border-b-2 border-primary text-primary" : ""}`}
          >
            <List className="w-4 h-4" />
            Status
          </Button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {loading && <div className="text-center text-muted-foreground">加载中...</div>}
          {error && <div className="text-sm text-destructive">{error}</div>}

          {!loading && !error && (
            <>
              {activeTab === "log" && (
                <div className="space-y-2">
                  {commits.map((commit) => (
                    <div
                      key={commit.hash}
                      className="flex items-start gap-3 rounded p-2 hover:bg-muted"
                    >
                      <code className="text-xs font-mono text-muted-foreground">{commit.hash}</code>
                      <span className="text-sm">{commit.message}</span>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === "diff" && (
                <pre className="whitespace-pre-wrap rounded bg-muted p-3 text-xs font-mono">
                  {diff}
                </pre>
              )}

              {activeTab === "status" && (
                <div className="space-y-2">
                  {status.split("\n").map((line, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm font-mono">
                      <span className="text-muted-foreground">{line.substring(0, 2)}</span>
                      <span>{line.substring(3)}</span>
                      {line.trim() && (
                        <Button
                          variant="link"
                          size="sm"
                          onClick={() => handleStage(line.substring(3))}
                          className="ml-auto"
                        >
                          Stage
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border p-4">
          <Button onClick={handleCommit}>
            Commit
          </Button>
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
        </div>
      </div>
    </div>
  );
}
