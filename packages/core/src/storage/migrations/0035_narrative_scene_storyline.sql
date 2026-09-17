-- 0035 场景与剧情线：让叙事结构长出第二棵树。
--
-- 在此之前，本产品最小的「有身份」叙事单元是章（writing_resource 的一行，
-- 按 chapter_number 平铺）。章以下没有任何东西有 id，于是：
--   · 剧情线横跨二十章时选不中、看不了完整弧；
--   · 调整叙事顺序在数据层没有表示，只能改正文；
--   · 伏笔只能记章号，挂不到具体场景；
--   · 节拍预算只能做到章粒度——而产品自己的写作方法论
--     （writing-skills 的 playwright 细纲模板）是按场景列 Beat Sheet 的。
--     方法论要求场景是一等公民，数据结构里却没有对应物。
--
-- 两棵正交树的关键不是「有两棵树」，而是同一个场景同时挂在两棵树上：
--   承载树  卷 → 章 → 场景     （在哪讲）
--   因果树  剧情线 → 场景       （为什么发生）
-- 这要求场景本身有身份，因此这里给它建表。
--
-- 卷刻意不建表：VolumeEntry 已有 id 与 chapterRange，权威源是经纬 outline 条目的
-- fields_json.volumes；章节归属可由区间推导，按「能派生的状态不存储」不再落一列
-- volume_id，也不另立第二个权威源。
--
-- 建表同时也写进 ensureNarrativeMemorySchema：未跑编号迁移的库（测试夹具走
-- createStorageDatabase 直建）同样需要这些表。

CREATE TABLE IF NOT EXISTS "narrative_storyline" (
  "id"          TEXT PRIMARY KEY NOT NULL,
  "book_id"     TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  -- main/sub/romance/faction/mystery/character-arc/other
  "kind"        TEXT NOT NULL DEFAULT 'other',
  -- 剧情线自身的生命周期，与审核门 status 正交：
  -- planned/active/paused/resolved/abandoned
  "lifecycle"   TEXT NOT NULL DEFAULT 'active',
  "goal"        TEXT NOT NULL DEFAULT '',
  -- 关联的经纬条目（作者若已建 plot 分类条目，设定正文仍以经纬为权威）
  "entry_id"    TEXT,
  -- canon/dynamic：机器抽取一律 dynamic，作者确认后才可升 canon
  "layer"       TEXT NOT NULL DEFAULT 'dynamic',
  -- 审核门：needs-review/confirmed/rejected
  "status"      TEXT NOT NULL DEFAULT 'needs-review',
  -- dissect/settlement/workflow/manual/inferred
  "source"      TEXT NOT NULL DEFAULT 'inferred',
  "confidence"  REAL NOT NULL DEFAULT 1.0,
  "created_at"  INTEGER NOT NULL,
  "updated_at"  INTEGER NOT NULL,
  FOREIGN KEY ("book_id") REFERENCES "book"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_narrative_storyline_book"
  ON "narrative_storyline" ("book_id", "lifecycle");

CREATE TABLE IF NOT EXISTS "narrative_scene" (
  "id"                  TEXT PRIMARY KEY NOT NULL,
  "book_id"             TEXT NOT NULL,
  -- 承载树的父：章。章在 writing_resource 里以 chapter_number 为键，
  -- 这里同样按章号引用，避免绑定到某一版正文行（改写会换 id）。
  "chapter_number"      INTEGER NOT NULL,
  -- 章内次序，从 1 起。调整叙事顺序就是改这一列，不必动正文。
  "ordinal"             INTEGER NOT NULL,
  "title"               TEXT NOT NULL DEFAULT '',
  "summary"             TEXT NOT NULL DEFAULT '',
  -- 场景在故事推进中承担什么：
  -- advance/reveal/plant/payoff/relationship/transition/setup/climax/other
  "function"            TEXT NOT NULL DEFAULT 'advance',
  -- 视角人物与发生地，指向 narrative_entity（可空：尚未归并出实体时留空）
  "pov_entity_id"       TEXT,
  "location_entity_id"  TEXT,
  "word_count"          INTEGER NOT NULL DEFAULT 0,
  "layer"               TEXT NOT NULL DEFAULT 'dynamic',
  "status"              TEXT NOT NULL DEFAULT 'needs-review',
  "source"              TEXT NOT NULL DEFAULT 'inferred',
  "confidence"          REAL NOT NULL DEFAULT 1.0,
  "created_at"          INTEGER NOT NULL,
  "updated_at"          INTEGER NOT NULL,
  FOREIGN KEY ("book_id") REFERENCES "book"("id") ON DELETE CASCADE
);

-- 承载树的主查询：按书取某章的场景，按章内次序排。
CREATE INDEX IF NOT EXISTS "idx_narrative_scene_chapter"
  ON "narrative_scene" ("book_id", "chapter_number", "ordinal");
CREATE INDEX IF NOT EXISTS "idx_narrative_scene_pov"
  ON "narrative_scene" ("pov_entity_id");

-- 正交挂载。刻意做成多对多而不是在 scene 上放一列 storyline_id：
-- 一个场景同时推进主线和感情线是常态，强行一对一会立刻失真。
-- role=primary 决定它在因果树里默认挂在哪条线下，supporting 是次要服务。
CREATE TABLE IF NOT EXISTS "narrative_scene_storyline" (
  "scene_id"      TEXT NOT NULL,
  "storyline_id"  TEXT NOT NULL,
  -- primary/supporting
  "role"          TEXT NOT NULL DEFAULT 'primary',
  "created_at"    INTEGER NOT NULL,
  PRIMARY KEY ("scene_id", "storyline_id"),
  FOREIGN KEY ("scene_id") REFERENCES "narrative_scene"("id") ON DELETE CASCADE,
  FOREIGN KEY ("storyline_id") REFERENCES "narrative_storyline"("id") ON DELETE CASCADE
);

-- 因果树的主查询：按剧情线取场景。
CREATE INDEX IF NOT EXISTS "idx_narrative_scene_storyline_line"
  ON "narrative_scene_storyline" ("storyline_id", "role");
