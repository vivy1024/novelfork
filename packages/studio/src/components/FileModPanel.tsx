/**
 * FileModPanel - 文件修改面板
 * 显示 worktree 中的文件变更列表和 diff
 */

import { useState, useEffect } from "react";
import { FileText, FilePlus, FileX, FileQuestion } from "lucide-react";
import { DiffViewer } from "./DiffViewer";
import { fetchJson } from "../hooks/use-api";

export interface FileModPanelProps {
  worktreePath: string;
}

interface FileStatus {
  modified: string[];
  added: string[];
  deleted: string[];
  untracked: string[];
  hasChanges: boolean;
}

interface FileItem {
  path: string;
  type: "modified" | "added" | "deleted" | "untracked";
}

const FILE_TYPE_ICONS = {
  modified: FileText,
  added: FilePlus,
  deleted: FileX,
  untracked: FileQuestion,
};

const FILE_TYPE_COLORS = {
  modified: "text-yellow-600 dark:text-yellow-400",
  added: "text-green-600 dark:text-green-400",
  deleted: "text-red-600 dark:text-red-400",
  untracked: "text-blue-600 dark:text-blue-400",
};

const FILE_TYPE_LABELS = {
  modified: "M",
  added: "A",
  deleted: "D",
  untracked: "?",
};

export function FileModPanel({ worktreePath }: FileModPanelProps) {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diff, setDiff] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 获取文件列表
  useEffect(() => {
    const fetchFiles = async () => {
      setLoadingFiles(true);
      setError(null);

      try {
        const data = await fetchJson<{ status: FileStatus }>(
          `/api/worktree/status?path=${encodeURIComponent(worktreePath)}`
        );

        const fileList: FileItem[] = [
          ...data.status.modified.map(path => ({ path, type: "modified" as const })),
          ...data.status.added.map(path => ({ path, type: "added" as const })),
          ...data.status.deleted.map(path => ({ path, type: "deleted" as const })),
          ...data.status.untracked.map(path => ({ path, type: "untracked" as const })),
        ];

        setFiles(fileList);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch file list");
        setFiles([]);
      } finally {
        setLoadingFiles(false);
      }
    };

    void fetchFiles();
  }, [worktreePath]);

  useEffect(() => {
    if (!selectedFile) {
      setDiff("");
      setError(null);
      return;
    }

    // 获取文件的 diff
    const fetchDiff = async () => {
      setLoading(true);
      setError(null);

      try {
        const data = await fetchJson<{ diff: string }>(
          `/api/worktree/diff?path=${encodeURIComponent(worktreePath)}&file=${encodeURIComponent(selectedFile)}`
        );
        setDiff(data.diff || "");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch diff");
        setDiff("");
      } finally {
        setLoading(false);
      }
    };

    void fetchDiff();
  }, [selectedFile, worktreePath]);

  if (loadingFiles) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-3"></div>
          <p className="text-sm">加载文件列表...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-destructive">
        <div className="text-center">
          <p className="text-sm font-medium mb-2">加载失败</p>
          <p className="text-xs text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <FileText size={48} className="mx-auto mb-3 opacity-50" />
          <p>此 Worktree 没有文件变更</p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[300px_1fr] gap-4 h-full">
      {/* 左侧：文件列表 */}
      <div className="border rounded-lg p-4 overflow-auto bg-background">
        <h3 className="font-medium mb-3 text-sm">
          修改的文件 ({files.length})
        </h3>

        <div className="space-y-1">
          {files.map((file) => {
            const Icon = FILE_TYPE_ICONS[file.type];
            const color = FILE_TYPE_COLORS[file.type];
            const label = FILE_TYPE_LABELS[file.type];

            return (
              <button
                key={file.path}
                onClick={() => setSelectedFile(file.path)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded text-sm hover:bg-accent transition-colors text-left ${
                  selectedFile === file.path ? "bg-accent" : ""
                }`}
                title={file.path}
              >
                <Icon size={16} className={`${color} flex-shrink-0`} />
                <span className="truncate flex-1 text-foreground">
                  {file.path}
                </span>
                <span
                  className={`text-xs font-mono font-bold ${color} flex-shrink-0`}
                >
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 右侧：Diff 展示 */}
      <div className="border rounded-lg p-4 overflow-auto bg-background">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-muted-foreground">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-3"></div>
              <p className="text-sm">加载 diff...</p>
            </div>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-destructive">
              <p className="text-sm font-medium mb-2">加载失败</p>
              <p className="text-xs text-muted-foreground">{error}</p>
            </div>
          </div>
        ) : selectedFile ? (
          <DiffViewer diff={diff} fileName={selectedFile} />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center">
              <FileText size={48} className="mx-auto mb-3 opacity-50" />
              <p className="text-sm">选择一个文件查看 diff</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
