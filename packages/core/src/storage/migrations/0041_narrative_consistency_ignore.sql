-- 0041 叙事体检「忽略此条」持久化：只记作者的裁决，不存检测结果。
--
-- 检测结果每次现算、不落盘（诊断结果不持久化）；作者把某条标为忽略后，
-- 刷新与重新结算都不该再冒出来，撤销忽略后恢复。裁决键 = 检测类型 + 实体 id + 章号 + 记忆事实 id，
-- 缺项写空串 / 0，保证主键可比较。

CREATE TABLE IF NOT EXISTS "narrative_consistency_ignore" (
  "book_id"        TEXT NOT NULL,
  "kind"           TEXT NOT NULL,
  "entity_id"      TEXT NOT NULL DEFAULT '',
  "chapter_number" INTEGER NOT NULL DEFAULT 0,
  "fact_id"        TEXT NOT NULL DEFAULT '',
  "created_at"     INTEGER NOT NULL,
  PRIMARY KEY ("book_id", "kind", "entity_id", "chapter_number", "fact_id"),
  FOREIGN KEY ("book_id") REFERENCES "book"("id") ON DELETE CASCADE
);
