-- Migration: Bible v1 → Jingwei unified table
-- Creates a placeholder section per book for migrated entries, then copies data.
-- Idempotent: uses INSERT OR IGNORE throughout.

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
FROM bible_character WHERE deleted_at IS NULL
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
FROM bible_event WHERE deleted_at IS NULL
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
FROM bible_setting WHERE deleted_at IS NULL
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
FROM bible_chapter_summary WHERE deleted_at IS NULL;

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
FROM bible_character WHERE deleted_at IS NULL;

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
FROM bible_event WHERE deleted_at IS NULL;

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
FROM bible_setting WHERE deleted_at IS NULL;

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
FROM bible_chapter_summary WHERE deleted_at IS NULL;
