import type { StorageDatabase } from "../db.js";
import { StorageError } from "./session-repo.js";

export type StoredSessionMessageRole = "user" | "assistant" | "system";

export interface StoredSessionMessage {
  sessionId: string;
  seq: number;
  id: string;
  role: StoredSessionMessageRole;
  content: string;
  timestamp: Date;
  metadataJson: string;
}

export interface StoredSessionMessageInput {
  seq?: number;
  id: string;
  role: StoredSessionMessageRole;
  content: string;
  timestamp: Date;
  metadataJson: string;
}

export interface StoredSessionMessageCursor {
  lastSeq: number;
  availableFromSeq: number;
  ackedSeq: number;
  recoveryJson: string;
}

export interface SessionMessageRepositoryAppendAttemptContext {
  attempt: number;
  storage: StorageDatabase;
  sessionId: string;
}

export interface SessionMessageRepositoryAppendAttemptControl {
  cursorOverride?: Pick<StoredSessionMessageCursor, "lastSeq" | "availableFromSeq"> & Partial<StoredSessionMessageCursor>;
}

export interface CreateSessionMessageRepositoryOptions {
  beforeAppendAttempt?: (
    context: SessionMessageRepositoryAppendAttemptContext,
  ) => SessionMessageRepositoryAppendAttemptControl | void;
}

interface MessageRow {
  session_id: string;
  seq: number;
  id: string;
  role: StoredSessionMessageRole;
  content: string;
  timestamp: number;
  metadata_json: string;
}

interface CursorRangeRow {
  last_seq: number | null;
  available_from_seq: number | null;
}

interface CursorStateRow {
  acked_seq: number | null;
  recovery_json: string | null;
}

function toStoredMessage(row: MessageRow): StoredSessionMessage {
  return {
    sessionId: row.session_id,
    seq: row.seq,
    id: row.id,
    role: row.role,
    content: row.content,
    timestamp: new Date(row.timestamp),
    metadataJson: row.metadata_json,
  };
}

function sanitizeSeq(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function clampAckedSeq(ackedSeq: unknown, lastSeq: number): number {
  return Math.max(0, Math.min(sanitizeSeq(ackedSeq), Math.max(0, Math.floor(lastSeq))));
}

function normalizeRecoveryJson(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  return "{}";
}

function isRetryableAppendConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error ? String((error as { code?: unknown }).code) : "";
  const message = "message" in error ? String((error as { message?: unknown }).message) : "";
  return code === "SQLITE_CONSTRAINT_PRIMARYKEY"
    || code === "SQLITE_BUSY_SNAPSHOT"
    || /UNIQUE constraint failed: session_message\.session_id, session_message\.seq/u.test(message);
}

