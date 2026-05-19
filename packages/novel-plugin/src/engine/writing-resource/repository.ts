import type { StorageDatabase } from "@vivy1024/novelfork-core";
import type {
  CreateWritingResourceInput,
  ListWritingResourcesFilter,
  UpdateWritingResourceInput,
  WritingResource,
  WritingResourceRow,
} from "./types.js";
import { countChineseWords } from "./types.js";

export type WritingResourceRepository = {
  readonly list: (bookId: string, filter?: ListWritingResourcesFilter) => WritingResource[];
  readonly getById: (id: string) => WritingResource | null;
  readonly create: (input: CreateWritingResourceInput) => WritingResource;
  readonly update: (id: string, input: UpdateWritingResourceInput) => WritingResource | null;
  readonly softDelete: (id: string, deletedAt: number) => WritingResource | null;
  readonly getHistory: (id: string) => WritingResource[];
  readonly findAcceptedChapter: (bookId: string, chapterNumber: number) => WritingResource | null;
};

export function createWritingResourceRepository(storage: StorageDatabase): WritingResourceRepository {
  const sqlite = storage.sqlite;

  return {
    list(bookId, filter = {}) {
      const clauses = ["book_id = ?"];
      const params: unknown[] = [bookId];
      if (!filter.includeDeleted) clauses.push("deleted_at IS NULL");
      if (filter.type) { clauses.push("type = ?"); params.push(filter.type); }
      if (filter.status) { clauses.push("status = ?"); params.push(filter.status); }
      if (typeof filter.chapterNumber === "number") { clauses.push("chapter_number = ?"); params.push(filter.chapterNumber); }
      const rows = sqlite.prepare(`SELECT * FROM "writing_resource" WHERE ${clauses.join(" AND ")} ORDER BY COALESCE(chapter_number, 999999), updated_at DESC`).all(...params) as WritingResourceRow[];
      return rows.map(fromRow);
    },

    getById(id) {
      const row = sqlite.prepare(`SELECT * FROM "writing_resource" WHERE id = ?`).get(id) as WritingResourceRow | undefined;
      return row ? fromRow(row) : null;
    },

    create(input) {
      const wordCount = countChineseWords(input.content);
      sqlite.prepare(`INSERT INTO "writing_resource" (
        id, book_id, type, status, title, content, chapter_number, word_count, parent_id, version, source, metadata_json, created_at, updated_at, accepted_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`).run(
        input.id,
        input.bookId,
        input.type,
        input.status,
        input.title,
        input.content,
        input.chapterNumber ?? null,
        wordCount,
        input.parentId ?? null,
        input.version ?? 1,
        input.source ?? null,
        JSON.stringify(input.metadata ?? {}),
        input.createdAt,
        input.updatedAt,
        input.acceptedAt ?? null,
      );
      const created = this.getById(input.id);
      if (!created) throw new Error(`writing_resource create failed: ${input.id}`);
      return created;
    },

    update(id, input) {
      const current = this.getById(id);
      if (!current) return null;
      const next = {
        type: input.type ?? current.type,
        status: input.status ?? current.status,
        title: input.title ?? current.title,
        content: input.content ?? current.content,
        chapterNumber: input.chapterNumber === undefined ? current.chapterNumber : input.chapterNumber,
        wordCount: input.wordCount ?? (input.content !== undefined ? countChineseWords(input.content) : current.wordCount),
        parentId: input.parentId === undefined ? current.parentId : input.parentId,
        version: input.version ?? current.version,
        source: input.source === undefined ? current.source : input.source,
        metadata: input.metadata ?? current.metadata,
        updatedAt: input.updatedAt ?? Date.now(),
        acceptedAt: input.acceptedAt === undefined ? current.acceptedAt : input.acceptedAt,
        deletedAt: input.deletedAt === undefined ? current.deletedAt : input.deletedAt,
      };
      sqlite.prepare(`UPDATE "writing_resource" SET
        type = ?, status = ?, title = ?, content = ?, chapter_number = ?, word_count = ?, parent_id = ?, version = ?, source = ?, metadata_json = ?, updated_at = ?, accepted_at = ?, deleted_at = ?
        WHERE id = ?`).run(
          next.type,
          next.status,
          next.title,
          next.content,
          next.chapterNumber,
          next.wordCount,
          next.parentId,
          next.version,
          next.source,
          JSON.stringify(next.metadata),
          next.updatedAt,
          next.acceptedAt,
          next.deletedAt,
          id,
        );
      return this.getById(id);
    },

    softDelete(id, deletedAt) {
      return this.update(id, { deletedAt, updatedAt: deletedAt });
    },

    getHistory(id) {
      const chain: WritingResource[] = [];
      let current = this.getById(id);
      const seen = new Set<string>();
      while (current && !seen.has(current.id)) {
        chain.push(current);
        seen.add(current.id);
        current = current.parentId ? this.getById(current.parentId) : null;
      }
      return chain;
    },

    findAcceptedChapter(bookId, chapterNumber) {
      const row = sqlite.prepare(`SELECT * FROM "writing_resource" WHERE book_id = ? AND type = 'chapter' AND status = 'accepted' AND chapter_number = ? AND deleted_at IS NULL ORDER BY version DESC LIMIT 1`).get(bookId, chapterNumber) as WritingResourceRow | undefined;
      return row ? fromRow(row) : null;
    },
  };
}

export function fromRow(row: WritingResourceRow): WritingResource {
  return {
    id: row.id,
    bookId: row.book_id,
    type: row.type,
    status: row.status,
    title: row.title,
    content: row.content,
    chapterNumber: row.chapter_number,
    wordCount: row.word_count,
    parentId: row.parent_id,
    version: row.version,
    source: row.source,
    metadata: safeJson(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    acceptedAt: row.accepted_at,
    deletedAt: row.deleted_at,
  };
}

function safeJson(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
