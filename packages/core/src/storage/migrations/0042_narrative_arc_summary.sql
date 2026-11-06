-- 0042 层级前情落盘：卷摘要与全书梗概（模型据章摘要归纳的派生记录）。
--
-- 此前卷摘要 / 全书梗概在召回时由章摘要首句机械拼接，不落库；长篇里早期各卷只剩标题。
-- 本表存模型生成的版本，供召回优先使用；缺失或过期时召回退回机械派生。
-- 每行记来源章号与输入指纹（来源章摘要的哈希），章摘要变了就能判定过期，过期判定在读取时现算。
-- 机器产物默认 needs-review，作者确认后为 confirmed；召回可用待确认的版本，但要标注。

CREATE TABLE IF NOT EXISTS "narrative_arc_summary" (
  "id"                   TEXT PRIMARY KEY NOT NULL,
  "book_id"              TEXT NOT NULL,
  "kind"                 TEXT NOT NULL,
  "segment_id"           TEXT NOT NULL,
  "segment_title"        TEXT NOT NULL DEFAULT '',
  "chapter_from"         INTEGER NOT NULL,
  "chapter_to"           INTEGER NOT NULL,
  "source_chapters_json" TEXT NOT NULL DEFAULT '[]',
  "input_fingerprint"    TEXT NOT NULL,
  "content_json"         TEXT NOT NULL DEFAULT '{}',
  "status"               TEXT NOT NULL DEFAULT 'needs-review',
  "model"                TEXT,
  "generated_at"         INTEGER NOT NULL,
  "confirmed_at"         INTEGER,
  FOREIGN KEY ("book_id") REFERENCES "book"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_narrative_arc_summary_segment"
  ON "narrative_arc_summary"("book_id", "kind", "segment_id");
