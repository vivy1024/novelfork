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
  /**
   * Backend-supplied flag: true when the worktree path lives outside the
   * current project root (task 7.9.9 — backend half). The frontend falls back
   * to a longest-common-prefix heuristic when this field is absent so the UX
   * degrades gracefully on older servers.
   */
  isExternal?: boolean;
  externalReason?: "backend" | "heuristic";
  status: {
    modified: number;
    added: number;
    deleted: number;
    untracked: number;
  };
}

/**
 * Classify each worktree as internal/external relative to the main project.
 *
 * Preference order:
 *   1. Backend-supplied `isExternal` flag (once 7.9.9 backend ships).
 *   2. Longest-common-prefix heuristic: the primary worktree (first non-bare
 *      entry) is treated as the project root; entries whose normalized path
 *      shares that prefix are internal, everything else is external.
 */
export function classifyWorktrees(
  worktrees: ReadonlyArray<Worktree>,
): ReadonlyArray<Worktree & { readonly externalReason?: "backend" | "heuristic" }> {
  if (worktrees.length === 0) return [];

  const primary = worktrees.find((w) => !w.bare) ?? worktrees[0];
  const primaryRoot = normalizePath(primary.path);

  return worktrees.map((w) => {
    if (typeof w.isExternal === "boolean") {
      return w.isExternal ? { ...w, externalReason: "backend" as const } : w;
    }
    const wp = normalizePath(w.path);
    const isExternal = wp !== primaryRoot && !wp.startsWith(primaryRoot + "/");
    return isExternal ? { ...w, externalReason: "heuristic" as const } : w;
  });
}

/**
 * Select which classified worktrees to render based on the "仅显示当前项目"
 * toggle. When `showExternal` is false (default UI state), entries flagged by
 * either the backend or the fallback heuristic are hidden.
 */
export function getVisibleWorktrees<T extends { readonly externalReason?: string }>(
  worktrees: ReadonlyArray<T>,
  showExternal: boolean,
): ReadonlyArray<T> {
  return showExternal ? worktrees : worktrees.filter((w) => w.externalReason === undefined);
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
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
      setWorktrees([...classifyWorktrees(data.worktrees || [])]);
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
