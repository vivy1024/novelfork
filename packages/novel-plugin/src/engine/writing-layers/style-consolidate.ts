import { z } from "zod";
import type { RuntimeTextGenerator } from "@vivy1024/novelfork-core/plugins";

import {
  createStylePreset,
  primaryStyleSourceId,
  STYLE_GUIDE_RULE_CATEGORIES,
  type StylePreset,
} from "./style-preset.js";
import { CUSTOM_CONSTRAINT_MAX_ITEM_CHARS, CUSTOM_CONSTRAINT_MAX_ITEMS } from "./style-preset-custom-constraints.js";
import { loadStylePreset, saveStylePreset, StylePresetError, type LoadedStylePreset } from "./style-preset-store.js";

export const MAX_CONSOLIDATED_STYLE_RULES = 12;

export type ConsolidatedStyleRule = NonNullable<StylePreset["consolidatedRules"]>[number];

const GENERIC_PLATITUDE_PATTERNS: readonly RegExp[] = [
  /^(?:注意|保持|做到|适当|合理)?(?:长短句结合|长短句交错|注意节奏|节奏张弛有度|语言生动|描写细腻|人物形象鲜明|情感真挚|用词准确|增强代入感|增强画面感|文笔流畅|行文自然)[。！!]?$/u,
  /^(?:多用动词少用形容词|少用形容词多用动词|注意详略得当|保持文风一致|避免流水账)[。！!]?$/u,
];

export function isGenericStylePlatitude(text: string): boolean {
  const cleaned = text.trim().replace(/^[-*•\d.、\s]+/u, "");
  if (cleaned.length < 4) return true;
  return GENERIC_PLATITUDE_PATTERNS.some((pattern) => pattern.test(cleaned));
}

function ruleKey(text: string): string {
  return text.replace(/[\s\p{P}\p{S}\d]+/gu, "").toLowerCase();
}

function bigramDice(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const grams = (value: string) => {
    const map = new Map<string, number>();
    if (value.length === 1) map.set(value, 1);
    for (let i = 0; i < value.length - 1; i += 1) {
      const g = value.slice(i, i + 2);
      map.set(g, (map.get(g) ?? 0) + 1);
    }
    return map;
  };
  const a = grams(left);
  const b = grams(right);
  const total = [...a.values(), ...b.values()].reduce((s, n) => s + n, 0);
  if (total === 0) return 0;
  let overlap = 0;
  for (const [g, count] of a) overlap += Math.min(count, b.get(g) ?? 0);
  return (2 * overlap) / total;
}

const CATEGORY_DEFAULT_CONTRASTS: Readonly<Record<string, { readonly doExample: string; readonly dontExample: string }>> = {
  voice: { doExample: "冷眼记下账面数字与手头动作", dontExample: "大段感叹命运不公或直接替读者总结情绪" },
  language: { doExample: "用小说世界内生器物词直写触感", dontExample: "夹杂现代实验室缩写、西式翻译腔长定语" },
  rhythm: { doExample: "关键转折单句独立成行，动作连贯推进", dontExample: "连续四五句同长度排比句原地抒情" },
  dialogue: { doExample: "人物说话带各自算计与停顿，边做边说", dontExample: "角色轮流发表说明书式设定科普" },
  scene: { doExample: "借器物冷暖、动静细节交代环境变化", dontExample: "先铺三百字空泛景物描写再出场人物" },
  consistency: { doExample: "称谓、代价与账目细节前后严丝合缝", dontExample: "前文刚立的限制后文随手吃书" },
  general: { doExample: "具体动作与结果直接落地", dontExample: "空泛套话与抽象形容词堆砌" },
};

function deriveExamples(input: {
  readonly category: string;
  readonly rule: string;
  readonly evidence?: string;
  readonly doExample?: string;
  readonly dontExample?: string;
}): { readonly doExample: string; readonly dontExample: string } {
  const defaults = CATEGORY_DEFAULT_CONTRASTS[input.category] ?? CATEGORY_DEFAULT_CONTRASTS.general!;
  const cleanEvidence = input.evidence
    ?.replace(/^第\d+章原文：「?/u, "")
    .replace(/」$/u, "")
    .trim()
    .slice(0, 60);
  const doExample = (input.doExample?.trim() || cleanEvidence || defaults.doExample).slice(0, 120);
  const dontExample = (input.dontExample?.trim() || defaults.dontExample).slice(0, 120);
  return { doExample, dontExample };
}

interface RuleCluster {
  category: string;
  rule: string;
  key: string;
  evidence?: string;
  doExample?: string;
  dontExample?: string;
  confidenceRank: number;
  sourceIds: string[];
}

