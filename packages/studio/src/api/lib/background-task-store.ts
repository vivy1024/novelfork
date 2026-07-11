/**
 * Background Task Store — persists background task state to SQLite.
 *
 * The store is owner-aware: every normal CRUD call is scoped by the controlling
 * session so background task rows cannot be listed or mutated globally from a
 * regular session/tool path. Startup recovery remains global because it is a
 * process-level safety cleanup for tasks left by a previous server instance.
 */

import type { StorageDatabase } from "@vivy1024/novelfork-core";

import { getSessionStorageDatabase } from "./session-storage.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BackgroundTaskStatus = "pending" | "running" | "stopping" | "completed" | "failed" | "stopped" | "interrupted";

export interface BackgroundTask {
  id: string;
  type: string;
  status: BackgroundTaskStatus;
  /** Legacy execution/session field retained for old callers and databases. */
  sessionId: string | null;
  /** Control-plane owner session used for isolation. */
  controlOwnerSessionId: string | null;
  configJson: string | null;
  resultJson: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  terminalReason: string | null;
  terminalMetaJson: string | null;
}

export interface CreateBackgroundTaskInput {
  id: string;
  controlOwnerSessionId: string;
  type?: string;
  status?: BackgroundTaskStatus;
  /** Legacy execution/session field. Defaults to controlOwnerSessionId for compatibility. */
  sessionId?: string | null;
  configJson?: string | null;
}

export interface UpdateBackgroundTaskInput {
  status?: BackgroundTaskStatus;
  resultJson?: string | null;
  error?: string | null;
  completedAt?: string | null;
  terminalReason?: string | null;
  terminalMetaJson?: string | null;
}

// ---------------------------------------------------------------------------
// Schema migration (lazy, idempotent)
// ---------------------------------------------------------------------------

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS background_tasks (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'subagent',
  status TEXT NOT NULL DEFAULT 'pending',
  session_id TEXT,
  owner_session_id TEXT,
  config_json TEXT,
  result_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  terminal_reason TEXT,
  terminal_meta_json TEXT
);
`;

function getColumnNames(storage: StorageDatabase): Set<string> {
  const rows = storage.sqlite.prepare<{ name: string }>(`PRAGMA table_info(background_tasks)`).all();
  return new Set(rows.map((row) => row.name));
}

const migratedStorages = new WeakSet<StorageDatabase>();

function addColumnIfMissing(storage: StorageDatabase, columns: Set<string>, columnName: string, definition: string): void {
  if (columns.has(columnName)) return;
  storage.sqlite.exec(`ALTER TABLE background_tasks ADD COLUMN ${definition}`);
  columns.add(columnName);
}

function withImmediateTransaction<T>(storage: StorageDatabase, fn: () => T): T {
  storage.sqlite.exec(`BEGIN IMMEDIATE`);
  try {
    const result = fn();
    storage.sqlite.exec(`COMMIT`);
    return result;
  } catch (error) {
    try {
      storage.sqlite.exec(`ROLLBACK`);
    } catch {
      // Ignore rollback errors so the original failure is preserved.
    }
    throw error;
  }
}

function ensureMigration(storage: StorageDatabase): void {
  if (migratedStorages.has(storage)) return;

  withImmediateTransaction(storage, () => {
    storage.sqlite.exec(CREATE_TABLE_SQL);

    const columns = getColumnNames(storage);
    addColumnIfMissing(storage, columns, "owner_session_id", "owner_session_id TEXT");
    addColumnIfMissing(storage, columns, "terminal_reason", "terminal_reason TEXT");
    addColumnIfMissing(storage, columns, "terminal_meta_json", "terminal_meta_json TEXT");

    storage.sqlite.exec(`
UPDATE background_tasks
SET owner_session_id = session_id
WHERE (owner_session_id IS NULL OR trim(owner_session_id) = '')
  AND session_id IS NOT NULL
  AND trim(session_id) <> '';
`);

    storage.sqlite.exec(`
CREATE INDEX IF NOT EXISTS idx_background_tasks_session ON background_tasks(session_id);
CREATE INDEX IF NOT EXISTS idx_background_tasks_owner ON background_tasks(owner_session_id);
CREATE INDEX IF NOT EXISTS idx_background_tasks_status ON background_tasks(status);
`);
  });

  migratedStorages.add(storage);
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
  status: string | null;
  session_id: string | null;
  owner_session_id: string | null;
  config_json: string | null;
  result_json: string | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
  terminal_reason: string | null;
  terminal_meta_json: string | null;
}

const ACTIVE_STATUSES = new Set<BackgroundTaskStatus>(["pending", "running", "stopping"]);
const TERMINAL_STATUSES = new Set<BackgroundTaskStatus>(["completed", "failed", "stopped", "interrupted"]);
const KNOWN_STATUSES = new Set<BackgroundTaskStatus>([...ACTIVE_STATUSES, ...TERMINAL_STATUSES]);

function requireOwnerSessionId(controlOwnerSessionId: string | null | undefined): string {
  if (typeof controlOwnerSessionId !== "string") {
    throw new Error("controlOwnerSessionId is required for background task access.");
  }

  const owner = controlOwnerSessionId.trim();
  if (!owner) {
    throw new Error("controlOwnerSessionId is required for background task access.");
  }
  return owner;
}

function makeTerminalMetaJson(previousStatus: string | null, source: "startup-recovery" | "read-normalization"): string {
  return JSON.stringify({ previousStatus, recoveredFrom: source });
}

function normalizeStoredStatus(status: string | null): BackgroundTaskStatus {
  return status !== null && KNOWN_STATUSES.has(status as BackgroundTaskStatus) ? (status as BackgroundTaskStatus) : "interrupted";
}

function rowToTask(row: BackgroundTaskRow): BackgroundTask {
  const isKnownStatus = KNOWN_STATUSES.has(row.status as BackgroundTaskStatus);
  const status = normalizeStoredStatus(row.status);

  return {
    id: row.id,
    type: row.type,
    status,
    sessionId: row.session_id,
    controlOwnerSessionId: row.owner_session_id,
    configJson: row.config_json,
    resultJson: row.result_json,
    error: row.error,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    terminalReason: isKnownStatus ? row.terminal_reason : "malformed-record",
    terminalMetaJson: isKnownStatus ? row.terminal_meta_json : makeTerminalMetaJson(row.status, "read-normalization"),
  };
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

export function createBackgroundTask(input: CreateBackgroundTaskInput): BackgroundTask {
  const owner = requireOwnerSessionId(input.controlOwnerSessionId);
  const storage = getStorage();
  const type = input.type ?? "subagent";
  const status = input.status ?? "pending";
  const sessionId = input.sessionId ?? owner;
  const configJson = input.configJson ?? null;

  storage.sqlite
    .prepare(
      `INSERT INTO background_tasks (id, type, status, session_id, owner_session_id, config_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(input.id, type, status, sessionId, owner, configJson);

  const row = storage.sqlite
    .prepare<BackgroundTaskRow>(`SELECT * FROM background_tasks WHERE id = ? AND owner_session_id = ?`)
    .get(input.id, owner);

  return rowToTask(row!);
}

