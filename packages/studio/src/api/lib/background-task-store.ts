/**
 * Background Task Store — persists background subagent task state to SQLite.
 *
 * Ensures task status survives server restarts. On startup, any tasks left in
 * "running" state are marked "interrupted" since the process that owned them
 * is gone.
 */

import type { StorageDatabase } from "@vivy1024/novelfork-core";

import { getSessionStorageDatabase } from "./session-storage.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BackgroundTaskStatus = "pending" | "running" | "completed" | "failed" | "interrupted";

export interface BackgroundTask {
  id: string;
  type: string;
  status: BackgroundTaskStatus;
  sessionId: string | null;
  configJson: string | null;
  resultJson: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface CreateBackgroundTaskInput {
  id: string;
  type?: string;
  status?: BackgroundTaskStatus;
  sessionId?: string | null;
  configJson?: string | null;
}

export interface UpdateBackgroundTaskInput {
  status?: BackgroundTaskStatus;
  resultJson?: string | null;
  error?: string | null;
  completedAt?: string | null;
}

// ---------------------------------------------------------------------------
// Schema migration (lazy, idempotent)
// ---------------------------------------------------------------------------

const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS background_tasks (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'subagent',
  status TEXT NOT NULL DEFAULT 'pending',
  session_id TEXT,
  config_json TEXT,
  result_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_background_tasks_session ON background_tasks(session_id);
CREATE INDEX IF NOT EXISTS idx_background_tasks_status ON background_tasks(status);
`;

let migrated = false;

function ensureMigration(storage: StorageDatabase): void {
  if (migrated) return;
  storage.sqlite.exec(MIGRATION_SQL);
  migrated = true;
}

function getStorage(): StorageDatabase {
  const storage = getSessionStorageDatabase();
  ensureMigration(storage);
  return storage;
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

interface BackgroundTaskRow {
  id: string;
  type: string;
  status: string;
  session_id: string | null;
  config_json: string | null;
  result_json: string | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

function rowToTask(row: BackgroundTaskRow): BackgroundTask {
  return {
    id: row.id,
    type: row.type,
    status: row.status as BackgroundTaskStatus,
    sessionId: row.session_id,
    configJson: row.config_json,
    resultJson: row.result_json,
    error: row.error,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

export function createBackgroundTask(input: CreateBackgroundTaskInput): BackgroundTask {
  const storage = getStorage();
  const type = input.type ?? "subagent";
  const status = input.status ?? "pending";
  const sessionId = input.sessionId ?? null;
  const configJson = input.configJson ?? null;

  storage.sqlite
    .prepare(
      `INSERT INTO background_tasks (id, type, status, session_id, config_json)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(input.id, type, status, sessionId, configJson);

  const row = storage.sqlite
    .prepare<BackgroundTaskRow>(`SELECT * FROM background_tasks WHERE id = ?`)
    .get(input.id);

  return rowToTask(row!);
}

export function updateBackgroundTask(id: string, updates: UpdateBackgroundTaskInput): BackgroundTask | null {
  const storage = getStorage();

  const setClauses: string[] = [];
  const params: unknown[] = [];

  if (updates.status !== undefined) {
    setClauses.push(`status = ?`);
    params.push(updates.status);
  }
  if (updates.resultJson !== undefined) {
    setClauses.push(`result_json = ?`);
    params.push(updates.resultJson);
  }
  if (updates.error !== undefined) {
    setClauses.push(`error = ?`);
    params.push(updates.error);
  }
  if (updates.completedAt !== undefined) {
    setClauses.push(`completed_at = ?`);
    params.push(updates.completedAt);
  }

  if (setClauses.length === 0) {
    return getBackgroundTask(id);
  }

  params.push(id);
  storage.sqlite
    .prepare(`UPDATE background_tasks SET ${setClauses.join(", ")} WHERE id = ?`)
    .run(...params);

  return getBackgroundTask(id);
}

export function getBackgroundTask(id: string): BackgroundTask | null {
  const storage = getStorage();
  const row = storage.sqlite
    .prepare<BackgroundTaskRow>(`SELECT * FROM background_tasks WHERE id = ?`)
    .get(id);
  return row ? rowToTask(row) : null;
}

export function listBackgroundTasks(sessionId?: string): BackgroundTask[] {
  const storage = getStorage();

  if (sessionId) {
    const rows = storage.sqlite
      .prepare<BackgroundTaskRow>(`SELECT * FROM background_tasks WHERE session_id = ? ORDER BY created_at DESC`)
      .all(sessionId);
    return rows.map(rowToTask);
  }

  const rows = storage.sqlite
    .prepare<BackgroundTaskRow>(`SELECT * FROM background_tasks ORDER BY created_at DESC`)
    .all();
  return rows.map(rowToTask);
}

/**
 * Mark all tasks currently in "running" or "pending" state as "interrupted".
 * Call this on server startup to clean up stale tasks from a previous process.
 */
export function markInterruptedTasks(): number {
  const storage = getStorage();
  const result = storage.sqlite
    .prepare(`UPDATE background_tasks SET status = 'interrupted', completed_at = datetime('now') WHERE status IN ('running', 'pending')`)
    .run();
  return result.changes;
}
