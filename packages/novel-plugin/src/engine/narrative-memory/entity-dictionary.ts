/**
 * 实体字典 —— 经纬条目与叙事记忆之间的身份链。
 *
 * 解决的问题：经纬条目标题常带装饰后缀（「薛行之（主角权威统一版·立场修正版）」），
 * 而叙事记忆结算出的 subject/object 是正文称呼（「薛行之」「薛小爷」），两边
 * 从未有过 ID 级关联，全靠字符串碰运气。本模块提供：
 *
 * 1. buildEntityDictionary：从经纬全实体类目构建 {entryId, canonicalName, lookupKeys} 字典；
 *    lookupKeys 采用 Openwrite shared_document_lookup_keys 的成熟结构：
 *    标题/字段名/别名 + 每项的剥括号展开 + casefold 归一化去重。
 * 2. resolveEntity：把任意原始称呼解析回字典条目（归一化身份链的查询端）。
 * 3. formatEntityDictionaryForPrompt：把字典渲染成结算器 prompt 名单（OpenViking 式
 *    "实体名单"约束——LLM 只从名单中选名，写入端再归一化回 canonical）。
 */

import type { StorageDatabase } from "@vivy1024/novelfork-core";

/** 参与身份链的经纬实体类目（characters/locations/factions/props/foreshadowing）。 */
export const ENTITY_DICTIONARY_CATEGORIES: readonly string[] = [
  "characters",
  "locations",
  "factions",
  "props",
  "foreshadowing",
];

export interface EntityDictionaryEntry {
  /** 经纬条目 id（story_jingwei_entry.id），叙事记忆事件回填 entity_entry_id 用。 */
  readonly entryId: string;
  readonly category: string;
  /** 权威短名：标题剥离括号装饰后的版本（「薛行之（主角权威统一版）」→「薛行之」）。 */
  readonly canonicalName: string;
  /** 原始档案标题（含装饰），prompt 展示用。 */
  readonly title: string;
  /** 全部可识别称呼（已含剥括号展开），归一化匹配用。 */
  readonly lookupKeys: readonly string[];
}

export interface EntityDictionary {
  readonly bookId: string;
  readonly entries: readonly EntityDictionaryEntry[];
  /** normalized key → entry 的索引；resolveEntity 的 O(1) 查询层。 */
  readonly index: ReadonlyMap<string, EntityDictionaryEntry>;
}

/** 剥离尾部括号装饰：「薛行之（主角权威统一版·立场修正版）」→「薛行之」。 */
export function stripParentheticalSuffix(value: string): string {
  return value.replace(/\s*[（(][^()（）]+[)）]\s*$/u, "").trim();
}

/** 匹配归一化：空白折叠 + casefold，中文不受影响、英文大小写不敏感。 */
function normalizeLookupKey(value: string): string {
  return value.replace(/\s+/gu, " ").trim().toLocaleLowerCase();
}

/** fields_json 里常见的别名字段名（按类目略有差异，全部尝试）。 */
const ALIAS_FIELD_KEYS = ["aliases", "别名"] as const;

function readFieldAliases(fields: Record<string, unknown> | undefined): string[] {
  if (!fields) return [];
  const out: string[] = [];
  for (const key of ALIAS_FIELD_KEYS) {
    const value = fields[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" && item.trim()) out.push(item.trim());
      }
    } else if (typeof value === "string" && value.trim()) {
      // 兼容 "A / B / C"、"A，B"、换行分隔的字符串形态
      for (const part of value.split(/[/,，、\n]/u)) {
        const trimmed = part.trim();
        if (trimmed) out.push(trimmed);
      }
    }
  }
  return out;
}

/** 为单个条目生成全部候选称呼（title/name/aliases + 各自剥括号展开，去重保序）。 */
export function expandEntityLookupKeys(input: {
  title: string;
  fields?: Record<string, unknown> | undefined;
}): string[] {
  const seeds = [input.title];
  const fieldName = input.fields?.name;
  if (typeof fieldName === "string" && fieldName.trim()) seeds.push(fieldName.trim());
  seeds.push(...readFieldAliases(input.fields));

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
    const norm = normalizeLookupKey(key);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    deduped.push(key);
  }
  return deduped;
}