const CONFIDENCE_RANK: Readonly<Record<string, number>> = { high: 0, medium: 1, low: 2 };

export interface ConsolidateStylePresetInput {
  readonly preset: StylePreset;
  readonly generateText?: RuntimeTextGenerator;
  readonly maxRules?: number;
}

export interface ConsolidateStylePresetResult {
  readonly consolidatedRules: ConsolidatedStyleRule[];
  readonly inputRuleCount: number;
  readonly droppedPlatitudeCount: number;
  readonly usedModel: boolean;
}

function deterministicConsolidate(preset: StylePreset, maxRules: number): {
  readonly clusters: RuleCluster[];
  readonly inputRuleCount: number;
  readonly droppedPlatitudeCount: number;
} {
  const primaryId = primaryStyleSourceId(preset);
  const rawItems: Array<{
    category: string;
    text: string;
    evidence?: string;
    doExample?: string;
    dontExample?: string;
    confidenceRank: number;
    sourceId?: string;
  }> = [];

  for (const general of preset.generalRules) {
    rawItems.push({ category: "general", text: general, confidenceRank: 0 });
  }
  for (const principle of preset.bookVoice.principles) {
    rawItems.push({ category: "voice", text: principle, confidenceRank: 0 });
  }
  for (const source of preset.sources) {
    // 局部语域插件的规则留给触发挂载，不混入全局主文风铁律。
    if (source.role === "register_overlay" && source.id !== primaryId) continue;
    for (const rule of source.rules) {
      if (rule.status !== "confirmed" || rule.transfer !== "transferable") continue;
      rawItems.push({
        category: rule.category ?? "general",
        text: rule.text,
        evidence: rule.evidence,
        doExample: rule.doExample,
        dontExample: rule.dontExample,
        confidenceRank: CONFIDENCE_RANK[rule.confidence ?? "high"] ?? 0,
        sourceId: source.id,
      });
    }
  }

  let droppedPlatitudeCount = 0;
  const filtered = rawItems.filter((item) => {
    if (isGenericStylePlatitude(item.text)) {
      droppedPlatitudeCount += 1;
      return false;
    }
    return true;
  });

  filtered.sort((a, b) => a.confidenceRank - b.confidenceRank);

  const clusters: RuleCluster[] = [];
  for (const item of filtered) {
    const key = ruleKey(item.text);
    if (!key) continue;
    const existing = clusters.find((cluster) =>
      cluster.key === key || bigramDice(cluster.key, key) >= 0.55);
    if (existing) {
      if (item.sourceId && !existing.sourceIds.includes(item.sourceId)) {
        existing.sourceIds.push(item.sourceId);
      }
      if (!existing.doExample && item.doExample) existing.doExample = item.doExample;
      if (!existing.dontExample && item.dontExample) existing.dontExample = item.dontExample;
      if (!existing.evidence && item.evidence) existing.evidence = item.evidence;
      continue;
    }
    clusters.push({
      category: item.category,
      rule: item.text.trim().slice(0, 120),
      key,
      evidence: item.evidence,
      doExample: item.doExample,
      dontExample: item.dontExample,
      confidenceRank: item.confidenceRank,
      sourceIds: item.sourceId ? [item.sourceId] : (primaryId ? [primaryId] : []),
    });
  }

  // 按类别轮流取，保证各维度覆盖且不超过 maxRules。
  const byCategory = new Map<string, RuleCluster[]>();
  for (const cat of STYLE_GUIDE_RULE_CATEGORIES) byCategory.set(cat, []);
  for (const cluster of clusters) {
    const cat = byCategory.has(cluster.category) ? cluster.category : "general";
    byCategory.get(cat)!.push(cluster);
  }
  const picked: RuleCluster[] = [];
  let progressed = true;
  while (progressed && picked.length < maxRules) {
    progressed = false;
    for (const cat of STYLE_GUIDE_RULE_CATEGORIES) {
      if (picked.length >= maxRules) break;
      const next = byCategory.get(cat)?.shift();
      if (!next) continue;
      progressed = true;
      picked.push(next);
    }
  }

  return { clusters: picked, inputRuleCount: rawItems.length, droppedPlatitudeCount };
}

const LlmConsolidatedSchema = z.object({
  rules: z.array(z.object({
    category: z.string().trim().min(1).max(60).optional(),
    rule: z.string().trim().min(4).max(160),
    doExample: z.string().trim().min(2).max(160),
    dontExample: z.string().trim().min(2).max(160),
    sourceIds: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
  })).min(1).max(MAX_CONSOLIDATED_STYLE_RULES),
});

function parseJsonObject(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/iu)?.[1];
  const candidate = (fenced ?? raw).match(/\{[\s\S]*\}/u)?.[0];
  if (!candidate) return null;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

