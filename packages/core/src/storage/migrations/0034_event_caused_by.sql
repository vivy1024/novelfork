-- 0034 事件显式因果：前驱写在 narrative_event.caused_by_json。
--
-- narrative_event 由 ensureNarrativeMemorySchema 维护，不在编号迁移里建表。
-- 本文件只登记版本号；实际加列走 ensureNarrativeMemorySchema 的 ALTER，
-- 避免新库在建表前执行 ALTER 失败。

SELECT 1;
