-- Migration: Add collaborative maintenance fields to story_jingwei_entry
-- source: who last modified (user/agent-write/auto-settle/system-init/ai-enrich)
-- revision_history: JSON array of recent revisions [{timestamp, source, changedFields, previousSnapshot?}]
-- conflict_status: none/pending/resolved — marks when agent and user edits disagree
-- conflict_detail: human-readable description of the conflict
ALTER TABLE "story_jingwei_entry" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'user';
ALTER TABLE "story_jingwei_entry" ADD COLUMN "revision_history" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "story_jingwei_entry" ADD COLUMN "conflict_status" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "story_jingwei_entry" ADD COLUMN "conflict_detail" TEXT;
