-- User templates for template market
CREATE TABLE IF NOT EXISTS "user_template" (
  "id" TEXT PRIMARY KEY,
  "book_id" TEXT,
  "name" TEXT NOT NULL,
  "genre" TEXT,
  "description" TEXT,
  "bundle_json" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "deleted_at" TEXT
);

CREATE INDEX IF NOT EXISTS "user_template_book_id_idx" ON "user_template" ("book_id");
