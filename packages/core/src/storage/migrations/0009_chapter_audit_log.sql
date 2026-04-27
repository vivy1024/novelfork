CREATE TABLE IF NOT EXISTS "chapter_audit_log" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "book_id" TEXT NOT NULL REFERENCES "book"("id") ON DELETE CASCADE,
  "chapter_number" INTEGER NOT NULL,
  "audited_at" TEXT NOT NULL,
  "continuity_passed" INTEGER NOT NULL DEFAULT 1,
  "continuity_issue_count" INTEGER NOT NULL DEFAULT 0,
  "ai_taste_score" REAL NOT NULL DEFAULT 0,
  "hook_health_issues" INTEGER NOT NULL DEFAULT 0,
  "long_span_fatigue_issues" INTEGER NOT NULL DEFAULT 0,
  "sensitive_word_count" INTEGER NOT NULL DEFAULT 0,
  "rhythm_diversity_score" REAL NOT NULL DEFAULT 0,
  "summary" TEXT NOT NULL DEFAULT ''
);

CREATE INDEX "chapter_audit_log_book_chapter_idx" ON "chapter_audit_log" ("book_id", "chapter_number");
CREATE INDEX "chapter_audit_log_book_audited_idx" ON "chapter_audit_log" ("book_id", "audited_at");
