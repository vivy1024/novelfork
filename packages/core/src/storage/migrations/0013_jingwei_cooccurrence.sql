CREATE TABLE IF NOT EXISTS jingwei_cooccurrence (
  book_id TEXT NOT NULL,
  tag_a TEXT NOT NULL,
  tag_b TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  last_chapter INTEGER,
  PRIMARY KEY (book_id, tag_a, tag_b)
);
CREATE INDEX IF NOT EXISTS idx_jingwei_cooccurrence_a ON jingwei_cooccurrence(book_id, tag_a);
CREATE INDEX IF NOT EXISTS idx_jingwei_cooccurrence_b ON jingwei_cooccurrence(book_id, tag_b);
