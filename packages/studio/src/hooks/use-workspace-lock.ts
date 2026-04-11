/**
 * use-workspace-lock — prevents two instances from operating on the same workspace.
 * Only active in Tauri mode; in browser mode returns unlocked-ok.
 */
import { useState, useEffect, useRef, useCallback } from "react";

interface UseWorkspaceLockReturn {
  readonly locked: boolean;
  readonly lockError: string | null;
}

const LOCK_FILE = ".inkos.lock";
const HEARTBEAT_MS = 10_000;
const STALE_MS = 30_000;
const WORKSPACE_KEY = "inkos-workspace";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function getTauriCore(): Promise<any> {
  const mod = await import("@tauri-apps/api/core") as any;
  return mod;
}

function lockPath(workspace: string): string {
  return workspace.endsWith("/") || workspace.endsWith("\\")
    ? `${workspace}${LOCK_FILE}`
    : `${workspace}/${LOCK_FILE}`;
}

export function useWorkspaceLock(): UseWorkspaceLockReturn {
  const [locked, setLocked] = useState(!isTauri());
  const [lockError, setLockError] = useState<string | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const workspaceRef = useRef<string | null>(null);

  const cleanup = useCallback(async () => {
    if (heartbeatRef.current !== null) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    if (workspaceRef.current) {
      try {
        const core = await getTauriCore();
        await core.invoke("plugin:fs|remove", { path: lockPath(workspaceRef.current) });
      } catch {
        // best-effort removal
      }
      workspaceRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isTauri()) {
      setLocked(true);
      setLockError(null);
      return;
    }

    const workspace = localStorage.getItem(WORKSPACE_KEY);
    if (!workspace) {
      setLocked(true);
      setLockError(null);
      return;
    }

    let cancelled = false;

    const writeLock = async (core: any, path: string): Promise<void> => {
      const content = JSON.stringify({ ts: Date.now(), pid: "studio" });
      await core.invoke("plugin:fs|write_text_file", { path, contents: content });
    };

    const acquire = async () => {
      try {
        const core = await getTauriCore();
        const path = lockPath(workspace);

        // Check existing lock
        try {
          const raw: string = await core.invoke("plugin:fs|read_text_file", { path });
          const parsed = JSON.parse(raw) as { ts?: number };
          if (parsed.ts && Date.now() - parsed.ts < STALE_MS) {
            if (!cancelled) {
              setLocked(false);
              setLockError("工作区已被另一个 InkOS 实例占用");
            }
            return;
          }
        } catch {
          // file doesn't exist or unreadable — safe to acquire
        }

        // Write our lock
        await writeLock(core, path);
        workspaceRef.current = workspace;

        if (!cancelled) {
          setLocked(true);
          setLockError(null);
        }

        // Heartbeat
        heartbeatRef.current = setInterval(async () => {
          try {
            const c = await getTauriCore();
            await writeLock(c, path);
          } catch {
            // heartbeat failure — lock may be lost
          }
        }, HEARTBEAT_MS);
      } catch (err) {
        if (!cancelled) {
          setLocked(false);
          setLockError(err instanceof Error ? err.message : "无法获取工作区锁");
        }
      }
    };

    void acquire();

    return () => {
      cancelled = true;
      void cleanup();
    };
  }, [cleanup]);

  return { locked, lockError };
}
