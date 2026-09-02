-- 0032 叙事实体模型：给关系图一个可靠的骨架
--
-- 病灶（2026-09-01 实测「这个世界修仙讲科学-e664adad」）：
--   narrative_fact 326 条里只有 36 条有 subject_entry_id（11%），
--   narrative_event 340 条里只有 39 条（11%）。
--   → 89% 的关系边只能靠字符串名匹配，于是「薛行之与方工」被当成一个实体，
--     jingwei_relations 0 条、story_jingwei_entry.parent_id 全空，图永远建不起来。
--
-- 学术依据：
--   · 事件中心知识图谱（Rospocher et al. 2016, J. Web Semantics）——事件是一等公民，
--     关系边从事件派生而非独立维护。
--   · Event Calculus（Kowalski & Sergot 1986）——用 fluent + initiates 流水回放世界状态，
--     而不是给每章存全量快照。
--   · bi-temporal（Zep/Graphiti, arXiv 2501.13956）——区分故事内有效期与系统记录期，
--     旧事实用失效标记而非删除。
--   · Foreshadow-Trigger-Payoff 三态（CFPG, arXiv 2601.07033）——两态 planted/paid_off
--     无法表达「触发条件已满足但没兑现」，也就抓不到没击发的契诃夫之枪。
--
-- 本迁移只建表，不动既有表；数据由迁移脚本回填，失败不影响老链路。

