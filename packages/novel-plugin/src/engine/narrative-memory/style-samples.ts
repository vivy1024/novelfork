/**
 * 按本章场景类型检索文风范文（T2.4）。
 *
 * 纯函数：输入是本书文风预设与本章的场景线索，输出选中的范文与完整诊断。
 * 词汇只用两套既有枚举——预设范文的 STYLE_SCENE_TYPES（写法层：对话 / 动作 / 描写…）
 * 与叙事结构的 SCENE_FUNCTIONS（功能层：推进 / 揭示 / 过渡…）——后者只经由下表映射到前者，
 * 不另起第三套词汇。
 *
 * 纪律：
 * - 只选作者已确认（status=confirmed）的范文；作品专属（source-only）范文可作示例，
 *   但在理由与诊断里标明「作品专属」及来源，提醒只学写法不迁移设定。
 * - 排序完全确定：场景匹配 → 通用 → 兜底补位；同层按「可迁移优先 → 来源包次序 → 范文次序 → ID」。
 * - 超预算时按上述排名依次尝试，放不下的记为裁剪并写明原因；不做静默丢弃。
 */

import type { SceneSpec } from "../../handlers/scene-spec-handler.js";
import { estimateTokens } from "../jingwei/context/token-budget.js";
import { STYLE_SCENE_TYPES, type StylePreset } from "../writing-layers/style-preset.js";
import type { NarrativeScene, SceneFunction } from "./scene-store.js";

export type StyleSceneType = (typeof STYLE_SCENE_TYPES)[number];
/** 本章场景类型从哪里判出来的。none = 取不到，退化为通用范文。 */
export type StyleSceneTypeSource = "narrative-scene" | "scene-spec" | "chapter-plan" | "none";

export interface StyleExplanation {
  readonly whatHappened: string;
  readonly whyItMatters: string;
  readonly suggestedAction: string;
}

export const STYLE_SCENE_TYPE_LABELS: Readonly<Record<StyleSceneType, string>> = {
  dialogue: "对话",
  action: "动作",
  description: "描写",
  interiority: "心理",
  transition: "过渡",
  general: "通用",
};

export const STYLE_SAMPLE_LIMITS = { min: 2, max: 4 } as const;
/** 最多按前几种场景类型检索；再多会把示例摊得太薄。 */
const MAX_WANTED_TYPES = 3;

/**
 * 场景功能 → 写法类型。只映射写法倾向明确的功能；
 * advance / plant / payoff / other 写法不定，交给场景文字判断。
 */
const FUNCTION_TO_STYLE: Readonly<Record<SceneFunction, readonly StyleSceneType[]>> = {
  advance: [],
  reveal: ["dialogue"],
  plant: [],
  payoff: [],
  relationship: ["dialogue", "interiority"],
  transition: ["transition"],
  setup: ["description"],
  climax: ["action"],
  other: [],
};

/** 规划文字（冲突 / 氛围 / 结果 / 情节点）里的写法线索。只认明确的词，宁缺毋滥。 */
const PLAN_KEYWORDS: Readonly<Record<Exclude<StyleSceneType, "general">, RegExp>> = {
  dialogue: /对话|对白|对峙|对质|谈判|争吵|争执|质问|交谈|商议|商量|劝说|说服|审问|盘问|摊牌|密谈|问话|辩论|寒暄|告白|表白/gu,
  action: /打斗|战斗|交手|厮杀|追杀|追逐|追击|逃亡|逃跑|突围|搏斗|决战|伏击|刺杀|比武|激战|围攻|动手|出手|拔刀|拔剑|格斗|混战|斗法|对决/gu,
  interiority: /内心|心理|挣扎|回忆|犹豫|愧疚|恐惧|悔恨|思索|独白|心结|动摇|顿悟|纠结|自省|心事|不安/gu,
  description: /环境|景色|风景|景象|氛围|街景|夜景|陈设|外貌|初到|初入|登场|见闻|描写/gu,
  transition: /过渡|转场|赶路|启程|动身|数日后|次日|几天后|返回|抵达|收尾|时间跳跃|一路/gu,
};

export interface ResolvedStyleSceneTypes {
  /** 按权重排好的写法类型，不含 general。空数组 = 取不到。 */
  readonly types: readonly StyleSceneType[];
  readonly source: StyleSceneTypeSource;
  /** 判定依据，逐条可读。 */
  readonly evidence: readonly string[];
  /** 依次尝试过但没判出来的来源及原因，便于排查。 */
  readonly attempts: readonly string[];
  readonly explanation?: StyleExplanation;
}