export async function consolidateStylePresetRules(
  input: ConsolidateStylePresetInput,
): Promise<ConsolidateStylePresetResult> {
  const cap = Math.min(MAX_CONSOLIDATED_STYLE_RULES, Math.max(1, Math.trunc(input.maxRules ?? MAX_CONSOLIDATED_STYLE_RULES)));
  const det = deterministicConsolidate(input.preset, cap);
  if (det.clusters.length === 0) {
    return {
      consolidatedRules: [],
      inputRuleCount: det.inputRuleCount,
      droppedPlatitudeCount: det.droppedPlatitudeCount,
      usedModel: false,
    };
  }

  const knownSourceIds = new Set(input.preset.sources.map((s) => s.id));
  const primaryId = primaryStyleSourceId(input.preset);

  if (input.generateText) {
    try {
      const response = await input.generateText({
        messages: [
          {
            role: "system",
            content: [
              `你是网文文风提纯器。把输入的候选规则聚类归约为不超过 ${cap} 条高信息密度执行铁律。`,
              "硬性要求：",
              "1. 剔除「注意长短句结合」「语言生动细腻」等正确废话；每条规则必须是可观察的句法/叙事动作。",
              "2. 每条必须给出简短鲜明的 doExample（正例）与 dontExample（反例），不出现参考书专有名词。",
              "3. 只输出合法 JSON：{\"rules\":[{\"category\":\"voice|language|rhythm|dialogue|scene|consistency|general\",\"rule\":\"...\",\"doExample\":\"...\",\"dontExample\":\"...\",\"sourceIds\":[\"...\"]}]}。",
            ].join("\n"),
          },
          {
            role: "user",
            content: JSON.stringify(det.clusters.map((c) => ({
              category: c.category,
              rule: c.rule,
              evidence: c.evidence,
              sourceIds: c.sourceIds,
            }))),
          },
        ],
        temperature: 0.2,
        maxTokens: 1_800,
      });
      const parsed = LlmConsolidatedSchema.safeParse(parseJsonObject(response.text));
      if (parsed.success) {
        const cleaned = parsed.data.rules
          .filter((item) => !isGenericStylePlatitude(item.rule))
          .slice(0, cap)
          .map((item, idx): ConsolidatedStyleRule => {
            const validSources = (item.sourceIds ?? []).filter((id) => knownSourceIds.has(id));
            return {
              id: `crule-${String(idx + 1).padStart(2, "0")}`,
              category: item.category ?? "general",
              rule: item.rule.slice(0, 120),
              doExample: item.doExample.slice(0, 120),
              dontExample: item.dontExample.slice(0, 120),
              sourceIds: validSources.length > 0 ? validSources : (primaryId ? [primaryId] : []),
            };
          });
        if (cleaned.length > 0) {
          return {
            consolidatedRules: cleaned,
            inputRuleCount: det.inputRuleCount,
            droppedPlatitudeCount: det.droppedPlatitudeCount,
            usedModel: true,
          };
        }
      }
    } catch {
      // 模型失败自动降级到确定性聚类归约兜底。
    }
  }

  const consolidatedRules: ConsolidatedStyleRule[] = det.clusters.slice(0, cap).map((cluster, idx) => {
    const examples = deriveExamples(cluster);
    return {
      id: `crule-${String(idx + 1).padStart(2, "0")}`,
      category: cluster.category,
      rule: cluster.rule,
      doExample: examples.doExample,
      dontExample: examples.dontExample,
      sourceIds: cluster.sourceIds,
    };
  });

  return {
    consolidatedRules,
    inputRuleCount: det.inputRuleCount,
    droppedPlatitudeCount: det.droppedPlatitudeCount,
    usedModel: false,
  };
}

export async function consolidateAndSaveStylePreset(input: {
  readonly bookRoot: string;
  readonly generateText?: RuntimeTextGenerator;
  readonly maxRules?: number;
  readonly expectedRevision?: string | null;
}): Promise<LoadedStylePreset & ConsolidateStylePresetResult> {
  const current = await loadStylePreset(input.bookRoot);
  if (input.expectedRevision !== undefined && input.expectedRevision !== current.revision) {
    throw new StylePresetError("文风预设已被更新；请重新读取最新版本后再归约规则。", "STYLE_PRESET_CONFLICT");
  }
  const base = current.preset ?? createStylePreset();
  const consolidated = await consolidateStylePresetRules({
    preset: base,
    generateText: input.generateText,
    maxRules: input.maxRules,
  });
  const saved = await saveStylePreset(
    input.bookRoot,
    { ...base, consolidatedRules: consolidated.consolidatedRules },
    current.revision,
  );
  return { ...saved, ...consolidated };
}

