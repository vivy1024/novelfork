-- Consolidate legacy Jingwei custom fields into the authoritative fields_json.
-- Only valid JSON objects are eligible, and existing authoritative values win.
UPDATE "story_jingwei_entry"
SET "fields_json" = "custom_fields_json"
WHERE ("fields_json" IS NULL OR "fields_json" = '' OR "fields_json" = '{}')
  AND "custom_fields_json" IS NOT NULL
  AND "custom_fields_json" <> ''
  AND "custom_fields_json" <> '{}'
  AND json_valid("custom_fields_json") = 1
  AND json_type("custom_fields_json") = 'object';

ALTER TABLE "jingwei_revision" ADD COLUMN "snapshot_json" TEXT;
