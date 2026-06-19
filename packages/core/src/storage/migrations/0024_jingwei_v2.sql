-- Jingwei v2: simplify data model + add revision history + dependencies + custom categories

-- 1. Entry table: add status, version columns
ALTER TABLE story_jingwei_entry ADD COLUMN status TEXT DEFAULT 'confirmed';
ALTER TABLE story_jingwei_entry ADD COLUMN version INTEGER DEFAULT 1;

-- 2. Revision history table
CREATE TABLE IF NOT EXISTS jingwei_revision (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  content_md TEXT NOT NULL,
  category TEXT,
  layer TEXT,
  reason TEXT,
  changed_by TEXT DEFAULT 'user',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jingwei_revision_entry ON jingwei_revision(entry_id);

-- 3. Dependency table
CREATE TABLE IF NOT EXISTS jingwei_dependency (
  id TEXT PRIMARY KEY,
  source_entry_id TEXT NOT NULL,
  target_entry_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  relation_type TEXT DEFAULT 'references',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jingwei_dep_source ON jingwei_dependency(source_entry_id);
CREATE INDEX IF NOT EXISTS idx_jingwei_dep_target ON jingwei_dependency(target_entry_id);

-- 4. Custom category table
CREATE TABLE IF NOT EXISTS jingwei_custom_category (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT DEFAULT '📁',
  sort_order INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jingwei_custom_cat_book ON jingwei_custom_category(book_id);
