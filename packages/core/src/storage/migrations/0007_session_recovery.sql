ALTER TABLE "session_message_cursor" ADD COLUMN "acked_seq" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "session_message_cursor" ADD COLUMN "recovery_json" TEXT NOT NULL DEFAULT '{}';

UPDATE "session_message_cursor"
SET "acked_seq" = CASE
  WHEN "acked_seq" > "last_seq" THEN "last_seq"
  WHEN "acked_seq" < 0 THEN 0
  ELSE "acked_seq"
END,
"recovery_json" = COALESCE(NULLIF("recovery_json", ''), '{}');
