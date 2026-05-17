-- Migration: Request log persistence
-- Stores all AI/API request logs in SQLite for cross-restart persistence.

CREATE TABLE IF NOT EXISTS "request_log" (
  "id" TEXT PRIMARY KEY,
  "timestamp" TEXT NOT NULL,
  "method" TEXT NOT NULL DEFAULT 'POST',
  "endpoint" TEXT NOT NULL DEFAULT '',
  "status" INTEGER NOT NULL DEFAULT 200,
  "duration" INTEGER NOT NULL DEFAULT 0,
  "user_id" TEXT NOT NULL DEFAULT '',
  "request_kind" TEXT,
  "narrator" TEXT,
  "provider" TEXT,
  "model" TEXT,
  "input_tokens" INTEGER,
  "output_tokens" INTEGER,
  "total_tokens" INTEGER,
  "tokens_estimated" INTEGER DEFAULT 0,
  "tokens_source" TEXT,
  "ttft_ms" INTEGER,
  "cost_usd" REAL,
  "cache_status" TEXT,
  "cache_scope" TEXT,
  "cache_age_ms" INTEGER,
  "details" TEXT,
  "run_id" TEXT,
  "request_domain" TEXT,
  "source" TEXT,
  "ai_status" TEXT,
  "error_summary" TEXT,
  "book_id" TEXT,
  "session_id" TEXT,
  "chapter_number" INTEGER
);

CREATE INDEX IF NOT EXISTS "idx_request_log_timestamp" ON "request_log" ("timestamp" DESC);
CREATE INDEX IF NOT EXISTS "idx_request_log_provider_model" ON "request_log" ("provider", "model");
CREATE INDEX IF NOT EXISTS "idx_request_log_status" ON "request_log" ("status");
