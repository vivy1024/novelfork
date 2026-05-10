import type { StorageDatabase } from "../db.js";
import { StorageError } from "./session-repo.js";

export interface UserTemplateRecord {
  id: string;
  bookId: string | null;
  name: string;
  genre: string | null;
  description: string | null;
  bundleJson: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateUserTemplateInput {
  id: string;
  bookId?: string | null;
  name: string;
  genre?: string | null;
  description?: string | null;
  bundleJson: string;
}

export interface UpdateUserTemplateInput {
  name?: string;
  genre?: string | null;
  description?: string | null;
  bundleJson?: string;
}

export function createUserTemplateRepository(storage: StorageDatabase) {
  return {
    list(bookId?: string): UserTemplateRecord[] {
      try {
        if (bookId) {
          return storage.sqlite
            .prepare<UserTemplateRecord>(
              `SELECT * FROM "user_template" WHERE "deleted_at" IS NULL AND "book_id" = ? ORDER BY "created_at" DESC`,
            )
            .all(bookId);
        }
        return storage.sqlite
          .prepare<UserTemplateRecord>(
            `SELECT * FROM "user_template" WHERE "deleted_at" IS NULL ORDER BY "created_at" DESC`,
          )
          .all();
      } catch (error) {
        throw new StorageError("Failed to list user templates.", { op: "user-template.list", cause: error });
      }
    },

    get(id: string): UserTemplateRecord | undefined {
      try {
        return storage.sqlite
          .prepare<UserTemplateRecord>(
            `SELECT * FROM "user_template" WHERE "id" = ? AND "deleted_at" IS NULL`,
          )
          .get(id);
      } catch (error) {
        throw new StorageError("Failed to get user template.", { op: "user-template.get", cause: error });
      }
    },

    create(input: CreateUserTemplateInput): UserTemplateRecord {
      const now = new Date().toISOString();
      try {
        storage.sqlite
          .prepare(
            `INSERT INTO "user_template" ("id", "book_id", "name", "genre", "description", "bundle_json", "created_at", "updated_at")
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            input.id,
            input.bookId ?? null,
            input.name,
            input.genre ?? null,
            input.description ?? null,
            input.bundleJson,
            now,
            now,
          );
        return {
          id: input.id,
          bookId: input.bookId ?? null,
          name: input.name,
          genre: input.genre ?? null,
          description: input.description ?? null,
          bundleJson: input.bundleJson,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
      } catch (error) {
        throw new StorageError("Failed to create user template.", { op: "user-template.create", cause: error });
      }
    },

    update(id: string, input: UpdateUserTemplateInput): UserTemplateRecord | undefined {
      const now = new Date().toISOString();
      const sets: string[] = [`"updated_at" = ?`];
      const params: unknown[] = [now];

      if (input.name !== undefined) {
        sets.push(`"name" = ?`);
        params.push(input.name);
      }
      if (input.genre !== undefined) {
        sets.push(`"genre" = ?`);
        params.push(input.genre);
      }
      if (input.description !== undefined) {
        sets.push(`"description" = ?`);
        params.push(input.description);
      }
      if (input.bundleJson !== undefined) {
        sets.push(`"bundle_json" = ?`);
        params.push(input.bundleJson);
      }

      params.push(id);

      try {
        const result = storage.sqlite
          .prepare(`UPDATE "user_template" SET ${sets.join(", ")} WHERE "id" = ? AND "deleted_at" IS NULL`)
          .run(...params);
        if (result.changes === 0) return undefined;
        return this.get(id);
      } catch (error) {
        throw new StorageError("Failed to update user template.", { op: "user-template.update", cause: error });
      }
    },

    softDelete(id: string): boolean {
      const now = new Date().toISOString();
      try {
        const result = storage.sqlite
          .prepare(`UPDATE "user_template" SET "deleted_at" = ?, "updated_at" = ? WHERE "id" = ? AND "deleted_at" IS NULL`)
          .run(now, now, id);
        return result.changes > 0;
      } catch (error) {
        throw new StorageError("Failed to soft-delete user template.", { op: "user-template.softDelete", cause: error });
      }
    },
  };
}
