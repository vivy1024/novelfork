CREATE TABLE IF NOT EXISTS "book" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "name" TEXT NOT NULL,
  "bible_mode" TEXT NOT NULL DEFAULT 'static',
  "current_chapter" INTEGER NOT NULL DEFAULT 0,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS "bible_character" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "book_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "aliases_json" TEXT NOT NULL DEFAULT '[]',
  "role_type" TEXT NOT NULL DEFAULT 'minor',
  "summary" TEXT NOT NULL DEFAULT '',
  "traits_json" TEXT NOT NULL DEFAULT '{}',
  "visibility_rule_json" TEXT NOT NULL DEFAULT '{"type":"global"}',
  "first_chapter" INTEGER,
  "last_chapter" INTEGER,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  "deleted_at" INTEGER,
  FOREIGN KEY ("book_id") REFERENCES "book"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "bible_character_book_id_idx"
  ON "bible_character" ("book_id");

CREATE TABLE IF NOT EXISTS "bible_event" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "book_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "chapter_start" INTEGER,
  "chapter_end" INTEGER,
  "summary" TEXT NOT NULL DEFAULT '',
  "related_character_ids_json" TEXT NOT NULL DEFAULT '[]',
  "visibility_rule_json" TEXT NOT NULL DEFAULT '{"type":"tracked"}',
  "foreshadow_state" TEXT,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  "deleted_at" INTEGER,
  FOREIGN KEY ("book_id") REFERENCES "book"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "bible_event_book_id_idx"
  ON "bible_event" ("book_id");

CREATE TABLE IF NOT EXISTS "bible_setting" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "book_id" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "content" TEXT NOT NULL DEFAULT '',
  "visibility_rule_json" TEXT NOT NULL DEFAULT '{"type":"global"}',
  "nested_refs_json" TEXT NOT NULL DEFAULT '[]',
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  "deleted_at" INTEGER,
  FOREIGN KEY ("book_id") REFERENCES "book"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "bible_setting_book_id_idx"
  ON "bible_setting" ("book_id");

CREATE TABLE IF NOT EXISTS "bible_chapter_summary" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "book_id" TEXT NOT NULL,
  "chapter_number" INTEGER NOT NULL,
  "title" TEXT NOT NULL DEFAULT '',
  "summary" TEXT NOT NULL DEFAULT '',
  "word_count" INTEGER NOT NULL DEFAULT 0,
  "key_events_json" TEXT NOT NULL DEFAULT '[]',
  "appearing_character_ids_json" TEXT NOT NULL DEFAULT '[]',
  "pov" TEXT NOT NULL DEFAULT '',
  "metadata_json" TEXT NOT NULL DEFAULT '{}',
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  "deleted_at" INTEGER,
  FOREIGN KEY ("book_id") REFERENCES "book"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "bible_chapter_summary_book_chapter_idx"
  ON "bible_chapter_summary" ("book_id", "chapter_number");

CREATE INDEX IF NOT EXISTS "bible_chapter_summary_book_id_idx"
  ON "bible_chapter_summary" ("book_id");