export function createSessionMessageRepository(
  storage: StorageDatabase,
  options: CreateSessionMessageRepositoryOptions = {},
) {
  const insertMessage = storage.sqlite.prepare(`
    INSERT INTO "session_message" (
      "session_id", "seq", "id", "role", "content", "timestamp", "metadata_json"
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const deleteMessages = storage.sqlite.prepare(`DELETE FROM "session_message" WHERE "session_id" = ?`);
  const updateSessionStats = storage.sqlite.prepare(`
    UPDATE "session"
    SET "message_count" = ?, "updated_at" = ?
    WHERE "id" = ? AND "deleted_at" IS NULL
  `);
  const upsertCursor = storage.sqlite.prepare(`
    INSERT INTO "session_message_cursor" (
      "session_id", "last_seq", "available_from_seq", "acked_seq", "recovery_json", "updated_at"
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT("session_id") DO UPDATE SET
      "last_seq" = excluded."last_seq",
      "available_from_seq" = excluded."available_from_seq",
      "acked_seq" = excluded."acked_seq",
      "recovery_json" = excluded."recovery_json",
      "updated_at" = excluded."updated_at"
  `);
  const updateCursorRecovery = storage.sqlite.prepare(`
    UPDATE "session_message_cursor"
    SET "acked_seq" = ?, "recovery_json" = ?, "updated_at" = ?
    WHERE "session_id" = ?
  `);

  function getCurrentCursor(sessionId: string): StoredSessionMessageCursor {
    const range = storage.sqlite.prepare(`
      SELECT MAX("seq") AS "last_seq", MIN("seq") AS "available_from_seq"
      FROM "session_message"
      WHERE "session_id" = ?
    `).get(sessionId) as CursorRangeRow | undefined;
    const state = storage.sqlite.prepare(`
      SELECT "acked_seq", "recovery_json"
      FROM "session_message_cursor"
      WHERE "session_id" = ?
    `).get(sessionId) as CursorStateRow | undefined;
    const lastSeq = range?.last_seq ?? 0;
    return {
      lastSeq,
      availableFromSeq: range?.available_from_seq ?? 0,
      ackedSeq: clampAckedSeq(state?.acked_seq ?? 0, lastSeq),
      recoveryJson: normalizeRecoveryJson(state?.recovery_json),
    };
  }

  function refreshCursorAndSession(
    sessionId: string,
    updatedAt = new Date(),
    options: { resetAckedSeq?: boolean; recoveryJson?: string } = {},
  ): StoredSessionMessageCursor {
    const cursor = getCurrentCursor(sessionId);
    const ackedSeq = options.resetAckedSeq ? 0 : clampAckedSeq(cursor.ackedSeq, cursor.lastSeq);
    const recoveryJson = normalizeRecoveryJson(options.recoveryJson ?? cursor.recoveryJson);
    upsertCursor.run(sessionId, cursor.lastSeq, cursor.availableFromSeq, ackedSeq, recoveryJson, updatedAt.getTime());
    updateSessionStats.run(cursor.lastSeq, updatedAt.getTime(), sessionId);
    return { ...cursor, ackedSeq, recoveryJson };
  }

  function insertMessagesStartingAt(sessionId: string, startSeq: number, messages: StoredSessionMessageInput[]): void {
    let nextSeq = startSeq;
    for (const message of messages) {
      const candidateSeq = sanitizeSeq(message.seq);
      const seq = candidateSeq >= nextSeq ? candidateSeq : nextSeq;
      insertMessage.run(
        sessionId,
        seq,
        message.id,
        message.role,
        message.content,
        message.timestamp.getTime(),
        message.metadataJson,
      );
      nextSeq = seq + 1;
    }
  }

  const appendTransaction = storage.sqlite.transaction((
    sessionId: string,
    messages: StoredSessionMessageInput[],
    seedMessages: StoredSessionMessageInput[],
    cursorOverride?: SessionMessageRepositoryAppendAttemptControl["cursorOverride"],
  ) => {
    const existingCursor = cursorOverride ?? getCurrentCursor(sessionId);
    if (existingCursor.lastSeq === 0 && seedMessages.length > 0) {
      insertMessagesStartingAt(sessionId, 1, seedMessages);
    }
    const afterSeedCursor = cursorOverride ?? getCurrentCursor(sessionId);
    insertMessagesStartingAt(sessionId, afterSeedCursor.lastSeq + 1, messages);
    refreshCursorAndSession(sessionId);
  });

  const replaceTransaction = storage.sqlite.transaction((sessionId: string, messages: StoredSessionMessageInput[]) => {
    deleteMessages.run(sessionId);
    insertMessagesStartingAt(sessionId, 1, messages);
    refreshCursorAndSession(sessionId, new Date(), { resetAckedSeq: true });
  });

  const deleteTransaction = storage.sqlite.transaction((sessionId: string) => {
    deleteMessages.run(sessionId);
    refreshCursorAndSession(sessionId, new Date(), { resetAckedSeq: true });
  });

  return {
    async appendMessages(
      sessionId: string,
      messages: StoredSessionMessageInput[],
      seedMessages: StoredSessionMessageInput[] = [],
    ): Promise<StoredSessionMessage[]> {
      let lastError: unknown;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const control = options.beforeAppendAttempt?.({ attempt, storage, sessionId });
          appendTransaction(sessionId, messages, seedMessages, control?.cursorOverride);
          return this.loadAll(sessionId);
        } catch (error) {
          lastError = error;
          if (attempt >= 1 || !isRetryableAppendConflict(error)) {
            break;
          }
        }
      }

      throw new StorageError("Failed to append session messages.", { op: "sessionMessage.appendMessages", sessionId, cause: lastError });
    },

    async loadAll(sessionId: string): Promise<StoredSessionMessage[]> {
      try {
        const rows = storage.sqlite.prepare(`
          SELECT "session_id", "seq", "id", "role", "content", "timestamp", "metadata_json"
          FROM "session_message"
          WHERE "session_id" = ?
          ORDER BY "seq" ASC
        `).all(sessionId) as MessageRow[];
        return rows.map(toStoredMessage);
      } catch (error) {
        throw new StorageError("Failed to load session messages.", { op: "sessionMessage.loadAll", sessionId, cause: error });
      }
    },

    async loadSinceSeq(sessionId: string, sinceSeq: number): Promise<StoredSessionMessage[]> {
      try {
        const rows = storage.sqlite.prepare(`
          SELECT "session_id", "seq", "id", "role", "content", "timestamp", "metadata_json"
          FROM "session_message"
          WHERE "session_id" = ? AND "seq" > ?
          ORDER BY "seq" ASC
        `).all(sessionId, Math.max(0, Math.floor(sinceSeq))) as MessageRow[];
        return rows.map(toStoredMessage);
      } catch (error) {
        throw new StorageError("Failed to load session messages since seq.", { op: "sessionMessage.loadSinceSeq", sessionId, cause: error });
      }
    },

    async loadRecent(sessionId: string, limit = 50): Promise<StoredSessionMessage[]> {
      try {
        const rows = storage.sqlite.prepare(`
          SELECT "session_id", "seq", "id", "role", "content", "timestamp", "metadata_json"
          FROM "session_message"
          WHERE "session_id" = ?
          ORDER BY "seq" DESC
          LIMIT ?
        `).all(sessionId, Math.max(0, Math.floor(limit))) as MessageRow[];
        return rows.map(toStoredMessage).reverse();
      } catch (error) {
        throw new StorageError("Failed to load recent session messages.", { op: "sessionMessage.loadRecent", sessionId, cause: error });
      }
    },

    async replaceAll(sessionId: string, messages: StoredSessionMessageInput[]): Promise<StoredSessionMessage[]> {
      try {
        replaceTransaction(sessionId, messages);
        return this.loadAll(sessionId);
      } catch (error) {
        throw new StorageError("Failed to replace session messages.", { op: "sessionMessage.replaceAll", sessionId, cause: error });
      }
    },

    async deleteAllBySession(sessionId: string): Promise<void> {
      try {
        deleteTransaction(sessionId);
      } catch (error) {
        throw new StorageError("Failed to delete session messages.", { op: "sessionMessage.deleteAllBySession", sessionId, cause: error });
      }
    },

    async updateAckedSeq(sessionId: string, ackedSeq: number, recoveryJson?: string): Promise<StoredSessionMessageCursor> {
      try {
        const cursor = refreshCursorAndSession(sessionId);
        const nextAckedSeq = clampAckedSeq(ackedSeq, cursor.lastSeq);
        const nextRecoveryJson = normalizeRecoveryJson(recoveryJson ?? cursor.recoveryJson);
        updateCursorRecovery.run(nextAckedSeq, nextRecoveryJson, Date.now(), sessionId);
        return { ...cursor, ackedSeq: nextAckedSeq, recoveryJson: nextRecoveryJson };
      } catch (error) {
        throw new StorageError("Failed to update session message ack cursor.", { op: "sessionMessage.updateAckedSeq", sessionId, cause: error });
      }
    },

    async updateRecoveryJson(sessionId: string, recoveryJson: string): Promise<StoredSessionMessageCursor> {
      try {
        const cursor = refreshCursorAndSession(sessionId);
        const nextRecoveryJson = normalizeRecoveryJson(recoveryJson);
        updateCursorRecovery.run(cursor.ackedSeq, nextRecoveryJson, Date.now(), sessionId);
        return { ...cursor, recoveryJson: nextRecoveryJson };
      } catch (error) {
        throw new StorageError("Failed to update session message recovery metadata.", { op: "sessionMessage.updateRecoveryJson", sessionId, cause: error });
      }
    },

    async getCursor(sessionId: string): Promise<StoredSessionMessageCursor> {
      try {
        return getCurrentCursor(sessionId);
      } catch (error) {
        throw new StorageError("Failed to get session message cursor.", { op: "sessionMessage.getCursor", sessionId, cause: error });
      }
    },
  };
}
