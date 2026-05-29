-- Migration: Agent runtime hardening
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
