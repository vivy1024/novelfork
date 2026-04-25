CREATE TABLE IF NOT EXISTS "story_jingwei_section" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "book_id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "icon" TEXT,
  "order" INTEGER NOT NULL DEFAULT 0,
  "enabled" INTEGER NOT NULL DEFAULT 1,
  "show_in_sidebar" INTEGER NOT NULL DEFAULT 1,
  "participates_in_ai" INTEGER NOT NULL DEFAULT 1,
  "default_visibility" TEXT NOT NULL DEFAULT 'tracked',
  "fields_json" TEXT NOT NULL DEFAULT '[]',
  "builtin_kind" TEXT,
  "source_template" TEXT,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  "deleted_at" INTEGER,
  FOREIGN KEY ("book_id") REFERENCES "book"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "story_jingwei_section_book_order_idx"
  ON "story_jingwei_section" ("book_id", "order");

CREATE INDEX IF NOT EXISTS "story_jingwei_section_book_enabled_ai_idx"
  ON "story_jingwei_section" ("book_id", "enabled", "participates_in_ai");

CREATE TABLE IF NOT EXISTS "story_jingwei_entry" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "book_id" TEXT NOT NULL,
  "section_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content_md" TEXT NOT NULL DEFAULT '',
  "tags_json" TEXT NOT NULL DEFAULT '[]',
  "aliases_json" TEXT NOT NULL DEFAULT '[]',
  "custom_fields_json" TEXT NOT NULL DEFAULT '{}',
  "related_chapter_numbers_json" TEXT NOT NULL DEFAULT '[]',
  "related_entry_ids_json" TEXT NOT NULL DEFAULT '[]',
  "visibility_rule_json" TEXT NOT NULL DEFAULT '{"type":"tracked"}',
  "participates_in_ai" INTEGER NOT NULL DEFAULT 1,
  "token_budget" INTEGER,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  "deleted_at" INTEGER,
  FOREIGN KEY ("book_id") REFERENCES "book"("id") ON DELETE CASCADE,
  FOREIGN KEY ("section_id") REFERENCES "story_jingwei_section"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "story_jingwei_entry_book_section_updated_idx"
  ON "story_jingwei_entry" ("book_id", "section_id", "updated_at");

CREATE INDEX IF NOT EXISTS "story_jingwei_entry_book_ai_idx"
  ON "story_jingwei_entry" ("book_id", "participates_in_ai");
