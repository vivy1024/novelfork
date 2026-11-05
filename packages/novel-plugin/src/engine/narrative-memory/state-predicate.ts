/**
 * 状态谓词归一（场景校验 S1 + 状态槽受控词表）。
 *
 * 结算抽取的谓词是模型自由写的：同一个「死了」会写成 身亡 / 阵亡 / 殒命……，
 * 同一个「在哪」会写成 所在位置 / 本章所在位置 / 本章主要活动位置。
 * 状态槽按「主体 + 谓词」区分，谓词写法不统一时，后来的新值盖不住先前的旧值，
 * 长书里同一属性会挂着好几条「当前值」。这里把常见状态属性的同义谓词确定性地映射到固定槽位：
 *
 *   生死：存活 / 死亡 / 复活（取值收敛成固定词）
 *   去向：离场 / 回归（取值收敛成固定词）
 *   所在：地点名（原样保留，由实体字典归并）
 *   境界、所属、身份、伤势、情绪：取值看 object
 *   与X的关系、对X的态度：按对方分槽，取值看 object
 *   持有：一件物品一个槽（多值），获得 / 失去 同槽互相覆盖
 *
 * 匹配只做确定性规则：去掉空白、括注、句尾「了 / 为 / 变为」等，再剥掉「本章 / 当前 / 主要」这类修饰前缀，
 * 剥完必须精确命中词表才算；对不上的谓词原样保留（宁可不并，不可错并）。
 * 所在 对位置类与人物状态类都生效，槽位统一记在 location 类下；其余只对人物状态类（character_state）生效。
 */

export const LIFE_SLOT = "生死";
export const DEPARTURE_SLOT = "去向";
export const LOCATION_SLOT = "所在";
export const REALM_SLOT = "境界";
export const AFFILIATION_SLOT = "所属";
export const IDENTITY_SLOT = "身份";
export const INJURY_SLOT = "伤势";
export const EMOTION_SLOT = "情绪";
export const POSSESSION_SLOT = "持有";

/** 三类硬状态（场景校验只看这三类）。 */
export type StateSlot = typeof LIFE_SLOT | typeof DEPARTURE_SLOT | typeof LOCATION_SLOT;

export const LIFE_ALIVE = "存活";
export const LIFE_DEAD = "死亡";
export const LIFE_REVIVED = "复活";
export const DEPARTURE_LEFT = "离场";
export const DEPARTURE_RETURNED = "回归";

/** 同义谓词表：谓词 → 槽位与固定取值。键是谓词本身，取值为空表示「槽位名」，取值看 object。 */
export const LIFE_PREDICATE_SYNONYMS: Readonly<Record<string, string>> = {
  死亡: LIFE_DEAD,
  身亡: LIFE_DEAD,
  阵亡: LIFE_DEAD,
  殒命: LIFE_DEAD,
  毙命: LIFE_DEAD,
  死去: LIFE_DEAD,
  断气: LIFE_DEAD,
  丧命: LIFE_DEAD,
  身死: LIFE_DEAD,
  战死: LIFE_DEAD,
  遇害: LIFE_DEAD,
  气绝: LIFE_DEAD,
  去世: LIFE_DEAD,
  逝世: LIFE_DEAD,
  病逝: LIFE_DEAD,
  存活: LIFE_ALIVE,
  生还: LIFE_ALIVE,
  幸存: LIFE_ALIVE,
  复活: LIFE_REVIVED,
  复生: LIFE_REVIVED,
  死而复生: LIFE_REVIVED,
  起死回生: LIFE_REVIVED,
  还魂: LIFE_REVIVED,
};

export const DEPARTURE_PREDICATE_SYNONYMS: Readonly<Record<string, string>> = {
  离场: DEPARTURE_LEFT,
  离开: DEPARTURE_LEFT,
  出走: DEPARTURE_LEFT,
  远行: DEPARTURE_LEFT,
  离去: DEPARTURE_LEFT,
  退场: DEPARTURE_LEFT,
  远走: DEPARTURE_LEFT,
  回归: DEPARTURE_RETURNED,
  归来: DEPARTURE_RETURNED,
  返回: DEPARTURE_RETURNED,
  回来: DEPARTURE_RETURNED,
  重返: DEPARTURE_RETURNED,
};

/** 槽位名本身（及其常见写法）：取值从 object 读。 */
export const LIFE_SLOT_NAMES: readonly string[] = [LIFE_SLOT, "存亡", "生死状态", "生命状态", "存活状态"];
export const DEPARTURE_SLOT_NAMES: readonly string[] = [DEPARTURE_SLOT, "行踪", "下落"];
export const LOCATION_PREDICATE_SYNONYMS: readonly string[] = [
  LOCATION_SLOT, "位于", "身在", "到达", "抵达", "来到", "身处", "处于", "所在地", "位置", "当前位置", "当前地点",
  "所在位置", "所在地点", "所处位置", "所处地点", "所处", "地点", "回到", "位置变化", "位置变动",
];

