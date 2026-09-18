-- 0036 对齐 SceneSpec 与 narrative_scene：为场景补齐写前蓝图的六项字段与节拍预算。
--
-- 写前蓝图（SceneSpec）产出角色、冲突、氛围、结局、伏笔进出等核心指标，
-- 此前在持久层无处安放。本迁移为 narrative_scene 补齐对应列，
-- 让写前规划成果能够无损沉淀为持久化场景。

ALTER TABLE "narrative_scene" ADD COLUMN "conflict" TEXT NOT NULL DEFAULT '';
ALTER TABLE "narrative_scene" ADD COLUMN "mood" TEXT NOT NULL DEFAULT '';
ALTER TABLE "narrative_scene" ADD COLUMN "outcome" TEXT NOT NULL DEFAULT '';
ALTER TABLE "narrative_scene" ADD COLUMN "characters_json" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "narrative_scene" ADD COLUMN "hooks_used_json" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "narrative_scene" ADD COLUMN "hooks_planted_json" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "narrative_scene" ADD COLUMN "beat_budget_json" TEXT;
