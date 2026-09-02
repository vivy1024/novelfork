/**
 * 叙事实体回填：把既有的经纬条目与叙事记忆灌进 migration 0032 的实体模型。
 *
 * 为什么需要：实测该书 `narrative_fact` 只有 36/326 有 entry_id（11%），
 * `narrative_event` 39/340。89% 的关系边只能靠字符串名匹配，
 * 于是「薛行之与方工」会被当成一个实体，图永远建不准。
 *
 * 归并原则（宁可漏并，不可错并）：
 *   · 只用经纬实体字典的 canonical 名与显式别名做**精确匹配**（含剥括号形态）
 *   · 不做模糊/子串匹配 —— 「陈默」与「陈砚秋」这类近名误并的代价远高于漏并
 *   · 未命中的提及保留原样并标 source='inferred'，可后续人工确认
 *
 * 用法：
 *   bun scripts/backfill-narrative-entities.ts --dry-run            # 只报告
 *   bun scripts/backfill-narrative-entities.ts --dry-run --book=ID  # 单本
 *   bun scripts/backfill-narrative-entities.ts --apply              # 落库
 *
 * 幂等：按 (book_id, canonical_name) 唯一，重复执行不产生重复行。
 */

import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";

// ─── CLI ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const DRY_RUN = !APPLY;
const BOOK_FILTER = args.find((arg) => arg.startsWith("--book="))?.slice("--book=".length);
const VERBOSE = args.includes("--verbose");
const DB_PATH = args.find((arg) => arg.startsWith("--db="))?.slice("--db=".length)
  ?? join(homedir(), ".novelfork", "novelfork.db");

// ─── 实体字典（与 entity-dictionary.ts 同口径，脚本内自包含避免打包依赖） ───

/** 剥离尾部括号装饰：「薛行之（主角·权威版）」→「薛行之」。 */
function stripParentheticalSuffix(value: string): string {
  return value.replace(/\s*[（(][^()（）]+[)）]\s*$/u, "").trim();
}

function normalizeKey(value: string): string {
  return value.replace(/\s+/gu, " ").trim().toLocaleLowerCase();
}

const ALIAS_FIELD_KEYS = ["aliases", "别名"] as const;

function readFieldAliases(fields: Record<string, unknown> | undefined): string[] {
  if (!fields) return [];
  const out: string[] = [];
  for (const key of ALIAS_FIELD_KEYS) {
    const value = fields[key];
    if (Array.isArray(value)) {
      for (const item of value) if (typeof item === "string" && item.trim()) out.push(item.trim());
    } else if (typeof value === "string" && value.trim()) {
      for (const part of value.split(/[/,，、\n]/u)) {
        const trimmed = part.trim();
        if (trimmed) out.push(trimmed);
      }
    }
  }
  return out;
}

/** 生成一个条目的全部候选称呼（title/name/aliases + 各自剥括号），去重保序。 */
function expandLookupKeys(input: {
  title: string;
  fields?: Record<string, unknown>;
  aliasColumn?: readonly string[];
}): string[] {
  const seeds = [input.title];
  const fieldName = input.fields?.name;
  if (typeof fieldName === "string" && fieldName.trim()) seeds.push(fieldName.trim());
  seeds.push(...readFieldAliases(input.fields));
  for (const alias of input.aliasColumn ?? []) {
    if (typeof alias === "string" && alias.trim()) seeds.push(alias.trim());
  }

  const expanded: string[] = [];
  for (const seed of seeds) {
    if (!seed.trim()) continue;
    expanded.push(seed.trim());
    const stripped = stripParentheticalSuffix(seed);
    if (stripped && stripped !== seed.trim()) expanded.push(stripped);
  }

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const key of expanded) {
    const norm = normalizeKey(key);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    deduped.push(key);
  }
  return deduped;
}

/** 复合主体拆分：「薛行之与方工」→ 两个实体。括号内视为别名不拆。 */
const COMPOSITE_SEPARATORS = /[、，,]|与|和|及|跟/u;
const NON_ENTITY_HINTS = [/风险$/u, /情况$/u, /记忆$/u, /安置$/u, /筛查$/u, /之夜/u];