export interface ResolveStyleSceneTypesInput {
  readonly chapterNumber?: number;
  /** 本章 narrative_scene（按章内次序）；rejected 的会被忽略。 */
  readonly chapterScenes?: readonly NarrativeScene[];
  readonly sceneSpec?: SceneSpec;
  /** 章节规划文字：写作意图 / 本章指示 / 场景描述。 */
  readonly planText?: string;
}

type Votes = Map<StyleSceneType, number>;

function vote(votes: Votes, type: StyleSceneType, weight: number): void {
  votes.set(type, (votes.get(type) ?? 0) + weight);
}

function keywordVotes(text: string, votes: Votes): string[] {
  const hits: string[] = [];
  for (const type of STYLE_SCENE_TYPES) {
    if (type === "general") continue;
    const matches = text.match(PLAN_KEYWORDS[type]) ?? [];
    if (matches.length === 0) continue;
    vote(votes, type, matches.length);
    hits.push(`${STYLE_SCENE_TYPE_LABELS[type]}（${[...new Set(matches)].slice(0, 3).join("、")}）`);
  }
  return hits;
}

function rankVotes(votes: Votes): StyleSceneType[] {
  return [...votes.entries()]
    .filter(([, weight]) => weight > 0)
    .sort((a, b) => b[1] - a[1] || STYLE_SCENE_TYPES.indexOf(a[0]) - STYLE_SCENE_TYPES.indexOf(b[0]))
    .map(([type]) => type)
    .slice(0, MAX_WANTED_TYPES);
}

function labelList(types: readonly StyleSceneType[]): string {
  return types.map((type) => STYLE_SCENE_TYPE_LABELS[type]).join(" / ");
}

function fromNarrativeScenes(scenes: readonly NarrativeScene[]): { types: StyleSceneType[]; evidence: string[] } {
  const votes: Votes = new Map();
  const evidence: string[] = [];
  for (const scene of scenes) {
    const label = `第${scene.chapterNumber}章第${scene.ordinal}场「${scene.title}」`;
    // 功能标签是作者 / 模型对这一场的明确判断，权重高于文字线索。
    const mapped = FUNCTION_TO_STYLE[scene.function] ?? [];
    for (const type of mapped) vote(votes, type, 2);
    if (mapped.length > 0) evidence.push(`${label}功能 ${scene.function} → ${labelList(mapped)}`);
    const hits = keywordVotes([scene.title, scene.summary, scene.conflict, scene.mood, scene.outcome].join(" "), votes);
    if (hits.length > 0) evidence.push(`${label}文字线索：${hits.join("，")}`);
  }
  return { types: rankVotes(votes), evidence };
}

function fromSceneSpec(sceneSpec: SceneSpec): { types: StyleSceneType[]; evidence: string[] } {
  const votes: Votes = new Map();
  const evidence: string[] = [];
  sceneSpec.scenes.forEach((scene, index) => {
    const hits = keywordVotes([scene.conflict, scene.mood, scene.outcome].join(" "), votes);
    if (hits.length > 0) evidence.push(`写作蓝图第${index + 1}场：${hits.join("，")}`);
  });
  (sceneSpec.beatBudget ?? []).forEach((beat, index) => {
    const hits = keywordVotes([beat.function ?? "", beat.summary].join(" "), votes);
    if (hits.length > 0) evidence.push(`情节点预算第${index + 1}拍：${hits.join("，")}`);
  });
  return { types: rankVotes(votes), evidence };
}

/**
 * 判定本章需要哪几类范文。
 * 次序：本章 narrative_scene（功能 + 文字）→ 写作蓝图 SceneSpec（场景与情节点）→ 章节规划文字 → 取不到。
 */
