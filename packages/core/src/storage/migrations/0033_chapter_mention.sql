-- 0033 本章提及清单：共现图要「谁在这一章出现过」，与增量事件分列。
--
-- 增量抽取（settlement）只记状态变化，所以每章事件实体偏少。
-- 这张表存全量出场，供有向共现当标签序列；表空时回落到事件 subject/object。

CREATE TABLE IF NOT EXISTS "narrative_chapter_mention" (
  "book_id"         TEXT NOT NULL,
  "chapter_number"  INTEGER NOT NULL,
  "position"        INTEGER NOT NULL,
  "entity_name"     TEXT NOT NULL,
  "entry_id"        TEXT,
  -- dictionary / event / llm
  "source"          TEXT NOT NULL DEFAULT 'dictionary',
  PRIMARY KEY ("book_id", "chapter_number", "entity_name"),
  FOREIGN KEY ("book_id") REFERENCES "book"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_chapter_mention_book_chapter"
  ON "narrative_chapter_mention"("book_id", "chapter_number", "position");
CREATE INDEX IF NOT EXISTS "idx_chapter_mention_entry"
  ON "narrative_chapter_mention"("book_id", "entry_id");
