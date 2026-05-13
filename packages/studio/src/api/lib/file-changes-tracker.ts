/**
 * File Changes Tracker — tracks file modifications made by Agent tools per session.
 *
 * Provides:
 * - In-memory tracking of Write/Edit/Delete operations
 * - Original content capture for single-file revert
 * - Session-scoped change history
 */

import { readFile, writeFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FileChangeType = "created" | "modified" | "deleted";

export interface FileChange {
  readonly path: string;
  readonly type: FileChangeType;
  readonly originalContent: string | null;
  readonly timestamp: number;
  readonly toolCallId: string;
  readonly toolName: string;
}

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

const sessionChanges = new Map<string, FileChange[]>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Record a file change for a session. Call this AFTER the tool executes successfully.
 * For "modified" type, `originalContent` should be captured BEFORE the write.
 */
export function trackFileChange(
  sessionId: string,
  change: { path: string; type: FileChangeType; originalContent: string | null; toolCallId: string; toolName: string },
): void {
  const changes = sessionChanges.get(sessionId) ?? [];
  changes.push({ ...change, timestamp: Date.now() });
  sessionChanges.set(sessionId, changes);
}

/** Get all file changes for a session, ordered by timestamp. */
export function getSessionFileChanges(sessionId: string): readonly FileChange[] {
  return sessionChanges.get(sessionId) ?? [];
}

/** Revert a single file to its pre-modification state. */
export async function revertFileChange(
  sessionId: string,
  filePath: string,
  workDir?: string,
): Promise<{ ok: boolean; error?: string }> {
  const changes = sessionChanges.get(sessionId);
  if (!changes) return { ok: false, error: "No changes tracked for this session" };

  // Find the most recent change for this path
  const change = [...changes].reverse().find((c) => c.path === filePath);
  if (!change) return { ok: false, error: `No change found for path: ${filePath}` };

  const { resolve } = await import("node:path");
  const resolvedPath = workDir ? resolve(workDir, filePath) : filePath;

  try {
    if (change.type === "created") {
      // File was created — delete it to revert
      if (existsSync(resolvedPath)) {
        await unlink(resolvedPath);
      }
    } else if (change.type === "deleted") {
      // File was deleted — restore original content
      if (change.originalContent !== null) {
        await writeFile(resolvedPath, change.originalContent, "utf-8");
      } else {
        return { ok: false, error: "Cannot revert deletion: original content not captured" };
      }
    } else {
      // File was modified — restore original content
      if (change.originalContent !== null) {
        await writeFile(resolvedPath, change.originalContent, "utf-8");
      } else {
        return { ok: false, error: "Cannot revert modification: original content not captured" };
      }
    }

    // Remove the change from tracking
    const idx = changes.indexOf(change);
    if (idx >= 0) changes.splice(idx, 1);

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

/** Clear all tracked changes for a session. */
export function clearSessionFileChanges(sessionId: string): void {
  sessionChanges.delete(sessionId);
}

/**
 * Capture original file content before a write/edit operation.
 * Returns null if file doesn't exist (will be a "created" change).
 */
export async function captureOriginalContent(filePath: string, workDir?: string): Promise<string | null> {
  try {
    const { resolve } = await import("node:path");
    const resolvedPath = workDir ? resolve(workDir, filePath) : filePath;
    if (!existsSync(resolvedPath)) return null;
    return await readFile(resolvedPath, "utf-8");
  } catch {
    return null;
  }
}