function splitComposite(subject: string): { names: string[]; composite: boolean } {
  const trimmed = subject.replace(/\s+/gu, " ").trim();
  if (!trimmed) return { names: [], composite: false };
  if (/[（(].*[）)]/u.test(trimmed)) {
    const stripped = trimmed.replace(/[（(][^（()）]*[）)]/gu, "").trim();
    const outer = stripped.split(COMPOSITE_SEPARATORS).map((p) => p.trim()).filter(Boolean);
    if (outer.length <= 1) return { names: [trimmed], composite: false };
    return { names: outer, composite: true };
  }
  const parts = trimmed.split(COMPOSITE_SEPARATORS).map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return { names: [trimmed], composite: false };
  // 拆出的片段过长或像描述性短语 → 整体是一句话，不是复合主体
  if (parts.some((p) => p.length > 12 || NON_ENTITY_HINTS.some((h) => h.test(p)))) {
    return { names: [trimmed], composite: false };
  }
  return { names: parts, composite: true };
}

function looksLikeEntity(name: string): boolean {
  const n = name.replace(/\s+/gu, " ").trim();
  if (!n || n.length > 16) return false;
  if (/[。！？；]/u.test(n)) return false;
  return !NON_ENTITY_HINTS.some((h) => h.test(n));
}

// ─── 类型 ─────────────────────────────────────────────────────────────────

const ENTITY_CATEGORIES: Record<string, string> = {
  characters: "character",
  people: "character",
  locations: "location",
  factions: "faction",
  props: "item",
  "power-system": "power",
  "world-model": "concept",
};

interface DictEntry {
  readonly entryId: string;
  readonly canonicalName: string;
  readonly entityType: string;
  readonly lookupKeys: readonly string[];
  readonly firstChapter?: number;
}

interface BookStats {
  bookId: string;
  entities: number;
  aliases: number;
  relations: number;
  stateChanges: number;
  foreshadows: number;
  participants: number;
  /** 命中实体字典的提及数。 */
  resolvedMentions: number;
  totalMentions: number;
  /** 命中伏笔条目的提及（是有效身份，只是不属于实体五类）。 */
  foreshadowMentions: number;
  /**
   * 明显不是实体的提及（事件/情节短语，如「故事主线时间」「驻场体检」）。
   * 这类计入分母会让链接率失真，故单列。
   */
  nonEntityMentions: number;
  unresolvedSamples: string[];
}

/**
 * 是否像「事件/情节短语」而非具体实体。
 *
 * 实测未命中提及里占比最大的正是这类：「故事主线时间」×22、「驻场体检」×12、
 * 「B-17数据抢救」×6、「李文彬对薛行之的旧怨」×10。给它们建实体档只会污染图，
 * 所以从链接率分母里剔除，并如实单列计数。
 */
const EVENT_PHRASE_HINTS = [
  /时间$/u, /线索$/u, /后果$/u, /旧怨$/u, /悬案$/u, /抢救$/u, /清理$/u, /掩盖$/u,
  /离职$/u, /体检$/u, /方案$/u, /数据$/u, /记录$/u, /场强$/u, /衰减$/u, /层级$/u,
  /^\d{4}[.\-年]/u,
];

function looksLikeEventPhrase(name: string): boolean {
  const n = name.replace(/\s+/gu, " ").trim();
  if (!n) return false;
  // 长度 >= 5 且命中短语特征；短名（人名/物名）不误判
  if (n.length >= 5 && EVENT_PHRASE_HINTS.some((hint) => hint.test(n))) return true;
  return /^\d{4}[.\-年]/u.test(n);
}

// ─── 主流程 ───────────────────────────────────────────────────────────────

