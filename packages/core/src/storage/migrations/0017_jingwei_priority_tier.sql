-- Migration: Add priority_tier to story_jingwei_entry for context layering
ALTER TABLE "story_jingwei_entry" ADD COLUMN "priority_tier" TEXT DEFAULT 'auto';
