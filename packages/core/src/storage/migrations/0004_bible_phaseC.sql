CREATE TABLE IF NOT EXISTS "questionnaire_template" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "version" TEXT NOT NULL,
  "genre_tags_json" TEXT NOT NULL DEFAULT '[]',
  "tier" INTEGER NOT NULL,
  "target_object" TEXT NOT NULL,
  "questions_json" TEXT NOT NULL,
  "is_builtin" INTEGER NOT NULL DEFAULT 1,
  "created_at" INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "questionnaire_template_id_version_idx"
  ON "questionnaire_template" ("id", "version");

CREATE INDEX IF NOT EXISTS "questionnaire_template_tier_idx"
  ON "questionnaire_template" ("tier");

CREATE TABLE IF NOT EXISTS "questionnaire_response" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "book_id" TEXT NOT NULL,
  "template_id" TEXT NOT NULL,
  "target_object_type" TEXT NOT NULL,
  "target_object_id" TEXT,
  "answers_json" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "answered_via" TEXT NOT NULL DEFAULT 'author',
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  FOREIGN KEY ("book_id") REFERENCES "book"("id") ON DELETE CASCADE,
  FOREIGN KEY ("template_id") REFERENCES "questionnaire_template"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "questionnaire_response_book_template_idx"
  ON "questionnaire_response" ("book_id", "template_id");

CREATE INDEX IF NOT EXISTS "questionnaire_response_book_status_idx"
  ON "questionnaire_response" ("book_id", "status");

CREATE TABLE IF NOT EXISTS "core_shift" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "book_id" TEXT NOT NULL,
  "target_type" TEXT NOT NULL,
  "target_id" TEXT NOT NULL,
  "from_snapshot_json" TEXT NOT NULL,
  "to_snapshot_json" TEXT NOT NULL,
  "triggered_by" TEXT NOT NULL,
  "chapter_at" INTEGER NOT NULL,
  "affected_chapters_json" TEXT NOT NULL DEFAULT '[]',
  "impact_analysis_json" TEXT NOT NULL DEFAULT '{}',
  "status" TEXT NOT NULL DEFAULT 'proposed',
  "created_at" INTEGER NOT NULL,
  "applied_at" INTEGER,
  FOREIGN KEY ("book_id") REFERENCES "book"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "core_shift_book_status_idx"
  ON "core_shift" ("book_id", "status");
