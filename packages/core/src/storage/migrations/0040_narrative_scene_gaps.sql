-- 0040 场景留白落盘：narrative_scene 增加 gaps_json。
--
-- 规划留白（动机 / 细节 / 节奏缺口 + 作者或导演的真实答案）此前只活在 scene.spec 的一次性结果里，
-- 作者无处修改，叙述者下次也读不到。本迁移给场景补一列 JSON 数组，旧行默认空数组。

ALTER TABLE "narrative_scene" ADD COLUMN "gaps_json" TEXT NOT NULL DEFAULT '[]';
