import type { StorageDatabase } from "../../storage/db.js";
import type { CreateQuestionnaireTemplateInput, QuestionnaireTemplateRecord, QuestionnaireTier } from "../types.js";

interface QuestionnaireTemplateRow {
  id: string;
  version: string;
  genre_tags_json: string;
  tier: number;
  target_object: string;
  questions_json: string;
  is_builtin: number;
  created_at: number;
}

const selectColumns = `
  "id", "version", "genre_tags_json", "tier", "target_object", "questions_json", "is_builtin", "created_at"
`;

function toTemplate(row: QuestionnaireTemplateRow): QuestionnaireTemplateRecord {
  return {
    id: row.id,
    version: row.version,
    genreTagsJson: row.genre_tags_json,
    tier: row.tier as QuestionnaireTier,
    targetObject: row.target_object as QuestionnaireTemplateRecord["targetObject"],
    questionsJson: row.questions_json,
    isBuiltin: Boolean(row.is_builtin),
    createdAt: new Date(row.created_at),
  };
}

export function createQuestionnaireTemplateRepository(storage: StorageDatabase) {
  return {
    async create(input: CreateQuestionnaireTemplateInput): Promise<QuestionnaireTemplateRecord> {
      storage.sqlite.prepare(`
        INSERT INTO "questionnaire_template" (
          "id", "version", "genre_tags_json", "tier", "target_object", "questions_json", "is_builtin", "created_at"
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.id,
        input.version,
        input.genreTagsJson,
        input.tier,
        input.targetObject,
        input.questionsJson,
        input.isBuiltin ? 1 : 0,
        input.createdAt.getTime(),
      );
      const created = await this.getById(input.id);
      if (!created) throw new Error("Inserted questionnaire template could not be read back.");
      return created;
    },

    async upsertBuiltin(input: CreateQuestionnaireTemplateInput): Promise<{ record: QuestionnaireTemplateRecord; inserted: boolean }> {
      const existing = await this.getById(input.id);
      if (existing?.version === input.version) return { record: existing, inserted: false };

      storage.sqlite.prepare(`
        INSERT INTO "questionnaire_template" (
          "id", "version", "genre_tags_json", "tier", "target_object", "questions_json", "is_builtin", "created_at"
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT("id") DO UPDATE SET
          "version" = excluded."version",
          "genre_tags_json" = excluded."genre_tags_json",
          "tier" = excluded."tier",
          "target_object" = excluded."target_object",
          "questions_json" = excluded."questions_json",
          "is_builtin" = excluded."is_builtin",
          "created_at" = excluded."created_at"
      `).run(
        input.id,
        input.version,
        input.genreTagsJson,
        input.tier,
        input.targetObject,
        input.questionsJson,
        input.isBuiltin ? 1 : 0,
        input.createdAt.getTime(),
      );
      const saved = await this.getById(input.id);
      if (!saved) throw new Error("Upserted questionnaire template could not be read back.");
      return { record: saved, inserted: !existing };
    },

    async getById(id: string): Promise<QuestionnaireTemplateRecord | null> {
      const row = storage.sqlite.prepare(`
        SELECT ${selectColumns}
        FROM "questionnaire_template"
        WHERE "id" = ?
      `).get(id) as QuestionnaireTemplateRow | undefined;
      return row ? toTemplate(row) : null;
    },

    async list(filters: { genre?: string; tier?: QuestionnaireTier } = {}): Promise<QuestionnaireTemplateRecord[]> {
      const rows = storage.sqlite.prepare(`
        SELECT ${selectColumns}
        FROM "questionnaire_template"
        WHERE (? IS NULL OR "tier" = ?)
        ORDER BY "tier" ASC, "target_object" ASC, "id" ASC
      `).all(filters.tier ?? null, filters.tier ?? null) as QuestionnaireTemplateRow[];
      const mapped = rows.map(toTemplate);
      if (!filters.genre) return mapped;
      return mapped.filter((row) => {
        try {
          const tags = JSON.parse(row.genreTagsJson) as string[];
          return tags.includes("通用") || tags.includes(filters.genre!);
        } catch {
          return false;
        }
      });
    },
  };
}
