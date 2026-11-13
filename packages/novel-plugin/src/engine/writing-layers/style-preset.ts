import { z } from "zod";

/** 预设保存写法与来源证据；人物、世界和剧情事实仍归经纬。 */
const text = z.string().trim().min(1).max(4_000);
const reviewed = {
  evidence: text,
  transfer: z.enum(["transferable", "source-only"]),
  status: z.enum(["needs-review", "confirmed"]),
};

export const STYLE_SCENE_TYPES = ["dialogue", "action", "description", "interiority", "transition", "general"] as const;
/** 与蒸馏规则类别同一份枚举（style-distillation.ts 的 STYLE_RULE_CATEGORIES）；这里单列是为了不让前端引入蒸馏的服务端依赖。 */
export const STYLE_GUIDE_RULE_CATEGORIES = ["voice", "language", "rhythm", "dialogue", "scene", "consistency", "general"] as const;

export const StyleFingerprintSchema = z.object({
  avgSentenceLength: z.number().finite().nonnegative(),
  sentenceLengthStdDev: z.number().finite().nonnegative(),
  vocabularyDiversity: z.number().min(0).max(1),
  dialogueRatio: z.number().min(0).max(1).optional(),
}).passthrough();

export const StylePresetSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().trim().min(1).max(120),
  generalRules: z.array(text).max(50),
  sources: z.array(z.object({
    id: z.string().trim().min(1).max(120),
    title: z.string().trim().min(1).max(200),
    role: z.enum(["primary_voice", "register_overlay"]).optional(),
    triggerTags: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
    forbiddenSourceTerms: z.array(z.string().trim().min(1).max(120)).max(200).optional(),
    rules: z.array(z.object({
      text,
      doExample: text.optional(),
      dontExample: text.optional(),
      ...reviewed,
      /** 写法类别（蒸馏规则带出；手写与旧规则没有，按综合计）。合成指南按类别限条数。 */
      category: z.enum(STYLE_GUIDE_RULE_CATEGORIES).optional(),
      /** 证据吻合程度（蒸馏规则带出；没有时按高看待）。合成指南同类别内高置信优先。 */
      confidence: z.enum(["high", "medium", "low"]).optional(),
    }).strict()).max(100),
    samples: z.array(z.object({
      id: z.string().trim().min(1).max(120),
      sceneType: z.enum(STYLE_SCENE_TYPES),
      registerTag: z.enum(["dialogue_banter", "institution_exploitation", "bill_inventory", "combat_counter", "ancient_scripture", "general"]).optional(),
      text,
      ...reviewed,
    }).strict()).max(100),
  }).strict()).max(30),
  bookVoice: z.object({
    tone: z.string().trim().max(4_000),
    narrativeVoice: z.string().trim().max(4_000),
    principles: z.array(text).max(50),
  }).strict(),
  /** 作者硬约束：随「交叙述者人文化」与划词人文化注入，逐项优先于手法说明；不进合成指南。 */
  customConstraints: z.array(z.string().trim().min(1).max(200)).max(30).default([]),
  consolidatedRules: z.array(z.object({
    id: z.string().trim().min(1).max(120), category: z.string().trim().max(120).optional(), rule: text,
    doExample: text.optional(), dontExample: text.optional(), sourceIds: z.array(z.string().trim().min(1).max(120)).max(30),
  }).strict()).max(12).optional(),
  registerGuardrail: z.object({
    enabled: z.boolean().optional(),
    allowedAsciiAcronyms: z.array(z.string().trim().min(1).max(120)).max(200).optional(),
    extraForbiddenTerms: z.array(z.string().trim().min(1).max(120)).max(200).optional(),
  }).strict().optional(),
  fingerprint: StyleFingerprintSchema.nullable(),
}).strict().superRefine((preset, ctx) => {
  if (preset.sources.filter((source) => source.role === "primary_voice").length > 1) {
    ctx.addIssue({ code: "custom", path: ["sources"], message: "主文风来源最多只能设 1 个，其余来源请设为局部语域插件 register_overlay" });
  }
  const ids = new Set<string>();
  preset.sources.forEach((source, index) => {
    if (ids.has(source.id)) ctx.addIssue({ code: "custom", path: ["sources", index, "id"], message: "来源包 ID 不能重复" });
    ids.add(source.id);
    const sampleIds = new Set<string>();
    source.samples.forEach((sample, sampleIndex) => {
      if (sampleIds.has(sample.id)) ctx.addIssue({ code: "custom", path: ["sources", index, "samples", sampleIndex, "id"], message: "范文 ID 不能重复" });
      sampleIds.add(sample.id);
    });
  });
});