/** 取值看 object 的单值槽：谓词同义词（剥修饰后精确匹配）。 */
export const VALUE_SLOT_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  [REALM_SLOT]: [
    REALM_SLOT, "修为", "修为境界", "修炼境界", "境界等级", "修为等级", "修炼等级", "实力境界", "境界层次",
    "突破至", "突破到", "晋入", "晋升境界", "境界提升", "修为提升",
  ],
  [AFFILIATION_SLOT]: [
    AFFILIATION_SLOT, "所属势力", "所属门派", "所属宗门", "所属阵营", "所属组织", "阵营", "势力归属", "门派归属",
    "归属", "隶属", "隶属于", "效力于", "投靠", "加入势力", "加入门派", "加入宗门",
  ],
  [IDENTITY_SLOT]: [IDENTITY_SLOT, "职位", "职务", "头衔", "称号", "官职", "职业", "身份地位"],
  [INJURY_SLOT]: [INJURY_SLOT, "伤情", "受伤情况", "伤势状态", "身体状况", "身体状态", "健康状况", "健康状态"],
  [EMOTION_SLOT]: [EMOTION_SLOT, "情绪状态", "心情", "心态", "心理状态", "精神状态"],
};

/** 持有类：一件物品一个槽（object 是物品），获得 / 失去 同槽，谓词本身就是取值，不改写。 */
export const POSSESSION_PREDICATES: readonly string[] = [
  POSSESSION_SLOT, "拥有", "获得", "得到", "携带", "佩戴", "失去", "丢失", "遗失", "交出",
];

/** 修饰前缀：剥掉后再查词表。「真实 / 公开 / 隐藏」这类会改变属性含义的词不在此列。 */
const MODIFIER_PREFIXES: readonly string[] = [
  "本章", "本回", "此章", "当前", "目前", "现在", "此时", "眼下", "如今", "最新", "最终", "现",
  "主要", "人物", "角色", "个人", "自身", "活动",
];

/** 句尾虚词与「变化」类后缀。 */
const TRAILING_SUFFIXES: readonly string[] = ["更新为", "变为", "变成", "改为", "情况", "了", "为", "是"];

/** 抽取 prompt 用：受控谓词清单（一属性一写法）。 */
export const CANONICAL_STATE_PREDICATES: readonly string[] = [
  LOCATION_SLOT, REALM_SLOT, LIFE_SLOT, DEPARTURE_SLOT, AFFILIATION_SLOT, IDENTITY_SLOT, INJURY_SLOT, EMOTION_SLOT,
  POSSESSION_SLOT, "与X的关系", "对X的态度",
];

/** 归一会影响的全部谓词（存量 slot_key 回填只需要看这些行）。 */
export const NORMALIZED_STATE_PREDICATES: readonly string[] = [
  ...Object.keys(LIFE_PREDICATE_SYNONYMS),
  ...Object.keys(DEPARTURE_PREDICATE_SYNONYMS),
  ...LIFE_SLOT_NAMES,
  ...DEPARTURE_SLOT_NAMES,
  ...LOCATION_PREDICATE_SYNONYMS,
  ...Object.values(VALUE_SLOT_SYNONYMS).flat(),
  ...POSSESSION_PREDICATES,
];

export interface NormalizedStateFact {
  readonly slot: StateSlot;
  /** 槽位所在的记忆类别：生死 / 去向 记在 character_state，所在 记在 location。 */
  readonly category: "character_state" | "location";
  /** 归一后的取值：生死 / 去向 为固定词（object 认不出时保留原文），所在 为地点原文。 */
  readonly value: string;
}

export interface CanonicalStatePredicate {
  /** 规范槽位名（也是改写后的谓词）：如 所在 / 境界 / 与韩立的关系。 */
  readonly slot: string;
  readonly category: "character_state" | "location";
  /** 归一后的取值。 */
  readonly value: string;
  /** 多值槽（持有）：槽位按 object 再细分。 */
  readonly multiValued: boolean;
  /**
   * 写入时可把谓词改写成 slot：取值完全在 object 里、改写不丢信息时为 true。
   * 生死 / 去向 / 持有 的谓词本身带着取值（身亡、失去），只并槽、不改写。
   */
  readonly rewritePredicate: boolean;
}

function cleanWord(value: string): string {
  return value.replace(/\s+/gu, "").replace(/了$/u, "");
}

function stripParenthetical(value: string): string {
  return value.replace(/[（(][^（）()]*[）)]$/u, "");
}

/**
 * 原词 → 剥去括注 / 句尾虚词 / 修饰前缀后的全部候选。
 * 按长度降序（剥得越少越靠前），原词优先：「修为」不会被剥成「修」，「当前修为」能命中「修为」。
 */
function predicateCandidates(raw: string): string[] {
  const start = cleanWord(raw);
  if (!start) return [];
  const seen = new Set<string>([start]);
  const queue = [start];
  while (queue.length > 0 && seen.size < 64) {
    const word = queue.shift()!;
    const next: string[] = [stripParenthetical(word)];
    for (const suffix of TRAILING_SUFFIXES) {
      if (word.length > suffix.length && word.endsWith(suffix)) next.push(word.slice(0, -suffix.length));
    }
    for (const prefix of MODIFIER_PREFIXES) {
      if (word.length > prefix.length && word.startsWith(prefix)) next.push(word.slice(prefix.length));
    }
    for (const candidate of next) {
      if (!candidate || seen.has(candidate)) continue;
      seen.add(candidate);
      queue.push(candidate);
    }
  }
  return [...seen].sort((left, right) => right.length - left.length);
}

