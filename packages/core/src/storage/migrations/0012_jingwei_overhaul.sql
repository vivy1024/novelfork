-- Extend story_jingwei_entry with structured fields for jingwei overhaul
ALTER TABLE "story_jingwei_entry" ADD COLUMN "parent_id" TEXT;
ALTER TABLE "story_jingwei_entry" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'setting';
ALTER TABLE "story_jingwei_entry" ADD COLUMN "fields_json" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "story_jingwei_entry" ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "story_jingwei_entry" ADD COLUMN "lifecycle" TEXT NOT NULL DEFAULT 'active';

-- Relations table
CREATE TABLE IF NOT EXISTS "jingwei_relations" (
  "id" TEXT PRIMARY KEY,
  "book_id" TEXT NOT NULL,
  "source_entry_id" TEXT NOT NULL,
  "target_entry_id" TEXT NOT NULL,
  "relation_type" TEXT NOT NULL,
  "label" TEXT,
  "metadata_json" TEXT DEFAULT '{}',
  "created_at" INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_jingwei_relations_source" ON "jingwei_relations"("source_entry_id");
CREATE INDEX IF NOT EXISTS "idx_jingwei_relations_target" ON "jingwei_relations"("target_entry_id");
CREATE INDEX IF NOT EXISTS "idx_jingwei_relations_book" ON "jingwei_relations"("book_id");

-- Progressions table
CREATE TABLE IF NOT EXISTS "jingwei_progressions" (
  "id" TEXT PRIMARY KEY,
  "entry_id" TEXT NOT NULL,
  "field_key" TEXT NOT NULL,
  "old_value" TEXT,
  "new_value" TEXT NOT NULL,
  "chapter_number" INTEGER,
  "description" TEXT,
  "created_at" INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_jingwei_progressions_entry" ON "jingwei_progressions"("entry_id");

-- Causal chains table
CREATE TABLE IF NOT EXISTS "jingwei_causal_chains" (
  "id" TEXT PRIMARY KEY,
  "book_id" TEXT NOT NULL,
  "trigger_chapter" INTEGER NOT NULL,
  "trigger_event" TEXT NOT NULL,
  "expected_resolution" TEXT,
  "status" TEXT NOT NULL DEFAULT 'open',
  "last_progress_chapter" INTEGER,
  "urgency" TEXT DEFAULT 'low',
  "created_at" INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_jingwei_causal_chains_book" ON "jingwei_causal_chains"("book_id");

-- Volume/Arc summaries
CREATE TABLE IF NOT EXISTS "jingwei_volume_summaries" (
  "id" TEXT PRIMARY KEY,
  "book_id" TEXT NOT NULL,
  "volume_number" INTEGER NOT NULL,
  "summary" TEXT NOT NULL,
  "token_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_jingwei_volume_summaries_book" ON "jingwei_volume_summaries"("book_id");
