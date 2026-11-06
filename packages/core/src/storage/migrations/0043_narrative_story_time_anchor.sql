-- 0043 故事时间锚：结算从正文抽出的故事内时间说法（第几日 / 季节 / 年份 / 「三天后」/「三日后决战」/ 年龄）。
--
-- 只存抽取原件（说法、原文证据、归一后的偏移或日历、置信度），不存推算结果：
-- 故事时间轴按章累积现算（相对锚按上一锚推算，推算链随结果返回），改写前面的章后自动跟着变。
-- 时间矛盾（倒流、同一人同日两地、年龄对不上）同样现算，只作待确认告警，不自动改。
-- 按章整批替换：同一章重新结算时先删后写。

CREATE TABLE IF NOT EXISTS "narrative_story_time_anchor" (
  "id"             TEXT PRIMARY KEY NOT NULL,
  "book_id"        TEXT NOT NULL,
  "chapter_number" INTEGER NOT NULL,
  "ordinal"        INTEGER NOT NULL,
  "kind"           TEXT NOT NULL,
  "expression"     TEXT NOT NULL,
  "evidence_text"  TEXT NOT NULL,
  "anchor_json"    TEXT NOT NULL DEFAULT '{}',
  "confidence"     REAL NOT NULL DEFAULT 0.7,
  "created_at"     INTEGER NOT NULL,
  FOREIGN KEY ("book_id") REFERENCES "book"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_narrative_story_time_anchor_chapter"
  ON "narrative_story_time_anchor"("book_id", "chapter_number", "ordinal");