// ─── L5 运行时负反馈热修正 ─────────────────────────────────────────────────

const NEGATIVE_FEEDBACK_RULES: ReadonlyArray<{ readonly match: RegExp; readonly rule: string }> = [
  {
    match: /翻译腔|欧化|西式长句|被动句/u,
    rule: "【负反馈铁律】严禁欧化翻译腔与冗长前置定语（反例：「被一种难以名状的不安感所笼罩的他」；正例：「他心里发毛，手按住了刀柄」）。",
  },
  {
    match: /英文缩写|字母缩写|西式缩写|外文缩写|ascii|缩写词/iu,
    rule: "【负反馈铁律】严禁使用未授权英文专业缩写与外文代号，一律改写为世界观内生中文词（反例：「启动SQUID阵列检测灵波」；正例：「催动定灵罗盘探查灵机」）。",
  },
  {
    match: /心理描写|内心戏|内心独白|心理活动/u,
    rule: "【负反馈铁律】大幅压缩直白心理剖析，人物情绪只准借手部动作、账目取舍与对话停顿外化（反例：「他内心十分纠结痛苦」；正例：「他盯着账单看了半晌，合上本子没吭声」）。",
  },
  {
    match: /文言|半文言|古文腔|文绉绉|之乎者也/u,
    rule: "【负反馈铁律】日常叙事严禁半文言腔与夹生古语，保持干净利落的现代白话（反例：「此子心性颇为坚韧，遂拂袖而去」；正例：「这人倒沉得住气，转身就走」）。",
  },
  {
    match: /排比|抒情|升华|拔高|总结陈词|金句/u,
    rule: "【负反馈铁律】严禁段末强行抒情拔高与三连排比总结，事说完即止（反例：「这一刻，是信念的觉醒，更是命运的反击」；正例：「收好银票，他吹灭了灯」）。",
  },
  {
    match: /比喻|仿佛|宛如|像.*一样/u,
    rule: "【负反馈铁律】克制廉价密集比喻，禁止连续使用「仿佛/宛如/像…一样」，直接白描动作与物象。",
  },
];

export function formatNegativeOverrideConstraint(feedbackText: string): string {
  const raw = feedbackText.trim().replace(/\s+/gu, " ");
  if (!raw) {
    throw new StylePresetError("负反馈内容不能为空。", "STYLE_PRESET_INVALID");
  }
  for (const presetRule of NEGATIVE_FEEDBACK_RULES) {
    if (presetRule.match.test(raw)) {
      return presetRule.rule.slice(0, CUSTOM_CONSTRAINT_MAX_ITEM_CHARS);
    }
  }
  const stripped = raw
    .replace(/^(?:这段|这章|刚才那段|请|麻烦|注意|以后|后面)?/u, "")
    .replace(/[。！!；;]+$/u, "")
    .trim();
  const body = /^(?:不要|别|禁止|严禁|少用|不准|不得|忌)/u.test(stripped)
    ? `【负反馈铁律】${stripped}（最高优先级，压过默认手法）。`
    : `【负反馈铁律】严禁再出现「${stripped}」问题，行文必须直接避开该倾向。`;
  return body.slice(0, CUSTOM_CONSTRAINT_MAX_ITEM_CHARS);
}

export interface NegativeOverrideResult {
  readonly appliedRule: string;
  readonly customConstraints: readonly string[];
  readonly deduplicated: boolean;
  readonly preset: LoadedStylePreset;
}

/**
 * L5 运行时负反馈热修正：把作者的一句口头纠偏转化为最高优先级反例铁律，
 * 去重并置顶写入 `preset.customConstraints[0]`，立即随写前硬约束与润色指令生效。
 */
export async function appendRuntimeNegativeOverride(
  bookRoot: string,
  feedbackText: string,
): Promise<NegativeOverrideResult> {
  const appliedRule = formatNegativeOverrideConstraint(feedbackText);
  const current = await loadStylePreset(bookRoot);
  const base = current.preset ?? createStylePreset();
  const targetKey = ruleKey(appliedRule);
  const existing = base.customConstraints ?? [];
  const deduplicated = existing.some((item) => ruleKey(item) === targetKey);
  const remaining = existing.filter((item) => ruleKey(item) !== targetKey);
  const nextConstraints = [appliedRule, ...remaining].slice(0, CUSTOM_CONSTRAINT_MAX_ITEMS);
  const saved = await saveStylePreset(
    bookRoot,
    { ...base, customConstraints: nextConstraints },
    current.revision,
  );
  return {
    appliedRule,
    customConstraints: nextConstraints,
    deduplicated,
    preset: saved,
  };
}
