/**
 * GitPanel — 对话窗口底部的 Git 管理面板
 * 对标 NarraFork：变更/提交/暂存 三标签页
 */

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { fetchJson } from "@/hooks/use-api";
import { Check, Plus, X, RotateCcw } from "lucide-react";

interface GitFile {
  path: string;
  status: string;
  staged: boolean;
}

interface GitCommit {
  hash: string;
  short: string;
  message: string;
  author: string;
  date: string;
}

interface GitPanelProps {
  workDir: string;
  onClose?: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  modified: "text-orange-500",
  added: "text-green-500",
  deleted: "text-red-500",
  untracked: "text-gray-400",
  renamed: "text-blue-500",
};

const STATUS_LABELS: Record<string, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  untracked: "??",
  renamed: "R",
};

export function GitPanel({ workDir, onClose }: GitPanelProps) {
  const [files, setFiles] = useState<GitFile[]>([]);
  const [branch, setBranch] = useState("");
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [commitMessage, setCommitMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);

  const loadStatus = useCallback(async () => {
    if (!workDir) return;
    setLoading(true);
    try {
      const data = await fetchJson<{ branch: string; files: GitFile[] }>(`/git/status?path=${encodeURIComponent(workDir)}`);
      setFiles(data.files);
      setBranch(data.branch);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [workDir]);

  const loadLog = useCallback(async () => {
    if (!workDir) return;
    try {
      const data = await fetchJson<{ commits: GitCommit[] }>(`/git/log?path=${encodeURIComponent(workDir)}&limit=20`);
      setCommits(data.commits);
    } catch { /* ignore */ }
  }, [workDir]);

  useEffect(() => { void loadStatus(); void loadLog(); }, [loadStatus, loadLog]);

  const stageFile = async (file: string) => {
    await fetch("/api/git/add", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: workDir, file }) });
    void loadStatus();
  };

  const stageAll = async () => {
    await fetch("/api/git/add-all", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: workDir }) });
    void loadStatus();
  };

  const discardAll = async () => {
    if (!window.confirm("确定丢弃所有未提交的变更？此操作不可撤销。")) return;
    await fetch("/api/git/discard-all", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: workDir }) });
    void loadStatus();
  };

  const handleCommit = async () => {
    if (!commitMessage.trim()) return;
    setCommitting(true);
    try {
      await fetch("/api/git/commit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: workDir, message: commitMessage.trim() }) });
      setCommitMessage("");
      void loadStatus();
      void loadLog();
    } catch { /* ignore */ }
    finally { setCommitting(false); }
  };

  const stagedFiles = files.filter((f) => f.staged);
  const unstagedFiles = files.filter((f) => !f.staged);

  return (
    <div className="border-t border-border bg-card">
      <Tabs defaultValue="changes" className="w-full">
        <div className="flex items-center justify-between px-3 py-1 border-b border-border">
          <TabsList className="h-7">
            <TabsTrigger value="changes" className="text-xs px-2 py-1">变更</TabsTrigger>
            <TabsTrigger value="commits" className="text-xs px-2 py-1">提交</TabsTrigger>
            <TabsTrigger value="stash" className="text-xs px-2 py-1">暂存</TabsTrigger>
          </TabsList>
          {onClose && (
            <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground p-0.5 rounded">
              <X className="size-3.5" />
            </button>
          )}
        </div>

        {/* 变更标签页 */}
        <TabsContent value="changes" className="m-0 max-h-[200px] overflow-y-auto">
          <div className="px-3 py-1.5 flex items-center justify-between border-b border-border">
            <span className="text-[11px] font-medium">变更 ({files.length})</span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={stageAll} className="text-[10px] text-blue-600 hover:underline">全部暂存</button>
              <button type="button" onClick={discardAll} className="text-[10px] text-red-500 hover:underline">丢弃全部</button>
            </div>
          </div>

          {loading ? (
            <div className="px-3 py-4 text-xs text-muted-foreground text-center">加载中...</div>
          ) : files.length === 0 ? (
            <div className="px-3 py-4 text-xs text-muted-foreground text-center">没有变更</div>
          ) : (
            <div className="divide-y divide-border">
              {unstagedFiles.map((file) => (
                <div key={file.path} className="flex items-center gap-2 px-3 py-1 hover:bg-muted/30 text-[11px]">
                  <span className={`font-mono w-5 shrink-0 ${STATUS_COLORS[file.status] ?? "text-muted-foreground"}`}>
                    {STATUS_LABELS[file.status] ?? "?"}
                  </span>
                  <span className="flex-1 truncate font-mono">{file.path}</span>
                  <button type="button" onClick={() => stageFile(file.path)} className="text-muted-foreground hover:text-green-500 shrink-0" title="暂存">
                    <Plus className="size-3" />
                  </button>
                </div>
              ))}
              {stagedFiles.length > 0 && (
                <>
                  <div className="px-3 py-1 text-[10px] text-muted-foreground bg-muted/20">已暂存 ({stagedFiles.length})</div>
                  {stagedFiles.map((file) => (
                    <div key={`staged-${file.path}`} className="flex items-center gap-2 px-3 py-1 hover:bg-muted/30 text-[11px]">
                      <span className="font-mono w-5 shrink-0 text-green-500">
                        {STATUS_LABELS[file.status] ?? "?"}
                      </span>
                      <span className="flex-1 truncate font-mono">{file.path}</span>
                      <Check className="size-3 text-green-500 shrink-0" />
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {/* 提交信息输入 */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 border-t border-border">
            <Input
              placeholder="提交信息..."
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleCommit(); } }}
              className="flex-1 h-7 text-xs"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => void stageAll()}
              className="h-7 px-2 text-[10px]"
              title="暂存全部"
            >
              <Plus className="size-3" />
            </Button>
            <Button
              size="sm"
              onClick={() => void handleCommit()}
              disabled={!commitMessage.trim() || committing}
              className="h-7 px-2 text-[10px] gap-1"
            >
              <Check className="size-3" />
              提交
            </Button>
          </div>
        </TabsContent>

        {/* 提交历史标签页 */}
        <TabsContent value="commits" className="m-0 max-h-[200px] overflow-y-auto">
          {commits.length === 0 ? (
            <div className="px-3 py-4 text-xs text-muted-foreground text-center">暂无提交历史</div>
          ) : (
            <div className="divide-y divide-border">
              {commits.map((commit) => (
                <div key={commit.hash} className="px-3 py-1.5 hover:bg-muted/30">
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="font-mono text-blue-500 shrink-0">{commit.short}</span>
                    <span className="flex-1 truncate">{commit.message}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">{commit.date}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* 暂存标签页 */}
        <TabsContent value="stash" className="m-0 max-h-[200px] overflow-y-auto">
          <StashTab workDir={workDir} onRefresh={loadStatus} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StashTab({ workDir, onRefresh }: { workDir: string; onRefresh: () => void }) {
  const [stashing, setStashing] = useState(false);
  const [popping, setPopping] = useState(false);

  const handleStash = async () => {
    setStashing(true);
    try {
      await fetch("/api/git/stash", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: workDir }) });
      onRefresh();
    } catch { /* ignore */ }
    finally { setStashing(false); }
  };

  const handlePop = async () => {
    setPopping(true);
    try {
      await fetch("/api/git/stash-pop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: workDir }) });
      onRefresh();
    } catch { /* ignore */ }
    finally { setPopping(false); }
  };

  return (
    <div className="px-3 py-3 space-y-3">
      <p className="text-xs text-muted-foreground">将当前变更暂时保存到 stash，稍后恢复。</p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => void handleStash()} disabled={stashing} className="text-xs gap-1">
          <RotateCcw className="size-3" />
          {stashing ? "暂存中..." : "Stash 变更"}
        </Button>
        <Button variant="outline" size="sm" onClick={() => void handlePop()} disabled={popping} className="text-xs gap-1">
          {popping ? "恢复中..." : "Pop 恢复"}
        </Button>
      </div>
    </div>
  );
}