-- ─── 实体主表：一切引用的锚点 ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "narrative_entity" (
  "id"               TEXT PRIMARY KEY NOT NULL,
  "book_id"          TEXT NOT NULL,
  "canonical_name"   TEXT NOT NULL,
  -- character/location/faction/item/concept/power/organization/other
  "entity_type"      TEXT NOT NULL DEFAULT 'other',
  -- 别名数组：共指消解的依据（「薛行之」「薛道友」「他」都归一到同一 id）
  "aliases_json"     TEXT NOT NULL DEFAULT '[]',
  "attrs_json"       TEXT NOT NULL DEFAULT '{}',
  -- 关联的经纬条目（如果这个实体已有设定条目）
  "entry_id"         TEXT,
  "first_chapter"    INTEGER,
  "last_chapter"     INTEGER,
  -- active/dead/sealed/departed/unknown
  "lifecycle"        TEXT NOT NULL DEFAULT 'active',
  -- 归并来源：dissect/settlement/manual/inferred，便于回溯错误归并
  "source"           TEXT NOT NULL DEFAULT 'inferred',
  "confidence"       REAL NOT NULL DEFAULT 1.0,
  "created_at"       INTEGER NOT NULL,
  "updated_at"       INTEGER NOT NULL,
  FOREIGN KEY ("book_id") REFERENCES "book"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_narrative_entity_book_name"
  ON "narrative_entity"("book_id", "canonical_name");
CREATE INDEX IF NOT EXISTS "idx_narrative_entity_book_type"
  ON "narrative_entity"("book_id", "entity_type");
CREATE INDEX IF NOT EXISTS "idx_narrative_entity_entry"
  ON "narrative_entity"("book_id", "entry_id");

-- 别名索引表：把 aliases_json 摊平，供 O(1) 名字 → entity_id 查找。
-- 有了它，抽取阶段才能可靠地把文本提及归到已有实体，而不是新建一个重复实体。
CREATE TABLE IF NOT EXISTS "narrative_entity_alias" (
  "book_id"    TEXT NOT NULL,
  "alias"      TEXT NOT NULL,
  "entity_id"  TEXT NOT NULL,
  "confidence" REAL NOT NULL DEFAULT 1.0,
  PRIMARY KEY ("book_id", "alias"),
  FOREIGN KEY ("entity_id") REFERENCES "narrative_entity"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_narrative_entity_alias_entity"
  ON "narrative_entity_alias"("entity_id");

-- ─── 关系边：五元组（s, p, o, valid_from, valid_to），外键而非名字 ─────────
CREATE TABLE IF NOT EXISTS "narrative_relation" (
  "id"              TEXT PRIMARY KEY NOT NULL,
  "book_id"         TEXT NOT NULL,
  "subject_id"      TEXT NOT NULL,
  "predicate"       TEXT NOT NULL,
  "object_id"       TEXT NOT NULL,
  -- 语义分类：ally/enemy/kin/mentor/subordinate/located_in/owns/is_a/knows...
  "relation_kind"   TEXT NOT NULL DEFAULT 'related',
  "sentiment"       TEXT,
  -- valid time：故事内有效区间。valid_to NULL = 至今仍成立
  "valid_from"      INTEGER,
  "valid_to"        INTEGER,
  -- 这条边由哪个事件建立，可溯源
  "source_event_id" TEXT,
  "evidence_text"   TEXT,
  "confidence"      REAL NOT NULL DEFAULT 1.0,
  -- transaction time：系统记录/失效时刻（bi-temporal 的第二轴）
  "recorded_at"     INTEGER NOT NULL,
  "invalidated_at"  INTEGER,
  FOREIGN KEY ("book_id") REFERENCES "book"("id") ON DELETE CASCADE,
  FOREIGN KEY ("subject_id") REFERENCES "narrative_entity"("id") ON DELETE CASCADE,
  FOREIGN KEY ("object_id") REFERENCES "narrative_entity"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_narrative_relation_subject"
  ON "narrative_relation"("book_id", "subject_id");
CREATE INDEX IF NOT EXISTS "idx_narrative_relation_object"
  ON "narrative_relation"("book_id", "object_id");
-- 时间旅行查询主索引：WHERE valid_from <= N AND (valid_to IS NULL OR valid_to > N)
CREATE INDEX IF NOT EXISTS "idx_narrative_relation_valid"
  ON "narrative_relation"("book_id", "valid_from", "valid_to");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_narrative_relation_triple"
  ON "narrative_relation"("book_id", "subject_id", "predicate", "object_id", "valid_from");

-- ─── 事件参与者：事件 ↔ 实体多对多，取代复合主体字符串 ───────────────────
-- 「薛行之与方工联手」不该是一个实体，而是一个事件挂两个 participant。
CREATE TABLE IF NOT EXISTS "narrative_event_participant" (
  "book_id"   TEXT NOT NULL,
  "event_id"  TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  -- agent/patient/instrument/witness/beneficiary
  "role"      TEXT NOT NULL DEFAULT 'agent',
  PRIMARY KEY ("event_id", "entity_id", "role"),
  FOREIGN KEY ("entity_id") REFERENCES "narrative_entity"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_event_participant_entity"
  ON "narrative_event_participant"("book_id", "entity_id");
CREATE INDEX IF NOT EXISTS "idx_event_participant_event"
  ON "narrative_event_participant"("event_id");

-- ─── 状态变更流水：Event Calculus 的 initiates ───────────────────────────
-- 不存每章全量快照。第 N 章的世界 = 对每个 (entity, fluent) 取 chapter <= N 的最后一条。
CREATE TABLE IF NOT EXISTS "narrative_state_change" (
  "id"             TEXT PRIMARY KEY NOT NULL,
  "book_id"        TEXT NOT NULL,
  "entity_id"      TEXT NOT NULL,
  -- fluent：随时间变化的属性名（境界/存活/位置/持有物/身份/伤势）
  "fluent"         TEXT NOT NULL,
  "old_value"      TEXT,
  "new_value"      TEXT NOT NULL,
  "chapter_number" INTEGER NOT NULL,
  "event_id"       TEXT,
  "evidence_text"  TEXT,
  "confidence"     REAL NOT NULL DEFAULT 1.0,
  "recorded_at"    INTEGER NOT NULL,
  FOREIGN KEY ("book_id") REFERENCES "book"("id") ON DELETE CASCADE,
  FOREIGN KEY ("entity_id") REFERENCES "narrative_entity"("id") ON DELETE CASCADE
);

-- 回放查询主索引
CREATE INDEX IF NOT EXISTS "idx_state_change_replay"
  ON "narrative_state_change"("book_id", "entity_id", "fluent", "chapter_number");
CREATE INDEX IF NOT EXISTS "idx_state_change_chapter"
  ON "narrative_state_change"("book_id", "chapter_number");

-- ─── 知识断言：谁在第几章知道什么（知识边界） ────────────────────────────
-- 世界真相与「角色是否知情」必须分开存，否则写作时会让角色用上他还不知道的信息。
CREATE TABLE IF NOT EXISTS "narrative_knowledge" (
  "id"           TEXT PRIMARY KEY NOT NULL,
  "book_id"      TEXT NOT NULL,
  "knower_id"    TEXT NOT NULL,
  -- 指向 narrative_event.id / narrative_relation.id / narrative_state_change.id
  "fact_kind"    TEXT NOT NULL DEFAULT 'event',
  "fact_ref"     TEXT NOT NULL,
  "knows_from"   INTEGER NOT NULL,
  "knows_until"  INTEGER,
  -- knows/suspects/believes_falsely/unaware
  "certainty"    TEXT NOT NULL DEFAULT 'knows',
  "evidence_text" TEXT,
  "recorded_at"  INTEGER NOT NULL,
  FOREIGN KEY ("book_id") REFERENCES "book"("id") ON DELETE CASCADE,
  FOREIGN KEY ("knower_id") REFERENCES "narrative_entity"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_narrative_knowledge_knower"
  ON "narrative_knowledge"("book_id", "knower_id", "knows_from");
CREATE INDEX IF NOT EXISTS "idx_narrative_knowledge_fact"
  ON "narrative_knowledge"("book_id", "fact_ref");

-- ─── 伏笔三态机：Foreshadow → Trigger → Payoff ──────────────────────────
-- 旧模型把状态写在 fields_json.status 里，实测出现整句话当状态值的脏数据，
-- 且 52 条里 16 条完全没有状态。这里用 CHECK 约束把状态收敛成枚举。
CREATE TABLE IF NOT EXISTS "narrative_foreshadow" (
  "id"               TEXT PRIMARY KEY NOT NULL,
  "book_id"          TEXT NOT NULL,
  "label"            TEXT NOT NULL,
  "entry_id"         TEXT,
  "setup_chapter"    INTEGER,
  "setup_event_id"   TEXT,
  -- trigger：触发条件已满足（枪已上膛且该响了），CFPG 的关键中间态
  "trigger_chapter"  INTEGER,
  "trigger_condition" TEXT,
  "payoff_chapter"   INTEGER,
  "payoff_event_id"  TEXT,
  "status"           TEXT NOT NULL DEFAULT 'planted',
  -- 期望兑现章：超过仍未 paid_off 则告警
  "deadline_chapter" INTEGER,
  "importance"       INTEGER NOT NULL DEFAULT 50,
  "evidence_text"    TEXT,
  "recorded_at"      INTEGER NOT NULL,
  "updated_at"       INTEGER NOT NULL,
  CHECK ("status" IN ('planted','reinforced','triggered','paying_off','paid_off','abandoned','contradicted')),
  FOREIGN KEY ("book_id") REFERENCES "book"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_narrative_foreshadow_status"
  ON "narrative_foreshadow"("book_id", "status", "setup_chapter");
CREATE INDEX IF NOT EXISTS "idx_narrative_foreshadow_deadline"
  ON "narrative_foreshadow"("book_id", "deadline_chapter");

-- ─── 叙事结构特征：StoryScope 304 特征的打分结果 ─────────────────────────
-- 依据 StoryScope（arXiv 2604.03136）：只用结构特征即可 93.2% 区分人写/AI 写，
-- 且对文风改写鲁棒（LAMP 去陈词后仅掉 1.6 分）。词频式 AI 味检测抓的是表层，
-- 被润色即失效；这张表存的是结构层指标。
CREATE TABLE IF NOT EXISTS "narrative_structure_score" (
  "id"             TEXT PRIMARY KEY NOT NULL,
  "book_id"        TEXT NOT NULL,
  -- 章节级为章号；全书级为 NULL
  "chapter_number" INTEGER,
  -- StoryScope 特征 id，如 EVT_CAU_002 / PLT_MOR_002
  "feature_id"     TEXT NOT NULL,
  "dimension"      TEXT NOT NULL,
  "value"          TEXT NOT NULL,
  -- 归一化到 0-1 便于聚合与画曲线
  "numeric_value"  REAL,
  -- 与网文理想区间的偏差（正=偏 AI 侧）。注意网文口味与「越像人类越好」不同向
  "deviation"      REAL,
  "model"          TEXT,
  "recorded_at"    INTEGER NOT NULL,
  FOREIGN KEY ("book_id") REFERENCES "book"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_structure_score_unique"
  ON "narrative_structure_score"("book_id", "chapter_number", "feature_id");
CREATE INDEX IF NOT EXISTS "idx_structure_score_dimension"
  ON "narrative_structure_score"("book_id", "dimension");