export type StylePreset = z.infer<typeof StylePresetSchema>;
export type StyleFingerprint = z.infer<typeof StyleFingerprintSchema>;

export function createStylePreset(fingerprint: StyleFingerprint | null = null): StylePreset {
  return {
    schemaVersion: 1,
    name: "本书文风",
    generalRules: [],
    sources: [],
    bookVoice: { tone: "", narrativeVoice: "", principles: [] },
    customConstraints: [],
    fingerprint,
  };
}

/** 合成指南里来源技法每类最多几条、来源技法一节最多多少字。作者手写的通用写法与本书写法不受限。 */
export const STYLE_GUIDE_MAX_RULES_PER_CATEGORY = 6;
export const STYLE_GUIDE_SOURCE_RULES_CHAR_CAP = 1_000;

/** 显式主来源优先；旧存档缺 role 时只有首来源承担全局声音。 */
export function primaryStyleSourceId(preset: StylePreset): string | undefined {
  const explicit = preset.sources.find((source) => source.role === "primary_voice");
  if (explicit) return explicit.id;
  const first = preset.sources[0];
  return first && first.role === undefined ? first.id : undefined;
}

export function isStyleSourceActive(preset: StylePreset, sourceId: string, activeOverlayIds?: ReadonlySet<string>): boolean {
  const source = preset.sources.find((item) => item.id === sourceId);
  return sourceId === primaryStyleSourceId(preset)
    || (source?.role === "register_overlay" && activeOverlayIds?.has(sourceId) === true);
}
/** 两条来源技法的字符二元组 Dice 相似度达到这个值即视为近似重复，只留先出现（置信度更高）的一条。 */
export const STYLE_GUIDE_NEAR_DUPLICATE_SIMILARITY = 0.8;

const CONFIDENCE_RANK: Readonly<Record<string, number>> = { high: 0, medium: 1, low: 2 };

function guideKey(text: string): string {
  return text.replace(/[\s\p{P}\p{S}\d]+/gu, "").toLowerCase();
}

function bigramSimilarity(left: string, right: string): number {
  const grams = (value: string) => {
    const map = new Map<string, number>();
    if (value.length === 1) map.set(value, 1);
    for (let index = 0; index < value.length - 1; index += 1) {
      const gram = value.slice(index, index + 2);
      map.set(gram, (map.get(gram) ?? 0) + 1);
    }
    return map;
  };
  const a = grams(left);
  const b = grams(right);
  const total = [...a.values(), ...b.values()].reduce((sum, count) => sum + count, 0);
  if (total === 0) return 0;
  let overlap = 0;
  for (const [gram, count] of a) overlap += Math.min(count, b.get(gram) ?? 0);
  return (2 * overlap) / total;
}

export interface ComposedSourceRule {
  readonly text: string;
  readonly sourceTitles: readonly string[];
  readonly category: string;
}

/**
 * 进入指南的来源技法：已确认 + 可迁移；近似重复的合并成一条并列出全部来源；
 * 每类按置信度（高→中→低）、出现先后取前 STYLE_GUIDE_MAX_RULES_PER_CATEGORY 条，
 * 总字数超过 STYLE_GUIDE_SOURCE_RULES_CHAR_CAP 时按类别轮流取，保证各类都有代表。
 * 未进指南的规则仍完整保存在预设里，只是不注入写作提示。
 */
