CREATE TABLE IF NOT EXISTS "filter_report" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "book_id" TEXT NOT NULL,
  "chapter_number" INTEGER NOT NULL,
  "ai_taste_score" INTEGER NOT NULL,
  "level" TEXT NOT NULL,
  "hit_counts_json" TEXT NOT NULL,
  "zhuque_score" INTEGER,
  "zhuque_status" TEXT,
  "details" TEXT NOT NULL,
  "engine_version" TEXT NOT NULL,
  "scanned_at" INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS "filter_report_by_chapter_idx"
  ON "filter_report" ("book_id", "chapter_number", "scanned_at");
