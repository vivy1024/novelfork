-- 0031_chapter_state_delta.sql
-- 书级 state_revision 与单次状态提交 ChapterStateDelta 记录表

ALTER TABLE "book" ADD COLUMN "state_revision" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "chapter_state_delta" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "book_id" TEXT NOT NULL,
  "chapter_number" INTEGER NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "base_revision" INTEGER NOT NULL,
  "resulting_revision" INTEGER NOT NULL,
  "delta_json" TEXT NOT NULL,
  "created_at" INTEGER NOT NULL,
  FOREIGN KEY ("book_id") REFERENCES "book"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_chapter_state_delta_book_chapter"
  ON "chapter_state_delta"("book_id", "chapter_number");

CREATE UNIQUE INDEX IF NOT EXISTS "idx_chapter_state_delta_book_fingerprint"
  ON "chapter_state_delta"("book_id", "fingerprint");