export function selectGuideSourceRules(preset: StylePreset): { readonly rules: readonly ComposedSourceRule[]; readonly omitted: number } {
  const candidates = preset.sources.filter((source) => source.id === primaryStyleSourceId(preset)).flatMap((source, sourceIndex) => source.rules
    .map((rule, ruleIndex) => ({ rule, source, order: sourceIndex * 1_000 + ruleIndex }))
    .filter(({ rule }) => rule.transfer === "transferable" && rule.status === "confirmed"))
    .sort((left, right) => (CONFIDENCE_RANK[left.rule.confidence ?? "high"] ?? 0) - (CONFIDENCE_RANK[right.rule.confidence ?? "high"] ?? 0)
      || left.order - right.order);
  const merged: { text: string; key: string; sourceTitles: string[]; category: string }[] = [];
  for (const { rule, source } of candidates) {
    const key = guideKey(rule.text);
    const twin = merged.find((item) => item.key === key || bigramSimilarity(item.key, key) >= STYLE_GUIDE_NEAR_DUPLICATE_SIMILARITY);
    if (twin) {
      if (!twin.sourceTitles.includes(source.title)) twin.sourceTitles.push(source.title);
      continue;
    }
    merged.push({ text: rule.text, key, sourceTitles: [source.title], category: rule.category ?? "general" });
  }
  // 按类别分组，每类限条数。
  const byCategory = new Map<string, typeof merged>();
  for (const item of merged) {
    const list = byCategory.get(item.category) ?? [];
    if (list.length < STYLE_GUIDE_MAX_RULES_PER_CATEGORY) list.push(item);
    byCategory.set(item.category, list);
  }
  // 类别轮流取，直到字数上限。
  const queues = [...byCategory.values()].map((list) => [...list]);
  const picked: ComposedSourceRule[] = [];
  let chars = 0;
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const queue of queues) {
      const next = queue.shift();
      if (!next) continue;
      progressed = true;
      const line = `- ${next.text}（来源：${next.sourceTitles.join("、")}）`;
      if (chars + line.length > STYLE_GUIDE_SOURCE_RULES_CHAR_CAP && picked.length > 0) continue;
      chars += line.length + 1;
      picked.push({ text: next.text, sourceTitles: next.sourceTitles, category: next.category });
    }
  }
  return { rules: picked, omitted: merged.length - picked.length };
}

/** 统计数字留给写后对照，不当成机械句长配额；来源专属与未审阅规则绝不注入。 */
export function composeStyleGuide(preset: StylePreset, options: { activeOverlayIds?: ReadonlySet<string>; maxChars?: number } = {}): string {
  const sections: string[] = [];
  const cap = Math.max(0, options.maxChars ?? (preset.consolidatedRules?.length ? 900 : 2_000));
  const finish = () => {
    if (!sections.length) return "";
    return [`## ${preset.name}`, "仅学习表达方法；人物、世界与情节以本书已确认的经纬和当前作者要求为准，不迁移参考作品设定。", ...sections].join("\n\n").slice(0, cap);
  };
  const primaryId = primaryStyleSourceId(preset);
  const consolidated = preset.consolidatedRules?.filter((rule) => rule.sourceIds.length === 0 || rule.sourceIds.includes(primaryId ?? ""));
  if (consolidated?.length) {
    sections.push(`### 执行铁律\n${consolidated.slice(0, 12).map((rule) => `- ${rule.rule.slice(0, 40)}${rule.doExample ? `；正：${rule.doExample.slice(0, 18)}` : ""}${rule.dontExample ? `；反：${rule.dontExample.slice(0, 18)}` : ""}`).join("\n")}`);
  } else {
    if (preset.generalRules.length) sections.push(`### 通用写法\n${preset.generalRules.map((rule) => `- ${rule}`).join("\n")}`);
    const sourceRules = selectGuideSourceRules(preset).rules.map((rule) => `- ${rule.text}（来源：${rule.sourceTitles.join("、")}）`);
    if (sourceRules.length) sections.push(`### 已采纳的来源技法\n${sourceRules.join("\n")}`);
  }
  for (const source of preset.sources) {
    if (source.role !== "register_overlay" || !options.activeOverlayIds?.has(source.id)) continue;
    const rules = source.rules.filter((rule) => rule.status === "confirmed" && rule.transfer === "transferable").slice(0, 3);
    if (rules.length) sections.push(`【局部语域挂载：${source.title}】\n仅用于触发场景，不改变全章声音。\n${rules.map((rule) => `- ${rule.text.slice(0, 120)}`).join("\n")}`);
  }
  const voice = preset.bookVoice;
  const bookRules = [
    voice.tone ? `基调：${voice.tone}` : "",
    voice.narrativeVoice ? `叙事声音：${voice.narrativeVoice}` : "",
    ...(consolidated?.length ? [] : voice.principles.map((rule) => `- ${rule}`)),
  ].filter(Boolean);
  if (bookRules.length) sections.push(`### 本书写法\n${bookRules.join("\n")}`);
  return finish();
}
