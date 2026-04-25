import type { Database } from "better-sqlite3";
import type { QuestionnaireQuestion, QuestionnaireTargetObject } from "../types.js";

export type QuestionnaireAnswers = Record<string, unknown>;

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === "string") return value.split(/[，,]/u).map((item) => item.trim()).filter(Boolean);
  if (value === undefined || value === null) return [];
  return [String(value)];
}

function transformAnswer(question: QuestionnaireQuestion, answer: unknown): unknown {
  if (answer === undefined || answer === null || answer === "") return undefined;
  if (question.mapping.transform === "join-comma") return parseList(answer).join("，");
  if (question.mapping.transform === "parse-int") return Number.parseInt(String(answer), 10);
  if (question.type === "multi") return parseList(answer).join("，");
  return answer;
}

function shouldApply(question: QuestionnaireQuestion, answers: QuestionnaireAnswers): boolean {
  if (!question.dependsOn) return true;
  return answers[question.dependsOn.questionId] === question.dependsOn.equals;
}

function setPath(target: Record<string, unknown>, path: string[], value: unknown): void {
  let cursor = target;
  for (const segment of path.slice(0, -1)) {
    const next = cursor[segment];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[path[path.length - 1]!] = value;
}

function applyPremiseField(state: Record<string, unknown>, fieldPath: string, value: unknown): void {
  if (["logline", "tone", "targetReaders", "uniqueHook"].includes(fieldPath)) {
    state[fieldPath] = String(value);
    return;
  }
  if (fieldPath === "theme") {
    state.theme = parseList(value);
    return;
  }
  if (fieldPath === "genreTags") {
    state.genreTags = parseList(value);
    return;
  }
  throw new Error(`Unsupported questionnaire mapping field for premise: ${fieldPath}`);
}

function readPremise(sqlite: Database, bookId: string): Record<string, unknown> {
  const row = sqlite.prepare(`
    SELECT "id", "logline", "theme_json", "tone", "target_readers", "unique_hook", "genre_tags_json", "created_at"
    FROM "bible_premise"
    WHERE "book_id" = ?
  `).get(bookId) as { id: string; logline: string; theme_json: string; tone: string; target_readers: string; unique_hook: string; genre_tags_json: string; created_at: number } | undefined;
  return {
    id: row?.id ?? crypto.randomUUID(),
    logline: row?.logline ?? "",
    theme: row ? JSON.parse(row.theme_json) as string[] : [],
    tone: row?.tone ?? "",
    targetReaders: row?.target_readers ?? "",
    uniqueHook: row?.unique_hook ?? "",
    genreTags: row ? JSON.parse(row.genre_tags_json) as string[] : [],
    createdAt: row?.created_at,
  };
}

function writePremise(sqlite: Database, bookId: string, state: Record<string, unknown>, timestamp: Date): string {
  const id = String(state.id ?? crypto.randomUUID());
  const createdAt = typeof state.createdAt === "number" ? state.createdAt : timestamp.getTime();
  sqlite.prepare(`
    INSERT INTO "bible_premise" (
      "id", "book_id", "logline", "theme_json", "tone", "target_readers", "unique_hook",
      "genre_tags_json", "created_at", "updated_at"
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT("book_id") DO UPDATE SET
      "logline" = excluded."logline",
      "theme_json" = excluded."theme_json",
      "tone" = excluded."tone",
      "target_readers" = excluded."target_readers",
      "unique_hook" = excluded."unique_hook",
      "genre_tags_json" = excluded."genre_tags_json",
      "updated_at" = excluded."updated_at"
  `).run(
    id,
    bookId,
    String(state.logline ?? ""),
    JSON.stringify(parseList(state.theme)),
    String(state.tone ?? ""),
    String(state.targetReaders ?? ""),
    String(state.uniqueHook ?? ""),
    JSON.stringify(parseList(state.genreTags)),
    createdAt,
    timestamp.getTime(),
  );
  return id;
}

function applyWorldModelField(state: Record<string, unknown>, fieldPath: string, value: unknown): void {
  const [dimension, ...rest] = fieldPath.split(".");
  if (!dimension || rest.length === 0 || !["economy", "society", "geography", "powerSystem", "culture", "timeline"].includes(dimension)) {
    throw new Error(`Unsupported questionnaire mapping field for world-model: ${fieldPath}`);
  }
  if (!state[dimension] || typeof state[dimension] !== "object") state[dimension] = {};
  setPath(state[dimension] as Record<string, unknown>, rest, value);
}

function readWorldModel(sqlite: Database, bookId: string): Record<string, unknown> {
  const row = sqlite.prepare(`
    SELECT "id", "economy_json", "society_json", "geography_json", "power_system_json", "culture_json", "timeline_json"
    FROM "bible_world_model"
    WHERE "book_id" = ?
  `).get(bookId) as { id: string; economy_json: string; society_json: string; geography_json: string; power_system_json: string; culture_json: string; timeline_json: string } | undefined;
  return {
    id: row?.id ?? crypto.randomUUID(),
    economy: parseJsonObject(row?.economy_json),
    society: parseJsonObject(row?.society_json),
    geography: parseJsonObject(row?.geography_json),
    powerSystem: parseJsonObject(row?.power_system_json),
    culture: parseJsonObject(row?.culture_json),
    timeline: parseJsonObject(row?.timeline_json),
  };
}

function writeWorldModel(sqlite: Database, bookId: string, state: Record<string, unknown>, timestamp: Date): string {
  const id = String(state.id ?? crypto.randomUUID());
  sqlite.prepare(`
    INSERT INTO "bible_world_model" (
      "id", "book_id", "economy_json", "society_json", "geography_json", "power_system_json", "culture_json", "timeline_json", "updated_at"
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT("book_id") DO UPDATE SET
      "economy_json" = excluded."economy_json",
      "society_json" = excluded."society_json",
      "geography_json" = excluded."geography_json",
      "power_system_json" = excluded."power_system_json",
      "culture_json" = excluded."culture_json",
      "timeline_json" = excluded."timeline_json",
      "updated_at" = excluded."updated_at"
  `).run(
    id,
    bookId,
    JSON.stringify(state.economy ?? {}),
    JSON.stringify(state.society ?? {}),
    JSON.stringify(state.geography ?? {}),
    JSON.stringify(state.powerSystem ?? {}),
    JSON.stringify(state.culture ?? {}),
    JSON.stringify(state.timeline ?? {}),
    timestamp.getTime(),
  );
  return id;
}

function insertSimpleTarget(sqlite: Database, table: string, values: Record<string, unknown>, timestamp: Date): string {
  const id = String(values.id ?? crypto.randomUUID());
  if (table === "bible_conflict") {
    sqlite.prepare(`
      INSERT INTO "bible_conflict" (
        "id", "book_id", "name", "type", "scope", "priority", "protagonist_side_json", "antagonist_side_json",
        "stakes", "root_cause_json", "evolution_path_json", "resolution_state", "resolution_chapter",
        "related_conflict_ids_json", "visibility_rule_json", "created_at", "updated_at"
      ) VALUES (?, ?, ?, ?, ?, ?, '[]', '[]', ?, ?, '[]', 'brewing', NULL, '[]', '{"type":"tracked"}', ?, ?)
    `).run(id, values.bookId, String(values.name ?? "未命名矛盾"), String(values.type ?? "external-character"), String(values.scope ?? "arc"), Number(values.priority ?? 3), String(values.stakes ?? ""), JSON.stringify(values.rootCause ?? {}), timestamp.getTime(), timestamp.getTime());
    return id;
  }
  if (table === "bible_character") {
    sqlite.prepare(`
      INSERT INTO "bible_character" (
        "id", "book_id", "name", "aliases_json", "role_type", "summary", "traits_json", "visibility_rule_json", "first_chapter", "last_chapter", "created_at", "updated_at"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, '{"type":"tracked"}', NULL, NULL, ?, ?)
    `).run(id, values.bookId, String(values.name ?? "未命名角色"), JSON.stringify(parseList(values.aliases)), String(values.roleType ?? "minor"), String(values.summary ?? ""), JSON.stringify(values.traits ?? {}), timestamp.getTime(), timestamp.getTime());
    return id;
  }
  if (table === "bible_setting") {
    sqlite.prepare(`
      INSERT INTO "bible_setting" (
        "id", "book_id", "category", "name", "content", "visibility_rule_json", "nested_refs_json", "created_at", "updated_at"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, values.bookId, String(values.category ?? "other"), String(values.name ?? "未命名设定"), String(values.content ?? ""), JSON.stringify(values.visibilityRule ?? { type: "global" }), JSON.stringify(parseList(values.nestedRefs)), timestamp.getTime(), timestamp.getTime());
    return id;
  }
  throw new Error(`Unsupported questionnaire target table: ${table}`);
}

export function applyQuestionnaireMappings(params: {
  sqlite: Database;
  bookId: string;
  targetObject: QuestionnaireTargetObject;
  questions: QuestionnaireQuestion[];
  answers: QuestionnaireAnswers;
  timestamp: Date;
}): string | null {
  const { sqlite, bookId, targetObject, questions, answers, timestamp } = params;
  if (targetObject === "premise") {
    const state = readPremise(sqlite, bookId);
    for (const question of questions) {
      if (!shouldApply(question, answers)) continue;
      const value = transformAnswer(question, answers[question.id]);
      if (value === undefined) continue;
      applyPremiseField(state, question.mapping.fieldPath, value);
    }
    return writePremise(sqlite, bookId, state, timestamp);
  }
  if (targetObject === "world-model") {
    const state = readWorldModel(sqlite, bookId);
    for (const question of questions) {
      if (!shouldApply(question, answers)) continue;
      const value = transformAnswer(question, answers[question.id]);
      if (value === undefined) continue;
      applyWorldModelField(state, question.mapping.fieldPath, value);
    }
    return writeWorldModel(sqlite, bookId, state, timestamp);
  }

  const values: Record<string, unknown> = { bookId };
  for (const question of questions) {
    if (!shouldApply(question, answers)) continue;
    const value = transformAnswer(question, answers[question.id]);
    if (value === undefined) continue;
    setPath(values, question.mapping.fieldPath.split("."), value);
  }
  if (targetObject === "conflict") return insertSimpleTarget(sqlite, "bible_conflict", values, timestamp);
  if (targetObject === "character") return insertSimpleTarget(sqlite, "bible_character", values, timestamp);
  if (targetObject === "setting") return insertSimpleTarget(sqlite, "bible_setting", values, timestamp);
  throw new Error(`Unsupported questionnaire mapping target: ${targetObject}`);
}