export function resolveStyleSceneTypes(input: ResolveStyleSceneTypesInput): ResolvedStyleSceneTypes {
  const attempts: string[] = [];
  const scenes = (input.chapterScenes ?? []).filter((scene) => scene.status !== "rejected");
  if (scenes.length > 0) {
    const result = fromNarrativeScenes(scenes);
    if (result.types.length > 0) return { types: result.types, source: "narrative-scene", evidence: result.evidence, attempts };
    attempts.push(`本章有 ${scenes.length} 个场景，但功能与文字都看不出写法类型。`);
  } else {
    attempts.push(input.chapterNumber ? `第${input.chapterNumber}章还没有场景记录。` : "未指定章节，无法读取本章场景。");
  }

  if (input.sceneSpec) {
    const result = fromSceneSpec(input.sceneSpec);
    if (result.types.length > 0) return { types: result.types, source: "scene-spec", evidence: result.evidence, attempts };
    attempts.push("写作蓝图的冲突 / 氛围 / 结果与情节点里没有明确的写法线索。");
  } else {
    attempts.push("未提供写作蓝图。");
  }

  const planText = input.planText?.trim() ?? "";
  if (planText) {
    const votes: Votes = new Map();
    const hits = keywordVotes(planText, votes);
    const types = rankVotes(votes);
    if (types.length > 0) return { types, source: "chapter-plan", evidence: [`章节规划文字：${hits.join("，")}`], attempts };
    attempts.push("章节规划文字里没有明确的写法线索。");
  } else {
    attempts.push("未提供章节规划文字。");
  }

  return {
    types: [],
    source: "none",
    evidence: [],
    attempts,
    explanation: {
      whatHappened: "没能判断本章的场景类型，范文退化为通用范文。",
      whyItMatters: "通用范文只示范整体写法，对白、打斗、心理等场景的写法示范会不够贴近本章。",
      suggestedAction: "在故事推进里给本章场景标上功能（如关系、过渡、高潮），或在写作蓝图的冲突 / 结果里写清这一场是对话、打斗还是心理戏。",
    },
  };
}

export type StyleSampleMatch = "scene-type" | "general" | "fallback";

export interface StyleSampleCandidate {
  /** `<来源包 ID>/<范文 ID>`，全书唯一。 */
  readonly key: string;
  readonly sourceId: string;
  readonly sourceTitle: string;
  readonly sampleId: string;
  readonly sceneType: StyleSceneType;
  readonly transfer: "transferable" | "source-only";
  readonly text: string;
}

export interface SelectedStyleSample extends StyleSampleCandidate {
  readonly rank: number;
  readonly match: StyleSampleMatch;
  readonly title: string;
  readonly reason: string;
  readonly estimatedTokens: number;
}

export interface TrimmedStyleSample {
  readonly key: string;
  readonly sourceTitle: string;
  readonly sceneType: StyleSceneType;
  readonly rank: number;
  readonly estimatedTokens: number;
  readonly kind: "token-budget" | "count-cap";
  readonly reason: string;
}

export interface StyleSampleSelection {
  readonly selected: readonly SelectedStyleSample[];
  readonly trimmed: readonly TrimmedStyleSample[];
  readonly diagnostics: StyleSampleDiagnostics;
  /** 需要作者关注的情况，已按「发生了什么 / 为什么要看 / 建议怎么做」写好。 */
  readonly explanations: readonly StyleExplanation[];
}

export interface StyleSampleDiagnostics {
  readonly sceneTypes: {
    readonly types: readonly StyleSceneType[];
    readonly labels: readonly string[];
    readonly source: StyleSceneTypeSource;
    readonly evidence: readonly string[];
    readonly attempts: readonly string[];
    readonly explanation?: StyleExplanation;
  };
  readonly totalSamples: number;
  readonly confirmedSamples: number;
  readonly unconfirmedSamples: number;
  readonly selected: readonly Omit<SelectedStyleSample, "text">[];
  readonly trimmed: readonly TrimmedStyleSample[];
  readonly budget: {
    readonly availableTokens: number | null;
    readonly usedTokens: number;
  };
}

export interface SelectStyleSamplesInput {
  readonly preset?: StylePreset | null;
  readonly sceneTypes: ResolvedStyleSceneTypes;
  /** 留给范文的 token；缺省表示不限（仍受段数上限约束）。 */
  readonly availableTokens?: number;
}

