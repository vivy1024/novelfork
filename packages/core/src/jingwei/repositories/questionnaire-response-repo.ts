import type { StorageDatabase } from "../../storage/db.js";
import type { CreateQuestionnaireResponseInput, QuestionnaireResponseRecord, UpdateQuestionnaireResponseInput } from "../types.js";

interface QuestionnaireResponseRow {
  id: string;
  book_id: string;
  template_id: string;
  target_object_type: string;
  target_object_id: string | null;
  answers_json: string;
  status: "draft" | "submitted" | "skipped";
  answered_via: "author" | "ai-assisted";
  created_at: number;
  updated_at: number;
}

const selectColumns = `
  "id", "book_id", "template_id", "target_object_type", "target_object_id", "answers_json",
  "status", "answered_via", "created_at", "updated_at"
`;

function toResponse(row: QuestionnaireResponseRow): QuestionnaireResponseRecord {
  return {
    id: row.id,
    bookId: row.book_id,
    templateId: row.template_id,
    targetObjectType: row.target_object_type as QuestionnaireResponseRecord["targetObjectType"],
    targetObjectId: row.target_object_id,
    answersJson: row.answers_json,
    status: row.status,
    answeredVia: row.answered_via,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export function createQuestionnaireResponseRepository(storage: StorageDatabase) {
  return {
    async create(input: CreateQuestionnaireResponseInput): Promise<QuestionnaireResponseRecord> {
      storage.sqlite.prepare(`
        INSERT INTO "questionnaire_response" (
          "id", "book_id", "template_id", "target_object_type", "target_object_id", "answers_json",
          "status", "answered_via", "created_at", "updated_at"
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.id,
        input.bookId,
        input.templateId,
        input.targetObjectType,
        input.targetObjectId,
        input.answersJson,
        input.status,
        input.answeredVia,
        input.createdAt.getTime(),
        input.updatedAt.getTime(),
      );
      const created = await this.getById(input.bookId, input.id);
      if (!created) throw new Error("Inserted questionnaire response could not be read back.");
      return created;
    },

    async getById(bookId: string, id: string): Promise<QuestionnaireResponseRecord | null> {
      const row = storage.sqlite.prepare(`
        SELECT ${selectColumns}
        FROM "questionnaire_response"
        WHERE "book_id" = ? AND "id" = ?
      `).get(bookId, id) as QuestionnaireResponseRow | undefined;
      return row ? toResponse(row) : null;
    },

    async listByBook(bookId: string): Promise<QuestionnaireResponseRecord[]> {
      const rows = storage.sqlite.prepare(`
        SELECT ${selectColumns}
        FROM "questionnaire_response"
        WHERE "book_id" = ?
        ORDER BY "updated_at" DESC
      `).all(bookId) as QuestionnaireResponseRow[];
      return rows.map(toResponse);
    },

    async update(bookId: string, id: string, updates: UpdateQuestionnaireResponseInput): Promise<QuestionnaireResponseRecord | null> {
      const current = await this.getById(bookId, id);
      if (!current) return null;
      storage.sqlite.prepare(`
        UPDATE "questionnaire_response"
        SET "target_object_type" = ?, "target_object_id" = ?, "answers_json" = ?, "status" = ?,
          "answered_via" = ?, "updated_at" = ?
        WHERE "book_id" = ? AND "id" = ?
      `).run(
        updates.targetObjectType ?? current.targetObjectType,
        updates.targetObjectId === undefined ? current.targetObjectId : updates.targetObjectId,
        updates.answersJson ?? current.answersJson,
        updates.status ?? current.status,
        updates.answeredVia ?? current.answeredVia,
        (updates.updatedAt ?? current.updatedAt).getTime(),
        bookId,
        id,
      );
      return this.getById(bookId, id);
    },
  };
}
