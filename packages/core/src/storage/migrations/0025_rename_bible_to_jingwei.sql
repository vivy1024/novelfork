-- Rename legacy bible_* tables to jingwei_*
ALTER TABLE "bible_character" RENAME TO "jingwei_character";
ALTER TABLE "bible_event" RENAME TO "jingwei_event";
ALTER TABLE "bible_setting" RENAME TO "jingwei_setting";
ALTER TABLE "bible_chapter_summary" RENAME TO "jingwei_chapter_summary";
ALTER TABLE "bible_conflict" RENAME TO "jingwei_conflict";
ALTER TABLE "bible_world_model" RENAME TO "jingwei_world_model";
ALTER TABLE "bible_premise" RENAME TO "jingwei_premise";
ALTER TABLE "bible_character_arc" RENAME TO "jingwei_character_arc";

-- Rename bible_mode column in book table
ALTER TABLE "book" RENAME COLUMN "bible_mode" TO "jingwei_mode";
