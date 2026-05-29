/**
 * Turn checkpoint persistence for interrupt recovery.
 * Saves turn state after each tool execution so interrupted turns can be recovered.
 */

import type { StorageDatabase } from "@vivy1024/novelfork-core";

import { getSessionStorageDatabase } from "./session-storage.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolExecutionRecord {
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
  output: string;
  status: "success" | "error";
}

export interface TurnCheckpoint {
  id: string;
  sessionId: string;
  turnId: string;
  step: number;
  completedToolResults: ToolExecutionRecord[];
  lastAssistantContent?: string;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Schema migration (lazy, idempotent)
// ---------------------------------------------------------------------------

const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS turn_checkpoints (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  step INTEGER NOT NULL DEFAULT 0,
  completed_tool_results_json TEXT NOT NULL DEFAULT '[]',
  last_assistant_content TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(session_id, turn_id)
);
CREATE INDEX IF NOT EXISTS idx_turn_checkpoints_session ON turn_checkpoints(session_id);
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

interface TurnCheckpointRow {
  id: string;
  session_id: string;
  turn_id: string;
  step: number;
  completed_tool_results_json: string;
  last_assistant_content: string | null;
  created_at: number;
}

function rowToCheckpoint(row: TurnCheckpointRow): TurnCheckpoint {
  let completedToolResults: ToolExecutionRecord[] = [];
  try {
    completedToolResults = JSON.parse(row.completed_tool_results_json);
  } catch {
    completedToolResults = [];
  }

  return {
    id: row.id,
    sessionId: row.session_id,
    turnId: row.turn_id,
    step: row.step,
    completedToolResults,
    lastAssistantContent: row.last_assistant_content ?? undefined,
    createdAt: row.created_at,
  };
}

/**
 * Deterministic checkpoint ID from session + turn.
 * Ensures upsert semantics via the UNIQUE constraint.
 */
function makeCheckpointId(sessionId: string, turnId: string): string {
  return `cp:${sessionId}:${turnId}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Save or update a turn checkpoint (synchronous, fire-and-forget safe).
 * Uses INSERT OR REPLACE to upsert by (session_id, turn_id).
 */
export function saveTurnCheckpoint(checkpoint: Omit<TurnCheckpoint, "id">): void {
  const storage = getStorage();
  const id = makeCheckpointId(checkpoint.sessionId, checkpoint.turnId);
  const toolResultsJson = JSON.stringify(checkpoint.completedToolResults);

  storage.sqlite
    .prepare(
      `INSERT OR REPLACE INTO turn_checkpoints (id, session_id, turn_id, step, completed_tool_results_json, last_assistant_content, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      checkpoint.sessionId,
      checkpoint.turnId,
      checkpoint.step,
      toolResultsJson,
      checkpoint.lastAssistantContent ?? null,
      checkpoint.createdAt,
    );
}

/**
 * Get all unfinished checkpoints (for recovery on startup).
 */
export function getUnfinishedCheckpoints(): TurnCheckpoint[] {
  const storage = getStorage();
  const rows = storage.sqlite
    .prepare<TurnCheckpointRow>(`SELECT * FROM turn_checkpoints ORDER BY created_at ASC`)
    .all();
  return rows.map(rowToCheckpoint);
}

/**
 * Get a single checkpoint by session and turn.
 */
export function getTurnCheckpoint(sessionId: string, turnId: string): TurnCheckpoint | null {
  const storage = getStorage();
  const id = makeCheckpointId(sessionId, turnId);
  const row = storage.sqlite
    .prepare<TurnCheckpointRow>(`SELECT * FROM turn_checkpoints WHERE id = ?`)
    .get(id);
  return row ? rowToCheckpoint(row) : null;
}

/**
 * Clear checkpoint after turn completes successfully.
 */
export function clearTurnCheckpoint(sessionId: string, turnId: string): void {
  const storage = getStorage();
  const id = makeCheckpointId(sessionId, turnId);
  storage.sqlite
    .prepare(`DELETE FROM turn_checkpoints WHERE id = ?`)
    .run(id);
}

/**
 * Clear all checkpoints for a session (e.g. when session is deleted).
 */
export function clearSessionCheckpoints(sessionId: string): void {
  const storage = getStorage();
  storage.sqlite
    .prepare(`DELETE FROM turn_checkpoints WHERE session_id = ?`)
    .run(sessionId);
}

/**
 * Count existing checkpoints (useful for diagnostics).
 */
export function countCheckpoints(): number {
  const storage = getStorage();
  const row = storage.sqlite
    .prepare<{ count: number }>(`SELECT COUNT(*) as count FROM turn_checkpoints`)
    .get();
  return row?.count ?? 0;
}
