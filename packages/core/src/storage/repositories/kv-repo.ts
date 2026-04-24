import type { StorageDatabase } from "../db.js";
import { StorageError } from "./session-repo.js";

interface KvRow {
  value: string;
}

export function createKvRepository(storage: StorageDatabase) {
  return {
    async get(key: string): Promise<string | null> {
      try {
        const row = storage.sqlite.prepare(`SELECT "value" FROM "kv_store" WHERE "key" = ?`).get(key) as KvRow | undefined;
        return row?.value ?? null;
      } catch (error) {
        throw new StorageError("Failed to get key/value entry.", { op: "kv.get", cause: error });
      }
    },

    async set(key: string, value: string, updatedAt = new Date()): Promise<void> {
      try {
        storage.sqlite.prepare(`
          INSERT INTO "kv_store" ("key", "value", "updated_at")
          VALUES (?, ?, ?)
          ON CONFLICT("key") DO UPDATE SET
            "value" = excluded."value",
            "updated_at" = excluded."updated_at"
        `).run(key, value, updatedAt.getTime());
      } catch (error) {
        throw new StorageError("Failed to set key/value entry.", { op: "kv.set", cause: error });
      }
    },
  };
}
