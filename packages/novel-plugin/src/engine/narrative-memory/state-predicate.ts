/**
 * 状态谓词归一（场景校验 S1）。
 *
 * 结算抽取的谓词是模型自由写的：同一个「死了」会写成 身亡 / 阵亡 / 殒命……
 * 状态槽按「主体 + 谓词」区分，谓词写法不统一时，后来的「复活」盖不住先前的「身亡」，
 * 状态流水里也会出现好几个说的是同一件事的方面。这里把三类硬状态的同义谓词确定性地
 * 映射到固定槽位，并把取值收敛成固定词：
 *
 *   生死：存活 / 死亡 / 复活
 *   去向：离场 / 回归
 *   所在：地点名（原样保留，由实体字典归并）
 *
 * 只按谓词精确匹配（去掉首尾空白与结尾的「了」），不做模糊猜测；匹配不上的谓词原样保留。
 * 生死 / 去向 只对人物状态类（character_state）生效；所在 对位置类与人物状态类都生效，
 * 槽位统一记在 location 类下，让两类写法互相覆盖。
 */

export const LIFE_SLOT = "生死";
export const DEPARTURE_SLOT = "去向";
export const LOCATION_SLOT = "所在";

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
];

/** 归一会影响的全部谓词（存量 slot_key 回填只需要看这些行）。 */
export const NORMALIZED_STATE_PREDICATES: readonly string[] = [
  ...Object.keys(LIFE_PREDICATE_SYNONYMS),
  ...Object.keys(DEPARTURE_PREDICATE_SYNONYMS),
  ...LIFE_SLOT_NAMES,
  ...DEPARTURE_SLOT_NAMES,
  ...LOCATION_PREDICATE_SYNONYMS,
];

export interface NormalizedStateFact {
  readonly slot: StateSlot;
  /** 槽位所在的记忆类别：生死 / 去向 记在 character_state，所在 记在 location。 */
  readonly category: "character_state" | "location";
  /** 归一后的取值：生死 / 去向 为固定词（object 认不出时保留原文），所在 为地点原文。 */
  readonly value: string;
}

function cleanWord(value: string): string {
  return value.replace(/\s+/gu, "").replace(/了$/u, "");
}

function valueFromObject(object: string, synonyms: Readonly<Record<string, string>>): string {
  const word = cleanWord(object);
  return synonyms[word] ?? object.trim();
}

/**
 * 把一条状态事实归一到固定槽位；不属于三类硬状态时返回 null（调用方保持原谓词）。
 * 纯函数，只看类别、谓词与对象。
 */
export function normalizeStateFact(fact: { readonly category: string; readonly predicate: string; readonly object: string }): NormalizedStateFact | null {
  const category = fact.category.trim().toLowerCase();
  if (category !== "character_state" && category !== "location") return null;
  const predicate = cleanWord(fact.predicate);
  if (!predicate) return null;
  if (LOCATION_PREDICATE_SYNONYMS.includes(predicate)) {
    const place = fact.object.trim();
    return place ? { slot: LOCATION_SLOT, category: "location", value: place } : null;
  }
  if (category !== "character_state") return null;
  const life = LIFE_PREDICATE_SYNONYMS[predicate];
  if (life) return { slot: LIFE_SLOT, category: "character_state", value: life };
  if (LIFE_SLOT_NAMES.includes(predicate)) {
    return { slot: LIFE_SLOT, category: "character_state", value: valueFromObject(fact.object, LIFE_PREDICATE_SYNONYMS) };
  }
  const departure = DEPARTURE_PREDICATE_SYNONYMS[predicate];
  if (departure) return { slot: DEPARTURE_SLOT, category: "character_state", value: departure };
  if (DEPARTURE_SLOT_NAMES.includes(predicate)) {
    return { slot: DEPARTURE_SLOT, category: "character_state", value: valueFromObject(fact.object, DEPARTURE_PREDICATE_SYNONYMS) };
  }
  return null;
}
