-- Migration: Add layer field to story_jingwei_entry for Canon/Dynamic/Reference separation
ALTER TABLE "story_jingwei_entry" ADD COLUMN "layer" TEXT NOT NULL DEFAULT 'dynamic';