export function updateBackgroundTask(id: string, controlOwnerSessionId: string, updates: UpdateBackgroundTaskInput): BackgroundTask | null {
  const owner = requireOwnerSessionId(controlOwnerSessionId);
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
  if (updates.terminalReason !== undefined) {
    setClauses.push(`terminal_reason = ?`);
    params.push(updates.terminalReason);
  }
  if (updates.terminalMetaJson !== undefined) {
    setClauses.push(`terminal_meta_json = ?`);
    params.push(updates.terminalMetaJson);
  }

  if (setClauses.length === 0) {
    return getBackgroundTask(id, owner);
  }

  params.push(id, owner);
  const result = storage.sqlite
    .prepare(`UPDATE background_tasks SET ${setClauses.join(", ")} WHERE id = ? AND owner_session_id = ?`)
    .run(...params);

  if (result.changes === 0) return null;
  return getBackgroundTask(id, owner);
}

export function getBackgroundTask(id: string, controlOwnerSessionId: string): BackgroundTask | null {
  const owner = requireOwnerSessionId(controlOwnerSessionId);
  const storage = getStorage();
  const row = storage.sqlite
    .prepare<BackgroundTaskRow>(`SELECT * FROM background_tasks WHERE id = ? AND owner_session_id = ?`)
    .get(id, owner);
  return row ? rowToTask(row) : null;
}

export function listBackgroundTasks(controlOwnerSessionId: string): BackgroundTask[] {
  const owner = requireOwnerSessionId(controlOwnerSessionId);
  const storage = getStorage();
  const rows = storage.sqlite
    .prepare<BackgroundTaskRow>(`SELECT * FROM background_tasks WHERE owner_session_id = ? ORDER BY created_at DESC, id DESC`)
    .all(owner);
  return rows.map(rowToTask);
}

/** Owner-scoped compensation for a background task create that failed ambiguously. */
export function deleteBackgroundTask(id: string, controlOwnerSessionId: string): boolean {
  const owner = requireOwnerSessionId(controlOwnerSessionId);
  const storage = getStorage();
  const result = storage.sqlite
    .prepare(`DELETE FROM background_tasks WHERE id = ? AND owner_session_id = ?`)
    .run(id, owner);
  return result.changes > 0;
}

// ---------------------------------------------------------------------------
// Startup recovery
// ---------------------------------------------------------------------------

export function recoverInterruptedBackgroundTasks(): BackgroundTask[] {
  const storage = getStorage();
  const now = new Date().toISOString();

  return withImmediateTransaction(storage, () => {
    const candidates = storage.sqlite
      .prepare<BackgroundTaskRow>(
        `SELECT * FROM background_tasks
         WHERE status IS NULL
            OR status IN ('running', 'pending', 'stopping')
            OR status NOT IN ('completed', 'failed', 'stopped', 'interrupted')
         ORDER BY created_at ASC, id ASC`,
      )
      .all();

    const update = storage.sqlite.prepare(
      `UPDATE background_tasks
       SET status = 'interrupted',
           completed_at = COALESCE(completed_at, ?),
           terminal_reason = 'startup-recovery',
           terminal_meta_json = ?
       WHERE id = ?
         AND (
           status IS NULL
           OR status IN ('running', 'pending', 'stopping')
           OR status NOT IN ('completed', 'failed', 'stopped', 'interrupted')
         )`,
    );

    const recovered: BackgroundTask[] = [];
    for (const row of candidates) {
      const terminalMetaJson = makeTerminalMetaJson(row.status, "startup-recovery");
      const result = update.run(now, terminalMetaJson, row.id);
      if (result.changes === 0) continue;

      recovered.push(
        rowToTask({
          ...row,
          status: "interrupted",
          completed_at: row.completed_at ?? now,
          terminal_reason: "startup-recovery",
          terminal_meta_json: terminalMetaJson,
        }),
      );
    }

    return recovered;
  });
}

/**
 * Compatibility export for existing startup callers.
 * Delegates to the owner-safe recovery API and returns the number of rows changed.
 */
export function markInterruptedTasks(): number {
  return recoverInterruptedBackgroundTasks().length;
}