function collectCandidates(preset: StylePreset): { all: number; confirmed: Array<StyleSampleCandidate & { order: number }> } {
  let all = 0;
  const confirmed: Array<StyleSampleCandidate & { order: number }> = [];
  preset.sources.forEach((source, sourceIndex) => {
    source.samples.forEach((sample, sampleIndex) => {
      all += 1;
      if (sample.status !== "confirmed") return;
      confirmed.push({
        key: `${source.id}/${sample.id}`,
        sourceId: source.id,
        sourceTitle: source.title,
        sampleId: sample.id,
        sceneType: sample.sceneType,
        transfer: sample.transfer,
        text: sample.text,
        // 来源包次序优先，同包内按范文次序；乘数足够大，保证不交叉。
        order: sourceIndex * 1_000 + sampleIndex,
      });
    });
  });
  return { all, confirmed };
}

function compareCandidates(a: StyleSampleCandidate & { order: number }, b: StyleSampleCandidate & { order: number }): number {
  const transfer = (a.transfer === "transferable" ? 0 : 1) - (b.transfer === "transferable" ? 0 : 1);
  return transfer || a.order - b.order || a.key.localeCompare(b.key);
}

function sampleTitle(candidate: StyleSampleCandidate): string {
  return `范文示例·${STYLE_SCENE_TYPE_LABELS[candidate.sceneType]}`;
}

function sampleReason(candidate: StyleSampleCandidate, match: StyleSampleMatch, sceneTypes: ResolvedStyleSceneTypes): string {
  const why = match === "scene-type"
    ? `本章需要${STYLE_SCENE_TYPE_LABELS[candidate.sceneType]}场景的写法示范`
    : match === "general"
      ? sceneTypes.types.length > 0 ? "本章场景类型没有对应范文，改用通用范文" : "未判出本章场景类型，改用通用范文"
      : "场景匹配与通用范文不足两段，按预设次序补位";
  const origin = candidate.transfer === "source-only"
    ? `来源：${candidate.sourceTitle}（作品专属范文，只学写法，不得迁移其中人物、地名与设定）`
    : `来源：${candidate.sourceTitle}（可迁移）`;
  return `${why}；作者已确认。只学节奏、句式与分寸，不抄原句。${origin}`;
}

