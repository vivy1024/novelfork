/**
 * Persisted Plan — save and restore scene.spec plans to/from SQLite.
 *
 * When a writing session is interrupted (user closes app, crash, etc.),
 * the scene.spec blueprint is lost and must be regenerated. This module
 * persists the plan to the existing kv_store table so it can be restored
 * on the next turn.
 */

import { getStorageDatabase } from "@vivy1024/novelfork-core";

export interface PersistedPlan {
  bookId: string;
  chapterNumber: number;
  planContent: string;
  createdAt: string;
}

/** Build the kv_store key for a plan. */
function planKey(bookId: string, chapterNumber: number): string {
  return `plan:${bookId}:${chapterNumber}`;
}

/**
 * Save a scene.spec plan for potential later restoration.
 */
export async function savePlan(
  bookId: string,
  chapterNumber: number,
  planContent: string,
): Promise<void> {
  const db = getStorageDatabase();
  const key = planKey(bookId, chapterNumber);
  const value = JSON.stringify({
    bookId,
    chapterNumber,
    planContent,
    createdAt: new Date().toISOString(),
  } satisfies PersistedPlan);
  const now = Date.now();
  db.sqlite
    .prepare(
      `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, ?)`,
    )
    .run(key, value, now);
}

/**
 * Restore a previously saved plan.
 */
export async function loadPlan(
  bookId: string,
  chapterNumber: number,
): Promise<PersistedPlan | null> {
  const db = getStorageDatabase();
  const key = planKey(bookId, chapterNumber);
  try {
    const row = db.sqlite
      .prepare<{ value: string }>(
        `SELECT value FROM kv_store WHERE key = ?`,
      )
      .get(key);
    if (row?.value) {
      return JSON.parse(row.value) as PersistedPlan;
    }
  } catch {
    // kv_store might not exist or parse error — non-fatal
  }
  return null;
}

/**
 * Delete a saved plan (e.g. after chapter is committed).
 */
export async function deletePlan(
  bookId: string,
  chapterNumber: number,
): Promise<void> {
  const db = getStorageDatabase();
  const key = planKey(bookId, chapterNumber);
  try {
    db.sqlite.prepare(`DELETE FROM kv_store WHERE key = ?`).run(key);
  } catch {
    // non-fatal
  }
}
