-- T4b: 审计 issue 生命周期——明细/指纹/stale 三列。
--
-- 背景：chapter_audit_log 此前只存各类计数，审计 issue 明细（含
-- issue_id/evidence/severity/suggestion）随写章结果返回后即丢弃，
-- 作者无法回答「这条问题后来修了没」。本迁移补三列：
--   issues_json         完整 issue 明细（每条带稳定 issue_id）
--   content_fingerprint 审计时的正文指纹，用于改章 stale 判定
--   stale               正文变更后旧审计是否已过期（0/1）

ALTER TABLE "chapter_audit_log" ADD COLUMN "issues_json" TEXT;
ALTER TABLE "chapter_audit_log" ADD COLUMN "content_fingerprint" TEXT;
ALTER TABLE "chapter_audit_log" ADD COLUMN "stale" INTEGER NOT NULL DEFAULT 0;