/** 选 2–4 段范文。排名与裁剪都确定，同样输入永远同样输出。 */
export function selectStyleSamples(input: SelectStyleSamplesInput): StyleSampleSelection {
  const sceneTypes = input.sceneTypes;
  const explanations: StyleExplanation[] = [];
  const { all, confirmed } = input.preset ? collectCandidates(input.preset) : { all: 0, confirmed: [] };

  const wanted = sceneTypes.types.filter((type) => type !== "general");
  const byType = new Map<StyleSceneType, Array<StyleSampleCandidate & { order: number }>>();
  for (const candidate of [...confirmed].sort(compareCandidates)) {
    byType.set(candidate.sceneType, [...(byType.get(candidate.sceneType) ?? []), candidate]);
  }

  // 场景匹配层：按本章需要的类型轮流取，避免四段全是同一类。
  const matched: Array<StyleSampleCandidate & { order: number }> = [];
  const queues = wanted.map((type) => [...(byType.get(type) ?? [])]);
  while (queues.some((queue) => queue.length > 0)) {
    for (const queue of queues) {
      const next = queue.shift();
      if (next) matched.push(next);
    }
  }
  const general = byType.get("general") ?? [];
  const used = new Set([...matched, ...general].map((candidate) => candidate.key));
  const others = STYLE_SCENE_TYPES
    .filter((type) => type !== "general" && !wanted.includes(type))
    .flatMap((type) => byType.get(type) ?? [])
    .filter((candidate) => !used.has(candidate.key));
  const fillCount = Math.max(0, STYLE_SAMPLE_LIMITS.min - matched.length - general.length);

  const ranked: Array<{ candidate: StyleSampleCandidate & { order: number }; match: StyleSampleMatch }> = [
    ...matched.map((candidate) => ({ candidate, match: "scene-type" as const })),
    ...general.map((candidate) => ({ candidate, match: "general" as const })),
    ...others.slice(0, fillCount).map((candidate) => ({ candidate, match: "fallback" as const })),
  ];

  const selected: SelectedStyleSample[] = [];
  const trimmed: TrimmedStyleSample[] = [];
  let remaining = input.availableTokens === undefined ? Number.POSITIVE_INFINITY : Math.max(0, Math.floor(input.availableTokens));
  let usedTokens = 0;
  ranked.forEach(({ candidate, match }, index) => {
    const { order: _order, ...plain } = candidate;
    const title = sampleTitle(plain);
    const estimatedTokens = Math.max(1, estimateTokens(`${title}\n${plain.text}`));
    const rank = index + 1;
    if (selected.length >= STYLE_SAMPLE_LIMITS.max) {
      trimmed.push({ key: plain.key, sourceTitle: plain.sourceTitle, sceneType: plain.sceneType, rank, estimatedTokens, kind: "count-cap", reason: `已选满 ${STYLE_SAMPLE_LIMITS.max} 段范文，排名靠后的不再注入。` });
      return;
    }
    if (estimatedTokens > remaining) {
      trimmed.push({
        key: plain.key, sourceTitle: plain.sourceTitle, sceneType: plain.sceneType, rank, estimatedTokens, kind: "token-budget",
        reason: `文风通道剩余预算 ${Number.isFinite(remaining) ? remaining : "∞"} tokens，放不下这段约 ${estimatedTokens} tokens 的范文。`,
      });
      return;
    }
    remaining -= estimatedTokens;
    usedTokens += estimatedTokens;
    selected.push({ ...plain, rank, match, title, reason: sampleReason(plain, match, sceneTypes), estimatedTokens });
  });

  const unconfirmed = all - confirmed.length;
  if (confirmed.length > 0 && sceneTypes.source === "none" && sceneTypes.explanation) {
    explanations.push(sceneTypes.explanation);
  } else if (confirmed.length > 0 && wanted.length > 0 && matched.length === 0) {
    explanations.push({
      whatHappened: `本章需要${labelList(wanted)}范文，但文风预设里没有这类已确认范文，改用通用范文。`,
      whyItMatters: "写法示范与本章场景不对应，模型只能从通用范文里揣摩这类场景该怎么写。",
      suggestedAction: `在文风预设里补充并确认${labelList(wanted)}类范文。`,
    });
  }
  if (confirmed.length === 0 && unconfirmed > 0) {
    explanations.push({
      whatHappened: `文风预设里有 ${unconfirmed} 段范文尚未确认，本章没有注入范文。`,
      whyItMatters: "未经作者确认的范文可能混入不想要的写法，因此不会作为写作示例。",
      suggestedAction: "到文风页审阅来源包，把合适的范文标为已确认。",
    });
  }
  const budgetTrimmed = trimmed.filter((item) => item.kind === "token-budget");
  if (budgetTrimmed.length > 0) {
    explanations.push({
      whatHappened: `文风通道预算不足，裁掉 ${budgetTrimmed.length} 段范文（${budgetTrimmed.map((item) => `第${item.rank}名 ${item.key}`).join("、")}）。`,
      whyItMatters: "被裁的范文不会出现在写作上下文里，本章能参考的写法示范变少。",
      suggestedAction: "精简文风指南或本书设计，或在叙事记忆配置里调高召回预算。",
    });
  }

  return {
    selected,
    trimmed,
    explanations,
    diagnostics: {
      sceneTypes: {
        types: sceneTypes.types,
        labels: sceneTypes.types.map((type) => STYLE_SCENE_TYPE_LABELS[type]),
        source: sceneTypes.source,
        evidence: sceneTypes.evidence,
        attempts: sceneTypes.attempts,
        ...(sceneTypes.explanation ? { explanation: sceneTypes.explanation } : {}),
      },
      totalSamples: all,
      confirmedSamples: confirmed.length,
      unconfirmedSamples: unconfirmed,
      selected: selected.map(({ text: _text, ...rest }) => rest),
      trimmed,
      budget: {
        availableTokens: input.availableTokens === undefined ? null : Math.max(0, Math.floor(input.availableTokens)),
        usedTokens,
      },
    },
  };
}

export function formatStyleExplanation(explanation: StyleExplanation): string {
  return `发生了什么：${explanation.whatHappened} 为什么要看：${explanation.whyItMatters} 建议怎么做：${explanation.suggestedAction}`;
}

/** 写作提示词里的「范文示例」段；与叙事上下文的范文卡片同一份选择结果。 */
export function formatStyleSamplesForPrompt(samples: readonly SelectedStyleSample[]): string {
  if (samples.length === 0) return "";
  return samples.map((sample, index) => [
    `### 示例 ${index + 1}：${STYLE_SCENE_TYPE_LABELS[sample.sceneType]}（${sample.transfer === "source-only" ? `作品专属·${sample.sourceTitle}` : sample.sourceTitle}）`,
    sample.text,
  ].join("\n")).join("\n\n");
}
