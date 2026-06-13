-- Migration: Add importance score + L0 one-line summary to story_jingwei_entry
-- importance: 0-100 数值评分，用于分级注入排序与逐条降级（默认 40，对应 auto 层）
-- summary_l0: 一句话摘要（L0），用于上下文预算紧张时的最简降级
ALTER TABLE "story_jingwei_entry" ADD COLUMN "importance" INTEGER NOT NULL DEFAULT 40;
ALTER TABLE "story_jingwei_entry" ADD COLUMN "summary_l0" TEXT;