interface JingweiEntryRowLike {
  id: string;
  category: string;
  title: string;
  fields_json?: string | null;
}

/** 从 story_jingwei_entry 表读取实体条目行（只取身份链需要的最小列）。 */
function loadEntityRows(storage: StorageDatabase, bookId: string): readonly JingweiEntryRowLike[] {
  try {
    const placeholders = ENTITY_DICTIONARY_CATEGORIES.map(() => "?").join(", ");
    return storage.sqlite.prepare(
      `SELECT id, category, title, fields_json
       FROM story_jingwei_entry
       WHERE book_id = ? AND category IN (${placeholders})
         AND deleted_at IS NULL`,
    ).all(bookId, ...ENTITY_DICTIONARY_CATEGORIES) as JingweiEntryRowLike[];
  } catch {
    // 表尚未建好（旧书首次打开）等情况：返回空字典，调用方按无字典降级。
    return [];
  }
}

/**
 * 构建本书实体字典。字典为空时结算器跳过注入与归一化（行为与旧版一致），
 * 因此本函数失败/为空都不会阻断写作或结算主流程。
 */
export function buildEntityDictionary(storage: StorageDatabase, bookId: string): EntityDictionary {
  const rows = loadEntityRows(storage, bookId);
  const entries: EntityDictionaryEntry[] = [];
  const index = new Map<string, EntityDictionaryEntry>();

  for (const row of rows) {
    let fields: Record<string, unknown> | undefined;
    try {
      fields = row.fields_json ? (JSON.parse(row.fields_json) as Record<string, unknown>) : undefined;
    } catch {
      fields = undefined;
    }
    const title = row.title.trim();
    if (!title) continue;
    const lookupKeys = expandEntityLookupKeys({ title, fields });
    if (lookupKeys.length === 0) continue;
    const canonicalName = stripParentheticalSuffix(title) || title;
    const entry: EntityDictionaryEntry = {
      entryId: row.id,
      category: row.category,
      canonicalName,
      title,
      lookupKeys,
    };
    entries.push(entry);
    for (const key of lookupKeys) {
      const norm = normalizeLookupKey(key);
      if (norm && !index.has(norm)) index.set(norm, entry);
    }
  }

  return { bookId, entries, index };
}

export interface EntityResolution {
  readonly entry: EntityDictionaryEntry;
  /** 命中所用的原始称呼（归一化前的输入值）。 */
  readonly matchedRaw: string;
}

/** 把任意原始称呼解析回字典条目；未命中返回 null（调用方保持原文，不强行改写）。 */
export function resolveEntity(dictionary: EntityDictionary | undefined, rawName: string): EntityResolution | null {
  const trimmed = rawName?.trim();
  if (!dictionary || !trimmed) return null;
  const direct = dictionary.index.get(normalizeLookupKey(trimmed));
  if (direct) return { entry: direct, matchedRaw: trimmed };
  // 兜底再剥一次括号（输入本身可能带装饰）。
  const stripped = stripParentheticalSuffix(trimmed);
  if (stripped && stripped !== trimmed) {
    const hit = dictionary.index.get(normalizeLookupKey(stripped));
    if (hit) return { entry: hit, matchedRaw: trimmed };
  }
  return null;
}

/**
 * 把字典渲染成结算器 prompt 的官方实体名单块。
 * 每行：canonicalName（类别）· 可用称呼: a/b/c —— 控制在合理长度内避免吃掉 token 预算。
 */
export function formatEntityDictionaryForPrompt(dictionary: EntityDictionary | undefined, maxEntries = 80): string {
  if (!dictionary || dictionary.entries.length === 0) return "";
  const lines: string[] = [];
  for (const entry of dictionary.entries.slice(0, maxEntries)) {
    const aliasPart = entry.lookupKeys
      .filter((key) => normalizeLookupKey(key) !== normalizeLookupKey(entry.canonicalName))
      .slice(0, 4)
      .join("/");
    lines.push(aliasPart ? `- ${entry.canonicalName}（${entry.category}；又称: ${aliasPart}）` : `- ${entry.canonicalName}（${entry.category}）`);
  }
  const header = "本书官方实体名单（subject/object 必须优先使用下列名字；新登场且不在名单中的实体可用正文原名称）：";
  return `${header}\n${lines.join("\n")}`;
}
