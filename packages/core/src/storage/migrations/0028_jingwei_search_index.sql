-- 0028: Jingwei bigram FTS5 search index.
--
-- 背景：FTS5 默认 unicode61 tokenizer 将整段中文视为单个 token，
-- 「韩立」「太清门」等查询 0 命中；trigram 有 3 字符下限，漏掉 2 字人名。
-- 本迁移建立持久 bigram 索引（内容按字滑窗切分为 bigram 后写入 FTS5），
-- 查询侧同样切分并以 phrase 匹配。索引内容由应用层 JS 维护
-- （engine/jingwei/search/fts-index.ts），本迁移只建表结构，不回填数据；
-- 首次检索时由 ensureBookFtsFresh 自愈重建。
--
-- jingwei_fts_doc：稳定 doc_id 映射（不依赖 story_jingwei_entry 的隐式
-- rowid，避免 VACUUM 重排），并记录 entry 的 updated_at 供一致性比对。

CREATE TABLE IF NOT EXISTS "jingwei_fts_doc" (
  "doc_id"          INTEGER PRIMARY KEY AUTOINCREMENT,
  "entry_id"        TEXT NOT NULL UNIQUE,
  "book_id"         TEXT NOT NULL,
  "indexed_at"      INTEGER NOT NULL,
  "entry_updated_at" INTEGER NOT NULL,
  "entry_status"    TEXT NOT NULL DEFAULT 'confirmed'
);

CREATE INDEX IF NOT EXISTS "jingwei_fts_doc_book_idx"
  ON "jingwei_fts_doc" ("book_id");

-- contentless FTS5：只保留倒排索引，不重复存储 gram 原文。
-- contentless_delete=1 允许按 rowid 单条删除（SQLite >= 3.47，Bun 内置 3.51+ 可用）。
CREATE VIRTUAL TABLE IF NOT EXISTS "jingwei_entry_fts" USING fts5(
  "title_g", "alias_g", "tag_g", "keyword_g", "summary_g", "content_g",
  content='',
  contentless_delete=1
);