function valueFromObject(object: string, synonyms: Readonly<Record<string, string>>): string {
  const word = cleanWord(object);
  return synonyms[word] ?? object.trim();
}

const RELATION_TO_PATTERN = /^(?:与|和|跟|同)(.{1,16}?)(?:之间)?的?(?:关系|关系状态)$/u;
const ATTITUDE_TO_PATTERN = /^(?:对|对待)(.{1,16}?)的?(?:态度|看法|印象|观感|好感|好感度)$/u;

function matchValueSlot(word: string): string | undefined {
  for (const [slot, synonyms] of Object.entries(VALUE_SLOT_SYNONYMS)) {
    if (synonyms.includes(word)) return slot;
  }
  return undefined;
}

function canonicalizeWord(
  word: string,
  category: "character_state" | "location",
  object: string,
): CanonicalStatePredicate | null {
  if (LOCATION_PREDICATE_SYNONYMS.includes(word)) {
    const place = object.trim();
    return place ? { slot: LOCATION_SLOT, category: "location", value: place, multiValued: false, rewritePredicate: true } : null;
  }
  if (category !== "character_state") return null;
  const life = LIFE_PREDICATE_SYNONYMS[word];
  if (life) return { slot: LIFE_SLOT, category: "character_state", value: life, multiValued: false, rewritePredicate: false };
  if (LIFE_SLOT_NAMES.includes(word)) {
    return { slot: LIFE_SLOT, category: "character_state", value: valueFromObject(object, LIFE_PREDICATE_SYNONYMS), multiValued: false, rewritePredicate: false };
  }
  const departure = DEPARTURE_PREDICATE_SYNONYMS[word];
  if (departure) return { slot: DEPARTURE_SLOT, category: "character_state", value: departure, multiValued: false, rewritePredicate: false };
  if (DEPARTURE_SLOT_NAMES.includes(word)) {
    return { slot: DEPARTURE_SLOT, category: "character_state", value: valueFromObject(object, DEPARTURE_PREDICATE_SYNONYMS), multiValued: false, rewritePredicate: false };
  }
  const valueSlot = matchValueSlot(word);
  if (valueSlot) {
    const value = object.trim();
    return value ? { slot: valueSlot, category: "character_state", value, multiValued: false, rewritePredicate: true } : null;
  }
  if (POSSESSION_PREDICATES.includes(word)) {
    const item = object.trim();
    return item ? { slot: POSSESSION_SLOT, category: "character_state", value: word, multiValued: true, rewritePredicate: false } : null;
  }
  const relation = word.match(RELATION_TO_PATTERN)?.[1];
  if (relation) {
    const value = object.trim();
    return value ? { slot: `与${relation}的关系`, category: "character_state", value, multiValued: false, rewritePredicate: true } : null;
  }
  const attitude = word.match(ATTITUDE_TO_PATTERN)?.[1];
  if (attitude) {
    const value = object.trim();
    return value ? { slot: `对${attitude}的态度`, category: "character_state", value, multiValued: false, rewritePredicate: true } : null;
  }
  return null;
}

/**
 * 把一条状态事实归一到受控槽位；不属于词表时返回 null（调用方保持原谓词）。
 * 纯函数，只看类别、谓词与对象。
 */
export function canonicalizeStatePredicate(fact: { readonly category: string; readonly predicate: string; readonly object: string }): CanonicalStatePredicate | null {
  const category = fact.category.trim().toLowerCase();
  if (category !== "character_state" && category !== "location") return null;
  for (const word of predicateCandidates(fact.predicate)) {
    const hit = canonicalizeWord(word, category, fact.object);
    if (hit) return hit;
  }
  return null;
}

/** 写入用谓词：能无损改写成规范槽位名时改写，否则保留原谓词（只去首尾空白）。 */
export function canonicalFactPredicate(fact: { readonly category: string; readonly predicate: string; readonly object: string }): string {
  const hit = canonicalizeStatePredicate(fact);
  return hit?.rewritePredicate ? hit.slot : fact.predicate.trim();
}

/**
 * 三类硬状态（生死 / 去向 / 所在）的归一；其它槽位返回 null。
 * 场景校验与实体索引的状态流水只认这三类的固定方面名。
 */
export function normalizeStateFact(fact: { readonly category: string; readonly predicate: string; readonly object: string }): NormalizedStateFact | null {
  const hit = canonicalizeStatePredicate(fact);
  if (!hit) return null;
  if (hit.slot !== LIFE_SLOT && hit.slot !== DEPARTURE_SLOT && hit.slot !== LOCATION_SLOT) return null;
  return { slot: hit.slot, category: hit.category, value: hit.value };
}
