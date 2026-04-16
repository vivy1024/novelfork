/**
 * 文件监控 Hook
 * 监听 worktree 中的文件变化（轮询实现）
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { fetchJson } from "./use-api";

export interface FileChange {
  path: string;
  type: "modified" | "added" | "deleted" | "untracked";
}

export function useFileWatcher() {
  const [fileChanges, setFileChanges] = useState<FileChange[]>([]);
  const [connected, setConnected] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const worktreePathRef = useRef<string | null>(null);

  const connect = useCallback((worktreePath: string) => {
    worktreePathRef.current = worktreePath;
    setConnected(true);

    // 立即获取一次状态
    void fetchStatus(worktreePath);

    // 每2秒轮询一次
    intervalRef.current = setInterval(() => {
      void fetchStatus(worktreePath);
    }, 2000);
  }, []);

  const disconnect = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    worktreePathRef.current = null;
    setConnected(false);
    setFileChanges([]);
  }, []);

  const fetchStatus = async (worktreePath: string) => {
    try {
      const data = await fetchJson<{
        status: {
          modified: string[];
          added: string[];
          deleted: string[];
          untracked: string[];
        };
      }>(`/api/worktree/status?path=${encodeURIComponent(worktreePath)}`);

      const changes: FileChange[] = [
        ...data.status.modified.map((path) => ({ path, type: "modified" as const })),
        ...data.status.added.map((path) => ({ path, type: "added" as const })),
        ...data.status.deleted.map((path) => ({ path, type: "deleted" as const })),
        ...data.status.untracked.map((path) => ({ path, type: "untracked" as const })),
      ];

      setFileChanges(changes);
    } catch (error) {
      console.error("Failed to fetch worktree status:", error);
    }
  };

  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  return {
    fileChanges,
    connected,
    connect,
    disconnect,
  };
}
