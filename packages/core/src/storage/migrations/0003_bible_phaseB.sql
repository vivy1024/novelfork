CREATE TABLE IF NOT EXISTS "bible_conflict" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "book_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "scope" TEXT NOT NULL DEFAULT 'arc',
  "priority" INTEGER NOT NULL DEFAULT 3,
  "protagonist_side_json" TEXT NOT NULL DEFAULT '[]',
  "antagonist_side_json" TEXT NOT NULL DEFAULT '[]',
  "stakes" TEXT NOT NULL DEFAULT '',
  "root_cause_json" TEXT NOT NULL DEFAULT '{}',
  "evolution_path_json" TEXT NOT NULL DEFAULT '[]',
  "resolution_state" TEXT NOT NULL DEFAULT 'unborn',
  "resolution_chapter" INTEGER,
  "related_conflict_ids_json" TEXT NOT NULL DEFAULT '[]',
  "visibility_rule_json" TEXT NOT NULL DEFAULT '{"type":"tracked"}',
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  "deleted_at" INTEGER,
  FOREIGN KEY ("book_id") REFERENCES "book"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "bible_conflict_book_status_idx"
  ON "bible_conflict" ("book_id", "resolution_state");

CREATE INDEX IF NOT EXISTS "bible_conflict_book_priority_idx"
  ON "bible_conflict" ("book_id", "priority");

CREATE TABLE IF NOT EXISTS "bible_world_model" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "book_id" TEXT NOT NULL UNIQUE,
  "economy_json" TEXT NOT NULL DEFAULT '{}',
  "society_json" TEXT NOT NULL DEFAULT '{}',
  "geography_json" TEXT NOT NULL DEFAULT '{}',
  "power_system_json" TEXT NOT NULL DEFAULT '{}',
  "culture_json" TEXT NOT NULL DEFAULT '{}',
  "timeline_json" TEXT NOT NULL DEFAULT '{}',
  "updated_at" INTEGER NOT NULL,
  FOREIGN KEY ("book_id") REFERENCES "book"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "bible_world_model_book_id_idx"
  ON "bible_world_model" ("book_id");

CREATE TABLE IF NOT EXISTS "bible_premise" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "book_id" TEXT NOT NULL UNIQUE,
  "logline" TEXT NOT NULL DEFAULT '',
  "theme_json" TEXT NOT NULL DEFAULT '[]',
  "tone" TEXT NOT NULL DEFAULT '',
  "target_readers" TEXT NOT NULL DEFAULT '',
  "unique_hook" TEXT NOT NULL DEFAULT '',
  "genre_tags_json" TEXT NOT NULL DEFAULT '[]',
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  FOREIGN KEY ("book_id") REFERENCES "book"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "bible_premise_book_id_idx"
  ON "bible_premise" ("book_id");

CREATE TABLE IF NOT EXISTS "bible_character_arc" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "book_id" TEXT NOT NULL,
  "character_id" TEXT NOT NULL,
  "arc_type" TEXT NOT NULL,
  "starting_state" TEXT NOT NULL DEFAULT '',
  "ending_state" TEXT NOT NULL DEFAULT '',
  "key_turning_points_json" TEXT NOT NULL DEFAULT '[]',
  "current_position" TEXT NOT NULL DEFAULT '',
  "visibility_rule_json" TEXT NOT NULL DEFAULT '{"type":"global"}',
  "deleted_at" INTEGER,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  FOREIGN KEY ("book_id") REFERENCES "book"("id") ON DELETE CASCADE,
  FOREIGN KEY ("character_id") REFERENCES "bible_character"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "bible_character_arc_book_character_idx"
  ON "bible_character_arc" ("book_id", "character_id");
