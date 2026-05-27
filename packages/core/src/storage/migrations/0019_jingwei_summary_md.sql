-- Migration: Add summary_md to story_jingwei_entry for indexed Jingwei reading
ALTER TABLE "story_jingwei_entry" ADD COLUMN "summary_md" TEXT;
