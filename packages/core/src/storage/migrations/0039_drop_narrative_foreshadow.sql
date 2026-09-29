-- 0039 伏笔回到单一权威源：删掉 0032 建的 narrative_foreshadow。
--
-- 伏笔的唯一权威源是经纬 foreshadowing 条目（状态存 fields_json）。这张表是按事件主语
-- 另存的第二份伏笔状态：行全部由章后结算从 narrative_event 的 hook_* 事件投影而来
-- （含未经作者审核的事件），或由回填脚本从经纬条目复制，没有任何只存在于这里的作者数据。
-- 现在伏笔阶段在读取时由「经纬条目 + 关联的已应用 hook 事件」派生（foreshadow-states），
-- 不再存储。
DROP INDEX IF EXISTS "idx_narrative_foreshadow_status";
DROP INDEX IF EXISTS "idx_narrative_foreshadow_deadline";
DROP TABLE IF EXISTS "narrative_foreshadow";