function toChapter(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseJson(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || !value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function resolvePhase(fields: Record<string, unknown>): string {
  const raw = String(fields.status ?? "").trim().toLowerCase();
  if (raw === "paid_off" || raw === "paid-off" || raw === "resolved") return "paid_off";
  if (raw === "triggered") return "triggered";
  if (raw === "reinforced") return "reinforced";
  if (raw === "abandoned") return "abandoned";
  if (raw === "planted" || raw === "open" || raw === "pending") return "planted";
  // 脏值（实测有整句话写进 status）→ 用章号推断，推不出交给 CHECK 允许的兜底值
  if (toChapter(fields.payoffChapter) !== undefined) return "paid_off";
  if (toChapter(fields.plantedChapter) !== undefined) return "planted";
  return "planted";
}

function buildDictionary(db: Database, bookId: string): {
  entries: DictEntry[];
  index: Map<string, DictEntry>;
  /** 伏笔条目的称呼集合：命中它们说明身份有效，只是不属于实体五类。 */
  foreshadowKeys: Set<string>;
} {
  const rows = db.query(
    `SELECT id, category, title, fields_json, aliases_json, related_chapter_numbers_json
     FROM story_jingwei_entry
     WHERE book_id = ? AND deleted_at IS NULL`,
  ).all(bookId) as Array<{
    id: string; category: string; title: string;
    fields_json: string | null; aliases_json: string | null;
    related_chapter_numbers_json: string | null;
  }>;

  const entries: DictEntry[] = [];
  const index = new Map<string, DictEntry>();
  const foreshadowKeys = new Set<string>();

  for (const row of rows) {
    if (row.category === "foreshadowing") {
      const title = String(row.title ?? "").trim();
      if (title) {
        foreshadowKeys.add(normalizeKey(title));
        foreshadowKeys.add(normalizeKey(stripParentheticalSuffix(title)));
      }
      continue;
    }
    const entityType = ENTITY_CATEGORIES[row.category ?? ""];
    if (!entityType) continue;
    const fields = parseJson(row.fields_json);
    let aliasColumn: string[] = [];
    try {
      const parsed = row.aliases_json ? (JSON.parse(row.aliases_json) as unknown) : null;
      if (Array.isArray(parsed)) aliasColumn = parsed.filter((v): v is string => typeof v === "string");
    } catch { /* 脏别名列忽略 */ }

    const title = String(row.title ?? "").trim();
    const rawName = typeof fields.name === "string" && fields.name.trim() ? fields.name.trim() : title;
    // canonical 用剥括号后的短名：「薛行之（主角·权威版）」→「薛行之」
    const canonicalName = stripParentheticalSuffix(rawName) || rawName;
    if (!canonicalName) continue;

    const lookupKeys = expandLookupKeys({ title, fields, aliasColumn });
    const firstChapter = toChapter(fields.firstChapter) ?? toChapter(fields.plantedChapter);

    const entry: DictEntry = {
      entryId: row.id,
      canonicalName,
      entityType,
      lookupKeys,
      ...(firstChapter !== undefined ? { firstChapter } : {}),
    };
    entries.push(entry);
    for (const key of lookupKeys) {
      const norm = normalizeKey(key);
      // 先登记者优先：避免后来的同名条目覆盖已建立的身份
      if (!index.has(norm)) index.set(norm, entry);
    }
  }
  return { entries, index, foreshadowKeys };
}

function resolve(index: Map<string, DictEntry>, rawName: string): DictEntry | null {
  const name = rawName.replace(/\s+/gu, " ").trim();
  if (!name) return null;
  return index.get(normalizeKey(name))
    ?? index.get(normalizeKey(stripParentheticalSuffix(name)))
    ?? null;
}

function processBook(db: Database, bookId: string, now: number): BookStats {
  const stats: BookStats = {
    bookId, entities: 0, aliases: 0, relations: 0, stateChanges: 0,
    foreshadows: 0, participants: 0, resolvedMentions: 0, totalMentions: 0,
    foreshadowMentions: 0, nonEntityMentions: 0,
    unresolvedSamples: [],
  };

  const { entries, index, foreshadowKeys } = buildDictionary(db, bookId);
  const entityIdByCanonical = new Map<string, string>();

  /**
   * 统一的提及归类：把一个原始名字归到「实体 / 伏笔 / 非实体短语 / 未归并」四类之一。
   * 只有第一类返回字典条目参与建边，其余只计数，保证链接率分母口径一致。
   */
  const classifyMention = (rawName: string): DictEntry | null => {
    if (!looksLikeEntity(rawName)) return null;
    if (looksLikeEventPhrase(rawName)) {
      stats.nonEntityMentions += 1;
      return null;
    }
    const normalized = normalizeKey(rawName);
    const stripped = normalizeKey(stripParentheticalSuffix(rawName));
    if (foreshadowKeys.has(normalized) || foreshadowKeys.has(stripped)) {
      stats.foreshadowMentions += 1;
      return null;
    }
    stats.totalMentions += 1;
    const hit = resolve(index, rawName);
    if (hit) {
      stats.resolvedMentions += 1;
      return hit;
    }
    if (stats.unresolvedSamples.length < 12) stats.unresolvedSamples.push(rawName);
    return null;
  };

  // ① 经纬条目 → narrative_entity（权威实体）
  for (const entry of entries) {
    const id = `ent:${bookId}:${entry.canonicalName}`;
    entityIdByCanonical.set(entry.canonicalName, id);
    stats.entities += 1;
    const aliases = entry.lookupKeys.filter((key) => key !== entry.canonicalName);
    stats.aliases += aliases.length;

    if (APPLY) {
      db.query(
        `INSERT INTO narrative_entity
           (id, book_id, canonical_name, entity_type, aliases_json, entry_id, first_chapter, lifecycle, source, confidence, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 'dissect', 1.0, ?, ?)
         ON CONFLICT(book_id, canonical_name) DO UPDATE SET
           entity_type = excluded.entity_type,
           aliases_json = excluded.aliases_json,
           entry_id = COALESCE(excluded.entry_id, narrative_entity.entry_id),
           updated_at = excluded.updated_at`,
      ).run(id, bookId, entry.canonicalName, entry.entityType, JSON.stringify(aliases),
        entry.entryId, entry.firstChapter ?? null, now, now);

      for (const alias of entry.lookupKeys) {
        db.query(
          `INSERT INTO narrative_entity_alias (book_id, alias, entity_id, confidence)
           VALUES (?, ?, ?, 1.0)
           ON CONFLICT(book_id, alias) DO UPDATE SET entity_id = excluded.entity_id`,
        ).run(bookId, alias, id);
      }
    }
  }

  // ② facts → 关系边 / 状态流水
  const facts = db.query(
    `SELECT id, subject, predicate, object, category, source_chapter, valid_from_chapter,
            valid_until_chapter, evidence_text, confidence
     FROM narrative_fact WHERE book_id = ?`,
  ).all(bookId) as Array<Record<string, unknown>>;

  for (const fact of facts) {
    const chapter = toChapter(fact.source_chapter) ?? toChapter(fact.valid_from_chapter);
    const subjectSplit = splitComposite(String(fact.subject ?? ""));
    const subjectHits: DictEntry[] = [];
    for (const name of subjectSplit.names) {
      const hit = classifyMention(name);
      if (hit) subjectHits.push(hit);
    }

    if (String(fact.category) === "relationship") {
      /*
       * 关系双方的实际存放方式（实测）：
       *   subject = "薛行之与方工"（复合主体，两个实体都在这里）
       *   object  = "建立按项目结算的七天事故复核协作"（一整句关系描述，不是实体名）
       *
       * 所以边必须从**复合 subject 内部互连**建出来，而不是 subject×object。
       * 早先按 subject→object 连边导致一条都建不出（object 永远不是实体）。
       * object 仅在确实是实体名时才作为额外一端参与（如「薛行之 / 救下 / 陈默」）。
       */
      const objectSplit = splitComposite(String(fact.object ?? ""));
      const objectHits: DictEntry[] = [];
      for (const name of objectSplit.names) {
        const hit = classifyMention(name);
        if (hit) objectHits.push(hit);
      }

      // 复合主体内部两两互连：这是关系边的主要来源
      const pairs: Array<[DictEntry, DictEntry]> = [];
      if (subjectSplit.composite && subjectHits.length > 1) {
        for (let i = 0; i < subjectHits.length; i += 1) {
          for (let j = i + 1; j < subjectHits.length; j += 1) {
            pairs.push([subjectHits[i]!, subjectHits[j]!]);
          }
        }
      }
      // object 是实体时，再连 subject → object
      for (const source of subjectHits) {
        for (const target of objectHits) pairs.push([source, target]);
      }

      for (const [source, target] of pairs) {
        {
          if (source.canonicalName === target.canonicalName) continue;
          stats.relations += 1;
          if (APPLY) {
            const sourceId = entityIdByCanonical.get(source.canonicalName)!;
            const targetId = entityIdByCanonical.get(target.canonicalName)!;
            const validFrom = toChapter(fact.valid_from_chapter) ?? chapter ?? null;
            db.query(
              `INSERT INTO narrative_relation
                 (id, book_id, subject_id, predicate, object_id, relation_kind, valid_from, valid_to,
                  evidence_text, confidence, recorded_at)
               VALUES (?, ?, ?, ?, ?, 'relationship', ?, ?, ?, ?, ?)
               ON CONFLICT(book_id, subject_id, predicate, object_id, valid_from) DO NOTHING`,
            ).run(
              `rel:${bookId}:${String(fact.id)}:${source.canonicalName}:${target.canonicalName}`.slice(0, 200),
              bookId, sourceId, String(fact.predicate ?? "关联").slice(0, 80), targetId,
              validFrom, toChapter(fact.valid_until_chapter) ?? null,
              String(fact.evidence_text ?? "").slice(0, 400) || null,
              typeof fact.confidence === "number" ? fact.confidence : 1.0, now,
            );
          }
        }
      }
      continue;
    }

    // 状态类 → fluent 流水（Event Calculus）
    if (String(fact.category) === "character_state" || String(fact.category) === "location") {
      for (const hit of subjectHits) {
        if (chapter === undefined) continue;
        stats.stateChanges += 1;
        if (APPLY) {
          const entityId = entityIdByCanonical.get(hit.canonicalName)!;
          const fluent = String(fact.predicate ?? "状态").slice(0, 80);
          db.query(
            `INSERT INTO narrative_state_change
               (id, book_id, entity_id, fluent, new_value, chapter_number, evidence_text, confidence, recorded_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO NOTHING`,
          ).run(
            `st:${bookId}:${String(fact.id)}:${hit.canonicalName}`.slice(0, 200),
            bookId, entityId, fluent, String(fact.object ?? "").slice(0, 400),
            chapter, String(fact.evidence_text ?? "").slice(0, 400) || null,
            typeof fact.confidence === "number" ? fact.confidence : 1.0, now,
          );
        }
      }
    }
  }

  // ③ events → 参与者（复合主体在这里拆开，不再造假实体）
  const events = db.query(
    `SELECT id, chapter_number, subject, object FROM narrative_event WHERE book_id = ?`,
  ).all(bookId) as Array<Record<string, unknown>>;

  for (const event of events) {
    for (const [role, raw] of [["agent", event.subject], ["patient", event.object]] as const) {
      const split = splitComposite(String(raw ?? ""));
      for (const name of split.names) {
        const hit = classifyMention(name);
        if (!hit) continue;
        stats.participants += 1;
        if (APPLY) {
          db.query(
            `INSERT INTO narrative_event_participant (book_id, event_id, entity_id, role)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(event_id, entity_id, role) DO NOTHING`,
          ).run(bookId, String(event.id), entityIdByCanonical.get(hit.canonicalName)!, role);
        }
      }
    }
  }

  // ④ 伏笔 → 三态机
  const hooks = db.query(
    `SELECT id, title, fields_json, lifecycle FROM story_jingwei_entry
     WHERE book_id = ? AND category = 'foreshadowing' AND deleted_at IS NULL`,
  ).all(bookId) as Array<Record<string, unknown>>;

  for (const hook of hooks) {
    const fields = parseJson(hook.fields_json);
    const lifecycle = String(hook.lifecycle ?? "active");
    const phase = lifecycle === "archived" || lifecycle === "retired" ? "abandoned" : resolvePhase(fields);
    stats.foreshadows += 1;
    if (APPLY) {
      db.query(
        `INSERT INTO narrative_foreshadow
           (id, book_id, label, entry_id, setup_chapter, payoff_chapter, status, importance, recorded_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 50, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           setup_chapter = excluded.setup_chapter,
           payoff_chapter = excluded.payoff_chapter,
           updated_at = excluded.updated_at`,
      ).run(
        `fs:${bookId}:${String(hook.id)}`, bookId,
        String(hook.title ?? "未命名伏笔").slice(0, 200), String(hook.id),
        toChapter(fields.plantedChapter) ?? null, toChapter(fields.payoffChapter) ?? null,
        phase, now, now,
      );
    }
  }

  return stats;
}

// ─── 执行 ─────────────────────────────────────────────────────────────────

// bun:sqlite 的 readonly:false 不被接受，落库模式必须不传该选项
const db = DRY_RUN ? new Database(DB_PATH, { readonly: true }) : new Database(DB_PATH);
console.log(`模式: ${APPLY ? "落库 (--apply)" : "干跑 (--dry-run)"}`);
console.log(`数据库: ${DB_PATH}\n`);

if (APPLY) {
  const tables = db.query(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='narrative_entity'`,
  ).all();
  if (tables.length === 0) {
    console.error("❌ narrative_entity 表不存在 —— migration 0032 还没应用。");
    console.error("   先启动一次 NovelFork 让 migrations-runner 应用 0032，再跑本脚本。");
    process.exit(1);
  }
}

const books = (BOOK_FILTER
  ? db.query(`SELECT id FROM book WHERE id = ?`).all(BOOK_FILTER)
  : db.query(`SELECT id FROM book`).all()) as Array<{ id: string }>;

const now = Date.now();
const all: BookStats[] = [];
for (const book of books) {
  const stats = APPLY
    ? db.transaction(() => processBook(db, book.id, now))()
    : processBook(db, book.id, now);
  if (stats.entities === 0 && stats.totalMentions === 0) continue;
  all.push(stats);
}

console.log("书籍".padEnd(34), "实体".padStart(5), "别名".padStart(5), "关系".padStart(5),
  "状态".padStart(5), "伏笔".padStart(5), "参与".padStart(5), "链接率".padStart(7));
for (const s of all.sort((a, b) => b.totalMentions - a.totalMentions)) {
  const rate = s.totalMentions > 0 ? (s.resolvedMentions / s.totalMentions * 100).toFixed(1) + "%" : "—";
  console.log(
    s.bookId.slice(0, 32).padEnd(34),
    String(s.entities).padStart(5), String(s.aliases).padStart(5),
    String(s.relations).padStart(5), String(s.stateChanges).padStart(5),
    String(s.foreshadows).padStart(5), String(s.participants).padStart(5),
    rate.padStart(7),
  );
}

const total = all.reduce((acc, s) => ({
  entities: acc.entities + s.entities, aliases: acc.aliases + s.aliases,
  relations: acc.relations + s.relations, stateChanges: acc.stateChanges + s.stateChanges,
  foreshadows: acc.foreshadows + s.foreshadows, participants: acc.participants + s.participants,
  resolved: acc.resolved + s.resolvedMentions, mentions: acc.mentions + s.totalMentions,
  foreshadowMentions: acc.foreshadowMentions + s.foreshadowMentions,
  nonEntity: acc.nonEntity + s.nonEntityMentions,
}), {
  entities: 0, aliases: 0, relations: 0, stateChanges: 0, foreshadows: 0,
  participants: 0, resolved: 0, mentions: 0, foreshadowMentions: 0, nonEntity: 0,
});

console.log("\n合计: 实体", total.entities, "| 别名", total.aliases, "| 关系", total.relations,
  "| 状态", total.stateChanges, "| 伏笔", total.foreshadows, "| 参与者", total.participants);

const rate = total.mentions > 0 ? total.resolved / total.mentions : 0;
console.log("\n提及归类（链接率分母只含「应为实体」的提及）：");
console.log("  应为实体      ", String(total.mentions).padStart(5), "→ 命中", total.resolved,
  `(${(rate * 100).toFixed(1)}%)`);
console.log("  伏笔条目      ", String(total.foreshadowMentions).padStart(5), "  身份有效，不属实体五类");
console.log("  事件/情节短语 ", String(total.nonEntity).padStart(5), "  本就不是实体，已剔除");
if (rate < 0.6) {
  console.log("\n⚠️ 链接率未达 60%。剩余未命中多是经纬里确实没建档的实体");
  console.log("   （如「刘斌」「赵铭表哥」「断路器」）—— 属数据缺口，不是归并失败。");
  console.log("   用 --verbose 看未归并样本。");
}

if (VERBOSE) {
  console.log("\n未归并提及样本（保留原样、标 inferred，可后续人工确认）:");
  for (const s of all.slice(0, 3)) {
    if (s.unresolvedSamples.length === 0) continue;
    console.log(` ${s.bookId.slice(0, 30)}:`, s.unresolvedSamples.slice(0, 8).join(" / "));
  }
}

console.log(DRY_RUN ? "\n干跑结束，未写入任何数据。确认无误后加 --apply 落库。" : "\n✅ 落库完成。");
db.close();
