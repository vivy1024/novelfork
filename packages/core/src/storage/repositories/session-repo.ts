import type { StorageDatabase } from "../db.js";

export interface StoredSessionRecord {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  messageCount: number;
  configJson: string;
  metadataJson: string;
  deletedAt: Date | null;
}

export interface CreateStoredSessionInput {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  messageCount: number;
  configJson: string;
  metadataJson: string;
}

export interface UpdateStoredSessionInput {
  updatedAt?: Date;
  messageCount?: number;
  configJson?: string;
  metadataJson?: string;
}

interface SessionRow {
  id: string;
  created_at: number;
  updated_at: number;
  message_count: number;
  config_json: string;
  metadata_json: string;
  deleted_at: number | null;
}

export class StorageError extends Error {
  constructor(
    message: string,
    readonly details: { op: string; sessionId?: string; cause?: unknown },
  ) {
    super(message);
    this.name = "StorageError";
  }
}

function toStoredSession(row: SessionRow): StoredSessionRecord {
  return {
    id: row.id,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    messageCount: row.message_count,
    configJson: row.config_json,
    metadataJson: row.metadata_json,
    deletedAt: row.deleted_at === null ? null : new Date(row.deleted_at),
  };
}

export function createSessionRepository(storage: StorageDatabase) {
  const createSession = storage.sqlite.transaction((input: CreateStoredSessionInput) => {
    storage.sqlite.prepare(`
      INSERT INTO "session" (
        "id", "created_at", "updated_at", "message_count", "config_json", "metadata_json", "deleted_at"
      ) VALUES (?, ?, ?, ?, ?, ?, NULL)
    `).run(
      input.id,
      input.createdAt.getTime(),
      input.updatedAt.getTime(),
      input.messageCount,
      input.configJson,
      input.metadataJson,
    );
    storage.sqlite.prepare(`
      INSERT OR IGNORE INTO "session_message_cursor" (
        "session_id", "last_seq", "available_from_seq", "updated_at"
      ) VALUES (?, 0, 0, ?)
    `).run(input.id, input.updatedAt.getTime());
  });

  return {
    async create(input: CreateStoredSessionInput): Promise<StoredSessionRecord> {
      try {
        createSession(input);
        const created = await this.getById(input.id);
        if (!created) {
          throw new Error("Inserted session could not be read back.");
        }
        return created;
      } catch (error) {
        throw new StorageError("Failed to create session.", { op: "session.create", sessionId: input.id, cause: error });
      }
    },

    async getById(id: string): Promise<StoredSessionRecord | null> {
      try {
        const row = storage.sqlite.prepare(`
          SELECT "id", "created_at", "updated_at", "message_count", "config_json", "metadata_json", "deleted_at"
          FROM "session"
          WHERE "id" = ? AND "deleted_at" IS NULL
        `).get(id) as SessionRow | undefined;
        return row ? toStoredSession(row) : null;
      } catch (error) {
        throw new StorageError("Failed to get session.", { op: "session.getById", sessionId: id, cause: error });
      }
    },

    async list(): Promise<StoredSessionRecord[]> {
      try {
        const rows = storage.sqlite.prepare(`
          SELECT "id", "created_at", "updated_at", "message_count", "config_json", "metadata_json", "deleted_at"
          FROM "session"
          WHERE "deleted_at" IS NULL
          ORDER BY "updated_at" DESC
        `).all() as SessionRow[];
        return rows.map(toStoredSession);
      } catch (error) {
        throw new StorageError("Failed to list sessions.", { op: "session.list", cause: error });
      }
    },

    async update(id: string, updates: UpdateStoredSessionInput): Promise<StoredSessionRecord | null> {
      try {
        const current = await this.getById(id);
        if (!current) return null;

        storage.sqlite.prepare(`
          UPDATE "session"
          SET "updated_at" = ?, "message_count" = ?, "config_json" = ?, "metadata_json" = ?
          WHERE "id" = ? AND "deleted_at" IS NULL
        `).run(
          (updates.updatedAt ?? current.updatedAt).getTime(),
          updates.messageCount ?? current.messageCount,
          updates.configJson ?? current.configJson,
          updates.metadataJson ?? current.metadataJson,
          id,
        );
        return this.getById(id);
      } catch (error) {
        throw new StorageError("Failed to update session.", { op: "session.update", sessionId: id, cause: error });
      }
    },

    async softDelete(id: string, deletedAt = new Date()): Promise<boolean> {
      try {
        const result = storage.sqlite.prepare(`
          UPDATE "session"
          SET "deleted_at" = ?, "updated_at" = ?
          WHERE "id" = ? AND "deleted_at" IS NULL
        `).run(deletedAt.getTime(), deletedAt.getTime(), id);
        return result.changes > 0;
      } catch (error) {
        throw new StorageError("Failed to delete session.", { op: "session.softDelete", sessionId: id, cause: error });
      }
    },
  };
}
