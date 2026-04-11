/**
 * use-crash-recovery — recovery journal for unsaved chapter edits (Tauri only).
 * Writes recovery files on content changes; detects stale recovery on app start.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { useInkOS } from "../providers/inkos-context";

interface RecoveryEntry {
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly timestamp: number;
  readonly filename: string;
  readonly content: string;
}

interface UseRecoveryReturn {
  readonly hasRecovery: boolean;
  readonly entries: ReadonlyArray<RecoveryEntry>;
  readonly recover: (entry: RecoveryEntry) => Promise<void>;
  readonly dismissAll: () => Promise<void>;
  readonly writeJournal: (bookId: string, chapterNumber: number, content: string) => void;
  readonly clearJournal: (bookId: string, chapterNumber: number) => void;
}

const MAX_RECOVERY_PER_CHAPTER = 10;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = await import("@tauri-apps/api/core") as any;
  return mod.invoke(cmd, args) as T;
}

function join(...parts: string[]): string {
  return parts.join("/").replace(/\/+/g, "/");
}

function parseRecoveryFilename(name: string): { bookId: string; chapterNumber: number; timestamp: number } | null {
  // Format: {bookId}_{chapterNumber}_{timestamp}.recovery
  const match = name.match(/^(.+)_(\d+)_(\d+)\.recovery$/);
  if (!match) return null;
  return { bookId: match[1], chapterNumber: parseInt(match[2], 10), timestamp: parseInt(match[3], 10) };
}

async function loadRecoveryEntries(workspace: string): Promise<RecoveryEntry[]> {
  const recoveryDir = join(workspace, ".inkos-recovery");
  const entries = await invoke<Array<{ name: string; is_dir: boolean }>>("list_dir", { path: recoveryDir }).catch(() => []);
  const results: RecoveryEntry[] = [];
  for (const e of entries) {
    if (e.is_dir || !e.name.endsWith(".recovery")) continue;
    const parsed = parseRecoveryFilename(e.name);
    if (!parsed) continue;
    try {
      const content = await invoke<string>("read_file_text", { path: join(recoveryDir, e.name) });
      results.push({ ...parsed, filename: e.name, content });
    } catch { /* skip unreadable */ }
  }
  return results.sort((a, b) => b.timestamp - a.timestamp);
}

async function pruneOldRecoveryFiles(workspace: string, bookId: string, chapterNumber: number): Promise<void> {
  const recoveryDir = join(workspace, ".inkos-recovery");
  const entries = await invoke<Array<{ name: string; is_dir: boolean }>>("list_dir", { path: recoveryDir }).catch(() => []);
  const matching: Array<{ name: string; timestamp: number }> = [];
  for (const e of entries) {
    if (e.is_dir) continue;
    const parsed = parseRecoveryFilename(e.name);
    if (parsed && parsed.bookId === bookId && parsed.chapterNumber === chapterNumber) {
      matching.push({ name: e.name, timestamp: parsed.timestamp });
    }
  }
  matching.sort((a, b) => b.timestamp - a.timestamp);
  // Remove oldest beyond MAX_RECOVERY_PER_CHAPTER
  for (const old of matching.slice(MAX_RECOVERY_PER_CHAPTER)) {
    await invoke("delete_path", { path: join(recoveryDir, old.name) }).catch(() => {});
  }
}

export { type RecoveryEntry };

export function useRecovery(): UseRecoveryReturn {
  const { mode, workspace } = useInkOS();
  const isTauri = mode === "tauri";
  const [entries, setEntries] = useState<ReadonlyArray<RecoveryEntry>>([]);
  const writeTimerRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const refresh = useCallback(async () => {
    if (!isTauri || !workspace) return;
    const loaded = await loadRecoveryEntries(workspace);
    setEntries(loaded);
  }, [isTauri, workspace]);

  useEffect(() => { void refresh(); }, [refresh]);

  const recover = useCallback(async (entry: RecoveryEntry) => {
    if (!workspace) return;
    // Write recovery content back to the chapter file
    const chaptersDir = join(workspace, "books", entry.bookId, "chapters");
    const dirEntries = await invoke<Array<{ name: string; is_dir: boolean }>>("list_dir", { path: chaptersDir });
    const padded = String(entry.chapterNumber).padStart(4, "0");
    const match = dirEntries.find(e => e.name.startsWith(padded) && e.name.endsWith(".md"));
    if (!match) throw new Error(`Chapter ${entry.chapterNumber} not found`);
    await invoke("write_file_text", { path: join(chaptersDir, match.name), content: entry.content });
    // Remove the recovery file
    const recoveryDir = join(workspace, ".inkos-recovery");
    await invoke("delete_path", { path: join(recoveryDir, entry.filename) }).catch(() => {});
    await refresh();
  }, [workspace, refresh]);

  const dismissAll = useCallback(async () => {
    if (!workspace) return;
    const recoveryDir = join(workspace, ".inkos-recovery");
    const dirEntries = await invoke<Array<{ name: string; is_dir: boolean }>>("list_dir", { path: recoveryDir }).catch(() => []);
    for (const e of dirEntries) {
      if (!e.is_dir && e.name.endsWith(".recovery")) {
        await invoke("delete_path", { path: join(recoveryDir, e.name) }).catch(() => {});
      }
    }
    setEntries([]);
  }, [workspace]);

  const writeJournal = useCallback((bookId: string, chapterNumber: number, content: string) => {
    if (!isTauri || !workspace) return;
    const key = `${bookId}_${chapterNumber}`;
    // Debounce writes per chapter (2s)
    const existing = writeTimerRef.current.get(key);
    if (existing) clearTimeout(existing);
    writeTimerRef.current.set(key, setTimeout(() => {
      const recoveryDir = join(workspace, ".inkos-recovery");
      const filename = `${bookId}_${chapterNumber}_${Date.now()}.recovery`;
      void (async () => {
        await invoke("ensure_dir", { path: recoveryDir });
        await invoke("write_file_text", { path: join(recoveryDir, filename), content });
        await pruneOldRecoveryFiles(workspace, bookId, chapterNumber);
      })();
    }, 2000));
  }, [isTauri, workspace]);

  const clearJournal = useCallback((bookId: string, chapterNumber: number) => {
    if (!isTauri || !workspace) return;
    const key = `${bookId}_${chapterNumber}`;
    const existing = writeTimerRef.current.get(key);
    if (existing) clearTimeout(existing);
    writeTimerRef.current.delete(key);
    // Remove all recovery files for this chapter
    const recoveryDir = join(workspace, ".inkos-recovery");
    void (async () => {
      const dirEntries = await invoke<Array<{ name: string; is_dir: boolean }>>("list_dir", { path: recoveryDir }).catch(() => []);
      for (const e of dirEntries) {
        if (e.is_dir) continue;
        const parsed = parseRecoveryFilename(e.name);
        if (parsed && parsed.bookId === bookId && parsed.chapterNumber === chapterNumber) {
          await invoke("delete_path", { path: join(recoveryDir, e.name) }).catch(() => {});
        }
      }
      await refresh();
    })();
  }, [isTauri, workspace, refresh]);

  return {
    hasRecovery: entries.length > 0,
    entries,
    recover,
    dismissAll,
    writeJournal,
    clearJournal,
  };
}
