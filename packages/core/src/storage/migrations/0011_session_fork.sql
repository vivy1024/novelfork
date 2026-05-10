-- Add fork tracking columns to session table
ALTER TABLE "session" ADD COLUMN "parent_session_id" TEXT;
ALTER TABLE "session" ADD COLUMN "fork_mode" TEXT;
