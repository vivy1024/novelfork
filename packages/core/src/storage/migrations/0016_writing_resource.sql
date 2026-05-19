-- Migration: Unified writing resource table
-- Replaces file-based chapters/candidates/drafts with a single SQLite table.

CREATE TABLE IF NOT EXISTS "writing_resource" (
  "id" TEXT PRIMARY KEY,
  "book_id" TEXT NOT NULL,
  "type" TEXT NOT NULL CHECK ("type" IN ('chapter', 'candidate', 'draft')),
  "status" TEXT NOT NULL CHECK ("status" IN ('draft', 'candidate', 'accepted', 'rejected', 'archived')),
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL DEFAULT '',
  "chapter_number" INTEGER,
  "word_count" INTEGER NOT NULL DEFAULT 0,
  "parent_id" TEXT REFERENCES "writing_resource"("id"),
  "version" INTEGER NOT NULL DEFAULT 1,
  "source" TEXT,
  "metadata_json" TEXT,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  "accepted_at" INTEGER,
  "deleted_at" INTEGER
);

CREATE INDEX IF NOT EXISTS "idx_wr_book_type" ON "writing_resource" ("book_id", "type", "deleted_at");
CREATE INDEX IF NOT EXISTS "idx_wr_book_chapter" ON "writing_resource" ("book_id", "chapter_number")
  WHERE "type" = 'chapter' AND "status" = 'accepted' AND "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_wr_parent" ON "writing_resource" ("parent_id") WHERE "parent_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_wr_status" ON "writing_resource" ("book_id", "status", "deleted_at");
