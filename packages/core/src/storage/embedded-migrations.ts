// Auto-generated embedded migrations for compiled binary.
// When the migrations directory is not available on disk (e.g. bun compile exe),
// the runner falls back to these embedded SQL strings.

export const embeddedMigrations: ReadonlyArray<{ readonly name: string; readonly sql: string }> = [
  { name: "0001_initial.sql", sql: `CREATE TABLE IF NOT EXISTS "session" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  "message_count" INTEGER NOT NULL DEFAULT 0,
  "config_json" TEXT NOT NULL DEFAULT '{}',
  "metadata_json" TEXT NOT NULL DEFAULT '{}',
  "deleted_at" INTEGER
);

CREATE TABLE IF NOT EXISTS "session_message" (
  "session_id" TEXT NOT NULL,
  "seq" INTEGER NOT NULL,
  "id" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "timestamp" INTEGER NOT NULL,
  "metadata_json" TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY ("session_id", "seq"),
  FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "session_message_session_id_id_idx"
  ON "session_message" ("session_id", "id");

CREATE INDEX IF NOT EXISTS "session_message_session_id_seq_desc_idx"
  ON "session_message" ("session_id", "seq");

CREATE TABLE IF NOT EXISTS "session_message_cursor" (
  "session_id" TEXT PRIMARY KEY NOT NULL,
  "last_seq" INTEGER NOT NULL DEFAULT 0,
  "available_from_seq" INTEGER NOT NULL DEFAULT 0,
  "updated_at" INTEGER NOT NULL,
  FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "kv_store" (
  "key" TEXT PRIMARY KEY NOT NULL,
  "value" TEXT NOT NULL,
  "updated_at" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS "drizzle_migrations" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "hash" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL UNIQUE,
  "created_at" INTEGER NOT NULL
);
` },
  { name: "0002_bible_v1.sql", sql: `CREATE TABLE IF NOT EXISTS "book" (
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
` },
  { name: "0003_bible_phaseB.sql", sql: `CREATE TABLE IF NOT EXISTS "bible_conflict" (
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
` },
  { name: "0004_bible_phaseC.sql", sql: `CREATE TABLE IF NOT EXISTS "questionnaire_template" (
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
` },
  { name: "0005_filter_v1.sql", sql: `CREATE TABLE IF NOT EXISTS "filter_report" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "book_id" TEXT NOT NULL,
  "chapter_number" INTEGER NOT NULL,
  "ai_taste_score" INTEGER NOT NULL,
  "level" TEXT NOT NULL,
  "hit_counts_json" TEXT NOT NULL,
  "zhuque_score" INTEGER,
  "zhuque_status" TEXT,
  "details" TEXT NOT NULL,
  "engine_version" TEXT NOT NULL,
  "scanned_at" INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS "filter_report_by_chapter_idx"
  ON "filter_report" ("book_id", "chapter_number", "scanned_at");
` },
  { name: "0006_story_jingwei.sql", sql: `CREATE TABLE IF NOT EXISTS "story_jingwei_section" (
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
` },
  { name: "0007_session_recovery.sql", sql: `ALTER TABLE "session_message_cursor" ADD COLUMN "acked_seq" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "session_message_cursor" ADD COLUMN "recovery_json" TEXT NOT NULL DEFAULT '{}';

UPDATE "session_message_cursor"
SET "acked_seq" = CASE
  WHEN "acked_seq" > "last_seq" THEN "last_seq"
  WHEN "acked_seq" < 0 THEN 0
  ELSE "acked_seq"
END,
"recovery_json" = COALESCE(NULLIF("recovery_json", ''), '{}');
` },
  { name: "0008_writing_log.sql", sql: `CREATE TABLE IF NOT EXISTS "writing_log" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "book_id" TEXT NOT NULL REFERENCES "book"("id") ON DELETE CASCADE,
  "chapter_number" INTEGER NOT NULL,
  "word_count" INTEGER NOT NULL,
  "completed_at" TEXT NOT NULL,
  "date" TEXT NOT NULL
);

CREATE INDEX "writing_log_book_date_idx" ON "writing_log" ("book_id", "date");
CREATE INDEX "writing_log_date_idx" ON "writing_log" ("date");
` },
  { name: "0009_chapter_audit_log.sql", sql: `CREATE TABLE IF NOT EXISTS "chapter_audit_log" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "book_id" TEXT NOT NULL REFERENCES "book"("id") ON DELETE CASCADE,
  "chapter_number" INTEGER NOT NULL,
  "audited_at" TEXT NOT NULL,
  "continuity_passed" INTEGER NOT NULL DEFAULT 1,
  "continuity_issue_count" INTEGER NOT NULL DEFAULT 0,
  "ai_taste_score" REAL NOT NULL DEFAULT 0,
  "hook_health_issues" INTEGER NOT NULL DEFAULT 0,
  "long_span_fatigue_issues" INTEGER NOT NULL DEFAULT 0,
  "sensitive_word_count" INTEGER NOT NULL DEFAULT 0,
  "rhythm_diversity_score" REAL NOT NULL DEFAULT 0,
  "summary" TEXT NOT NULL DEFAULT ''
);

CREATE INDEX "chapter_audit_log_book_chapter_idx" ON "chapter_audit_log" ("book_id", "chapter_number");
CREATE INDEX "chapter_audit_log_book_audited_idx" ON "chapter_audit_log" ("book_id", "audited_at");
` },
  { name: "0010_user_template.sql", sql: `-- User templates for template market
CREATE TABLE IF NOT EXISTS "user_template" (
  "id" TEXT PRIMARY KEY,
  "book_id" TEXT,
  "name" TEXT NOT NULL,
  "genre" TEXT,
  "description" TEXT,
  "bundle_json" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "deleted_at" TEXT
);

CREATE INDEX IF NOT EXISTS "user_template_book_id_idx" ON "user_template" ("book_id");
` },
  { name: "0011_session_fork.sql", sql: `-- Add fork tracking columns to session table
ALTER TABLE "session" ADD COLUMN "parent_session_id" TEXT;
ALTER TABLE "session" ADD COLUMN "fork_mode" TEXT;
` },
  { name: "0012_jingwei_overhaul.sql", sql: `-- Extend story_jingwei_entry with structured fields for jingwei overhaul
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
  "book_id" TEXT NOT NULL,
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
` },
  { name: "0013_jingwei_cooccurrence.sql", sql: `CREATE TABLE IF NOT EXISTS jingwei_cooccurrence (
  book_id TEXT NOT NULL,
  tag_a TEXT NOT NULL,
  tag_b TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  last_chapter INTEGER,
  PRIMARY KEY (book_id, tag_a, tag_b)
);
CREATE INDEX IF NOT EXISTS idx_jingwei_cooccurrence_a ON jingwei_cooccurrence(book_id, tag_a);
CREATE INDEX IF NOT EXISTS idx_jingwei_cooccurrence_b ON jingwei_cooccurrence(book_id, tag_b);
` },
  { name: "0014_bible_to_jingwei_migration.sql", sql: `-- Migration: Bible v1 → Jingwei unified table
-- Creates a placeholder section per book for migrated entries, then copies data.
-- Idempotent: uses INSERT OR IGNORE throughout.
-- Safe for fresh installs: each SELECT guards against missing bible tables via sqlite_master check.

-- Step 1: Create a migration-placeholder section for each book that has bible data
INSERT OR IGNORE INTO story_jingwei_section (id, book_id, key, name, description, icon, "order", enabled, show_in_sidebar, participates_in_ai, default_visibility, fields_json, builtin_kind, source_template, created_at, updated_at, deleted_at)
SELECT DISTINCT
  'migrated-section-' || book_id,
  book_id,
  '__bible_migrated__',
  '圣经迁移数据',
  '从 novel-bible-v1 自动迁移的条目',
  'book',
  999,
  1,
  1,
  1,
  'tracked',
  '[]',
  NULL,
  NULL,
  strftime('%s', 'now') * 1000,
  strftime('%s', 'now') * 1000,
  NULL
FROM bible_character WHERE EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='bible_character')
AND deleted_at IS NULL
UNION
SELECT DISTINCT
  'migrated-section-' || book_id,
  book_id,
  '__bible_migrated__',
  '圣经迁移数据',
  '从 novel-bible-v1 自动迁移的条目',
  'book',
  999,
  1,
  1,
  1,
  'tracked',
  '[]',
  NULL,
  NULL,
  strftime('%s', 'now') * 1000,
  strftime('%s', 'now') * 1000,
  NULL
FROM bible_event WHERE EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='bible_event')
AND deleted_at IS NULL
UNION
SELECT DISTINCT
  'migrated-section-' || book_id,
  book_id,
  '__bible_migrated__',
  '圣经迁移数据',
  '从 novel-bible-v1 自动迁移的条目',
  'book',
  999,
  1,
  1,
  1,
  'tracked',
  '[]',
  NULL,
  NULL,
  strftime('%s', 'now') * 1000,
  strftime('%s', 'now') * 1000,
  NULL
FROM bible_setting WHERE EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='bible_setting')
AND deleted_at IS NULL
UNION
SELECT DISTINCT
  'migrated-section-' || book_id,
  book_id,
  '__bible_migrated__',
  '圣经迁移数据',
  '从 novel-bible-v1 自动迁移的条目',
  'book',
  999,
  1,
  1,
  1,
  'tracked',
  '[]',
  NULL,
  NULL,
  strftime('%s', 'now') * 1000,
  strftime('%s', 'now') * 1000,
  NULL
FROM bible_chapter_summary WHERE EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='bible_chapter_summary')
AND deleted_at IS NULL;

-- Step 2: Migrate bible_character → story_jingwei_entry (category='character')
INSERT OR IGNORE INTO story_jingwei_entry (
  id, book_id, section_id, title, content_md, tags_json, aliases_json,
  custom_fields_json, related_chapter_numbers_json, related_entry_ids_json,
  visibility_rule_json, participates_in_ai, token_budget,
  parent_id, category, fields_json, sort_order, lifecycle,
  created_at, updated_at, deleted_at
)
SELECT
  'migrated-char-' || id,
  book_id,
  'migrated-section-' || book_id,
  name,
  summary,
  '[]',
  COALESCE(aliases_json, '[]'),
  '{}',
  '[]',
  '[]',
  COALESCE(visibility_rule_json, '{"type":"tracked"}'),
  1,
  NULL,
  NULL,
  'character',
  json_object(
    'name', name,
    'roleType', role_type,
    'aliases', json(aliases_json),
    'traits', json(traits_json)
  ),
  0,
  'active',
  created_at,
  updated_at,
  NULL
FROM bible_character WHERE EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='bible_character')
AND deleted_at IS NULL;

-- Step 3: Migrate bible_event → story_jingwei_entry (category='event')
INSERT OR IGNORE INTO story_jingwei_entry (
  id, book_id, section_id, title, content_md, tags_json, aliases_json,
  custom_fields_json, related_chapter_numbers_json, related_entry_ids_json,
  visibility_rule_json, participates_in_ai, token_budget,
  parent_id, category, fields_json, sort_order, lifecycle,
  created_at, updated_at, deleted_at
)
SELECT
  'migrated-evt-' || id,
  book_id,
  'migrated-section-' || book_id,
  name,
  summary,
  '[]',
  '[]',
  '{}',
  '[]',
  COALESCE(related_character_ids_json, '[]'),
  COALESCE(visibility_rule_json, '{"type":"tracked"}'),
  1,
  NULL,
  NULL,
  'event',
  json_object(
    'eventType', event_type,
    'chapterStart', chapter_start,
    'chapterEnd', chapter_end,
    'foreshadowState', foreshadow_state,
    'relatedCharacters', json(COALESCE(related_character_ids_json, '[]'))
  ),
  0,
  'active',
  created_at,
  updated_at,
  NULL
FROM bible_event WHERE EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='bible_event')
AND deleted_at IS NULL;

-- Step 4: Migrate bible_setting → story_jingwei_entry (category mapped from setting category)
INSERT OR IGNORE INTO story_jingwei_entry (
  id, book_id, section_id, title, content_md, tags_json, aliases_json,
  custom_fields_json, related_chapter_numbers_json, related_entry_ids_json,
  visibility_rule_json, participates_in_ai, token_budget,
  parent_id, category, fields_json, sort_order, lifecycle,
  created_at, updated_at, deleted_at
)
SELECT
  'migrated-set-' || id,
  book_id,
  'migrated-section-' || book_id,
  name,
  content,
  '[]',
  '[]',
  '{}',
  '[]',
  COALESCE(nested_refs_json, '[]'),
  COALESCE(visibility_rule_json, '{"type":"global"}'),
  1,
  NULL,
  NULL,
  CASE category
    WHEN 'worldview' THEN 'worldview'
    WHEN 'power-system' THEN 'power-system'
    WHEN 'map' THEN 'geography'
    WHEN 'faction' THEN 'faction'
    WHEN 'golden-finger' THEN 'special'
    WHEN 'background' THEN 'worldview'
    ELSE 'special'
  END,
  json_object(
    'name', name,
    'description', content,
    'nestedRefs', json(COALESCE(nested_refs_json, '[]'))
  ),
  0,
  'active',
  created_at,
  updated_at,
  NULL
FROM bible_setting WHERE EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='bible_setting')
AND deleted_at IS NULL;

-- Step 5: Migrate bible_chapter_summary → story_jingwei_entry (category='chapter-summary')
INSERT OR IGNORE INTO story_jingwei_entry (
  id, book_id, section_id, title, content_md, tags_json, aliases_json,
  custom_fields_json, related_chapter_numbers_json, related_entry_ids_json,
  visibility_rule_json, participates_in_ai, token_budget,
  parent_id, category, fields_json, sort_order, lifecycle,
  created_at, updated_at, deleted_at
)
SELECT
  'migrated-cs-' || id,
  book_id,
  'migrated-section-' || book_id,
  COALESCE(NULLIF(title, ''), '第' || chapter_number || '章'),
  summary,
  '[]',
  '[]',
  '{}',
  json_array(chapter_number),
  '[]',
  '{"type":"global"}',
  1,
  NULL,
  NULL,
  'chapter-summary',
  json_object(
    'chapterNumber', chapter_number,
    'wordCount', word_count,
    'pov', pov,
    'keyEvents', json(COALESCE(key_events_json, '[]'))
  ),
  chapter_number,
  'active',
  created_at,
  updated_at,
  NULL
FROM bible_chapter_summary WHERE EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='bible_chapter_summary')
AND deleted_at IS NULL;
` },
  { name: "0015_request_log.sql", sql: `-- Migration: Request log persistence
-- Stores all AI/API request logs in SQLite for cross-restart persistence.

CREATE TABLE IF NOT EXISTS "request_log" (
  "id" TEXT PRIMARY KEY,
  "timestamp" TEXT NOT NULL,
  "method" TEXT NOT NULL DEFAULT 'POST',
  "endpoint" TEXT NOT NULL DEFAULT '',
  "status" INTEGER NOT NULL DEFAULT 200,
  "duration" INTEGER NOT NULL DEFAULT 0,
  "user_id" TEXT NOT NULL DEFAULT '',
  "request_kind" TEXT,
  "narrator" TEXT,
  "provider" TEXT,
  "model" TEXT,
  "input_tokens" INTEGER,
  "output_tokens" INTEGER,
  "total_tokens" INTEGER,
  "tokens_estimated" INTEGER DEFAULT 0,
  "tokens_source" TEXT,
  "ttft_ms" INTEGER,
  "cost_usd" REAL,
  "cache_status" TEXT,
  "cache_scope" TEXT,
  "cache_age_ms" INTEGER,
  "details" TEXT,
  "run_id" TEXT,
  "request_domain" TEXT,
  "source" TEXT,
  "ai_status" TEXT,
  "error_summary" TEXT,
  "book_id" TEXT,
  "session_id" TEXT,
  "chapter_number" INTEGER
);

CREATE INDEX IF NOT EXISTS "idx_request_log_timestamp" ON "request_log" ("timestamp" DESC);
CREATE INDEX IF NOT EXISTS "idx_request_log_provider_model" ON "request_log" ("provider", "model");
CREATE INDEX IF NOT EXISTS "idx_request_log_status" ON "request_log" ("status");
` },
  { name: "0016_writing_resource.sql", sql: `-- Migration: Unified writing resource table
-- Replaces file-based chapters/candidates/drafts with a single SQLite table.

CREATE TABLE IF NOT EXISTS "writing_resource" (
  "id" TEXT PRIMARY KEY,
  "book_id" TEXT NOT NULL,
  "type" TEXT NOT NULL CHECK ("type" IN ('chapter', 'candidate', 'draft')),
  "status" TEXT NOT NULL CHECK ("status" IN ('draft', 'candidate', 'accepted', 'rejected', 'archived')),
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL DEFAULT '',
  "chapter_number" INTEGER,
  "word_count" INTEGER NOT NULL DEFAULT 0,
  "parent_id" TEXT REFERENCES "writing_resource"("id"),
  "version" INTEGER NOT NULL DEFAULT 1,
  "source" TEXT,
  "metadata_json" TEXT,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  "accepted_at" INTEGER,
  "deleted_at" INTEGER
);

CREATE INDEX IF NOT EXISTS "idx_wr_book_type" ON "writing_resource" ("book_id", "type", "deleted_at");
CREATE INDEX IF NOT EXISTS "idx_wr_book_chapter" ON "writing_resource" ("book_id", "chapter_number")
  WHERE "type" = 'chapter' AND "status" = 'accepted' AND "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_wr_parent" ON "writing_resource" ("parent_id") WHERE "parent_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_wr_status" ON "writing_resource" ("book_id", "status", "deleted_at");
` },
  { name: "0017_jingwei_priority_tier.sql", sql: `-- Migration: Add priority_tier to story_jingwei_entry for context layering
ALTER TABLE "story_jingwei_entry" ADD COLUMN "priority_tier" TEXT DEFAULT 'auto';
` },
  { name: "0018_agent_runtime_hardening.sql", sql: `-- Migration: Agent runtime hardening
-- Adds turn checkpoint table for interrupt recovery and collapsed flag for segment compaction.

CREATE TABLE IF NOT EXISTS "turn_checkpoints" (
  "id" TEXT PRIMARY KEY,
  "session_id" TEXT NOT NULL,
  "turn_id" TEXT NOT NULL,
  "step" INTEGER NOT NULL DEFAULT 0,
  "completed_tool_results_json" TEXT NOT NULL DEFAULT '[]',
  "last_assistant_content" TEXT,
  "created_at" INTEGER NOT NULL,
  UNIQUE("session_id", "turn_id")
);

CREATE INDEX IF NOT EXISTS "idx_turn_checkpoints_session" ON "turn_checkpoints"("session_id");

ALTER TABLE "session_message" ADD COLUMN "collapsed" INTEGER NOT NULL DEFAULT 0;
` },
  { name: "0019_jingwei_summary_md.sql", sql: `-- Migration: Add summary_md to story_jingwei_entry for indexed Jingwei reading
ALTER TABLE "story_jingwei_entry" ADD COLUMN "summary_md" TEXT;
` },
];
