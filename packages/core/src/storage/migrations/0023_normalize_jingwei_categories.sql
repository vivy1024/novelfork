-- Normalize legacy category values to unified category enum
UPDATE "story_jingwei_entry" SET "category" = 'world-model' WHERE "category" IN ('setting', 'worldview', 'special') AND "deleted_at" IS NULL;
UPDATE "story_jingwei_entry" SET "category" = 'characters' WHERE "category" = 'character' AND "deleted_at" IS NULL;
UPDATE "story_jingwei_entry" SET "category" = 'locations' WHERE "category" = 'geography' AND "deleted_at" IS NULL;
UPDATE "story_jingwei_entry" SET "category" = 'conflicts' WHERE "category" IN ('event', 'plot') AND "deleted_at" IS NULL;
UPDATE "story_jingwei_entry" SET "category" = 'factions' WHERE "category" = 'faction' AND "deleted_at" IS NULL;
UPDATE "story_jingwei_entry" SET "category" = 'props' WHERE "category" IN ('item', 'skill', 'currency') AND "deleted_at" IS NULL;
UPDATE "story_jingwei_entry" SET "category" = 'relationships' WHERE "category" = 'relationship' AND "deleted_at" IS NULL;
UPDATE "story_jingwei_entry" SET "category" = 'chapter-summaries' WHERE "category" = 'chapter-summary' AND "deleted_at" IS NULL;
