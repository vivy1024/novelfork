CREATE TABLE IF NOT EXISTS "writing_log" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "book_id" TEXT NOT NULL REFERENCES "book"("id") ON DELETE CASCADE,
  "chapter_number" INTEGER NOT NULL,
  "word_count" INTEGER NOT NULL,
  "completed_at" TEXT NOT NULL,
  "date" TEXT NOT NULL
);

CREATE INDEX "writing_log_book_date_idx" ON "writing_log" ("book_id", "date");
CREATE INDEX "writing_log_date_idx" ON "writing_log" ("date");
