/**
 * Worktree 状态管理 Hook
 * 提供 worktree 列表、创建、删除、刷新功能
 */

import { useState, useEffect, useCallback } from "react";
import { fetchJson, postApi } from "./use-api";

export interface Worktree {
  path: string;
  branch: string;
  head: string;
  bare: boolean;
  status: {
    modified: number;
    added: number;
    deleted: number;
    untracked: number;
  };
}

export function useWorktree() {
  const [worktrees, setWorktrees] = useState<Worktree[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchWorktrees = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJson<{ worktrees: Worktree[] }>("/api/worktree/list");
      setWorktrees(data.worktrees || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch worktrees");
      setWorktrees([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const createWorktree = useCallback(
    async (name: string, branch?: string) => {
      setError(null);
      try {
        await postApi<{ ok: boolean; path: string }>("/api/worktree/create", {
          name,
          branch,
        });
        await fetchWorktrees();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create worktree");
        return false;
      }
    },
    [fetchWorktrees]
  );

  const deleteWorktree = useCallback(
    async (path: string, force = false) => {
      setError(null);
      try {
        await fetchJson<{ ok: boolean }>("/api/worktree/remove", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path, force }),
        });
        await fetchWorktrees();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete worktree");
        return false;
      }
    },
    [fetchWorktrees]
  );

  const refreshWorktrees = useCallback(() => {
    void fetchWorktrees();
  }, [fetchWorktrees]);

  useEffect(() => {
    void fetchWorktrees();
    // 5秒轮询
    const interval = setInterval(() => {
      void fetchWorktrees();
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchWorktrees]);

  return {
    worktrees,
    loading,
    error,
    fetchWorktrees,
    createWorktree,
    deleteWorktree,
    refreshWorktrees,
  };
}
