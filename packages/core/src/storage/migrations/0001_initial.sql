CREATE TABLE IF NOT EXISTS "session" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  "message_count" INTEGER NOT NULL DEFAULT 0,
  "config_json" TEXT NOT NULL DEFAULT '{}',
  "metadata_json" TEXT NOT NULL DEFAULT '{}',
  "deleted_at" INTEGER
);

CREATE TABLE IF NOT EXISTS "session_message" (
  "session_id" TEXT NOT NULL,
  "seq" INTEGER NOT NULL,
  "id" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "timestamp" INTEGER NOT NULL,
  "metadata_json" TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY ("session_id", "seq"),
  FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "session_message_session_id_id_idx"
  ON "session_message" ("session_id", "id");

CREATE INDEX IF NOT EXISTS "session_message_session_id_seq_desc_idx"
  ON "session_message" ("session_id", "seq");

CREATE TABLE IF NOT EXISTS "session_message_cursor" (
  "session_id" TEXT PRIMARY KEY NOT NULL,
  "last_seq" INTEGER NOT NULL DEFAULT 0,
  "available_from_seq" INTEGER NOT NULL DEFAULT 0,
  "updated_at" INTEGER NOT NULL,
  FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "kv_store" (
  "key" TEXT PRIMARY KEY NOT NULL,
  "value" TEXT NOT NULL,
  "updated_at" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS "drizzle_migrations" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "hash" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL UNIQUE,
  "created_at" INTEGER NOT NULL
);
