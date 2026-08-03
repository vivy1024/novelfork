/**
 * 按新书十一问答案推荐内置 Writing Skills。
 *
 * 为什么不做「按题材元数据精确匹配」：372 份内置 SKILL.md 里 `compatibleGenres`
 * 命中 0 次、`mode: auto` 只有 1 份，没有可直接查表的题材字段。可靠信号只有三个：
 *
 * 1. `kind` —— 全量分布已知（opening 7 / pacing 13 / prose 25 / revision 54 /
 *    platform 129 / plot 43 / packaging 30 / research 21 / character 7 / workflow 37）
 * 2. `tags` —— 262 份带 tag，其中 5 个题材簇覆盖 250 份：
 *    AI科幻 54、都市悬疑 53、异能志怪 51、女频爱情 46、都市职场 46
 * 3. 命名规律 —— `{题材}-{能力}`，且每类能力都有「通用-{能力}」兜底版
 *
 * 因此策略是：先按答案定位题材簇，再在必备能力位上挑「题材版优先、通用版兜底」，
 * 最后按目标平台补一条平台 skill。每条推荐都带 reason，作者与 Agent 都能复述
 * 它是被哪条答案触发的，不做黑箱启用。
 */

import type { ParsedWritingSkill, WritingSkillKind } from "./types.js";

export interface RecommendedWritingSkill {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly kind: WritingSkillKind;
  /** 排序用的匹配分；越高越贴合本书答案。 */
  readonly score: number;
  /** 触发这条推荐的答案与依据，供 UI 与叙述者原样复述。 */
  readonly reason: string;
}

export interface WritingSkillRecommendation {
  readonly recommended: readonly RecommendedWritingSkill[];
  /** 参与评分的候选数量（已排除 mode=always，它无需显式启用）。 */
  readonly consideredCount: number;
  /** 因 conflictGroup 撞车而落选的 skill id。 */
  readonly droppedByConflict: readonly string[];
  /** 命中的题材簇；没命中时为 null，此时全部走通用能力位。 */
  readonly matchedGenreCluster: string | null;
}

export interface WritingSkillRecommendationInput {
  readonly genre?: string;
  readonly tone?: string;
  readonly platform?: string;
  readonly complexity?: string;
  readonly aiTasteLevel?: string;
  readonly writingPhilosophy?: string;
}

/**
 * 上限。启用的 skill 正文每章都会注入 style 通道
 * （见 pipeline-write-service 的 writingSkillToStyleSnippet），
 * 放太多会挤掉叙事记忆的 token 预算。
 */
export const MAX_RECOMMENDED_WRITING_SKILLS = 6;

/**
 * 题材簇 → 触发关键词。
 * 关键词取自十一问 genre 题的预设项与常见自定义写法，命中即认为属于该簇。
 */
const GENRE_CLUSTERS: ReadonlyArray<{ readonly cluster: string; readonly keywords: readonly string[] }> = [
  { cluster: "AI科幻", keywords: ["科幻", "赛博朋克", "赛博庞克", "星际", "末日", "废土", "机甲", "太空", "ai", "sci-fi", "scifi"] },
  { cluster: "都市悬疑", keywords: ["悬疑", "推理", "刑侦", "犯罪", "惊悚", "盗墓", "探案"] },
  { cluster: "异能志怪", keywords: ["灵异", "志怪", "异能", "怪谈", "民俗", "克苏鲁", "玄幻", "仙侠", "修真", "修仙", "武侠", "诡秘"] },
  { cluster: "女频爱情", keywords: ["言情", "女频", "恋爱", "甜宠", "古言", "宅斗", "宫斗", "追妻", "总裁", "豪门"] },
  { cluster: "都市职场", keywords: ["都市", "职场", "商战", "官场", "赘婿", "种田", "体育", "娱乐圈", "现实"] },
];

/**
 * 建书阶段的必备能力位：新书最需要先把开篇与章节节奏立住。
 *
 * `namePreferences` 是同 kind 内的优先词。同一个 kind 下能力差别很大
 * （prose 里既有「创建小说正文」这类流程 skill，也有「正文润色」这类文笔 skill），
 * 只按 kind 挑会选出名不副实的那条，reason 就成了假话。
 */
const CORE_CAPABILITY_SLOTS: ReadonlyArray<{
  readonly kind: WritingSkillKind;
  readonly reasonSuffix: string;
  readonly baseScore: number;
  readonly namePreferences?: readonly string[];
}> = [
  {
    kind: "opening",
    reasonSuffix: "新书前三章决定留存，先把开篇钩子立住",
    baseScore: 100,
    namePreferences: ["强化章节开头", "黄金三章", "开篇"],
  },
  {
    kind: "pacing",
    reasonSuffix: "连载需要稳定的章末钩子与章内节奏",
    baseScore: 90,
    namePreferences: ["强化章末钩子", "章节控制卡", "节奏"],
  },
  {
    kind: "prose",
    reasonSuffix: "统一叙述腔调，避免逐章漂移",
    baseScore: 70,
    namePreferences: ["正文润色", "对白权力", "执行场景单元"],
  },
];

/** 平台答案 → 平台 skill 名称里的关键词。 */
const PLATFORM_KEYWORDS: ReadonlyArray<{ readonly keywords: readonly string[]; readonly match: string }> = [
  { keywords: ["番茄", "tomato"], match: "番茄" },
  { keywords: ["起点", "qidian"], match: "起点" },
  { keywords: ["七猫"], match: "七猫" },
  { keywords: ["晋江"], match: "晋江" },
  { keywords: ["飞卢", "feilu"], match: "飞卢" },
  { keywords: ["知乎"], match: "知乎" },
];

/** AI 味容忍度收紧时补一条去 AI 味/修订类 skill。 */
const STRICT_AI_TASTE_KEYWORDS = ["零容忍", "低容忍", "朱雀", "严格"];

function normalize(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function matchClusterIn(text: string): string | null {
  if (!text) return null;
  for (const { cluster, keywords } of GENRE_CLUSTERS) {
    if (keywords.some((keyword) => text.includes(keyword.toLowerCase()))) return cluster;
  }
  return null;
}

/**
 * 定题材簇。
 *
 * genre 与 tone **必须分开判定**：把两者拼成一个字符串会让基调劫持题材。
 * 实测过的错例：`genre=诡秘` + `tone=悬疑烧脑` → 「悬疑」先命中都市悬疑簇，
 * 于是一本规则怪谈拿到了整套都市悬疑技能（诡秘本该落异能志怪）。
 * tone 只在 genre 完全定不出簇时兜底。
 */
function matchGenreCluster(genre: string | undefined, tone: string | undefined): string | null {
  return matchClusterIn(normalize(genre)) ?? matchClusterIn(normalize(tone));
}

function hasTag(skill: ParsedWritingSkill, tag: string): boolean {
  return (skill.tags ?? []).some((candidate) => candidate.trim() === tag);
}

/** 「通用-xxx」类 skill：题材没命中时的兜底版本。 */
function isGeneralPurpose(skill: ParsedWritingSkill): boolean {
  return skill.name.includes("通用") || (skill.tags ?? []).length === 0;
}

/** 属于某个题材簇但不是当前簇 —— 这类必须排除，否则会把别的题材规则灌进本书。 */
function belongsToOtherCluster(skill: ParsedWritingSkill, currentCluster: string | null): boolean {
  return GENRE_CLUSTERS.some(({ cluster }) => cluster !== currentCluster && hasTag(skill, cluster));
}

/**
 * 在一个能力位上挑一条 skill。
 *
 * 优先级：名称偏好 + 题材版 → 名称偏好 + 通用版 → 题材版 → 通用版 → 任何非他簇候选。
 * 名称偏好先行，避免同 kind 内挑到能力不对的那条。
 */
function pickForSlot(
  skills: readonly ParsedWritingSkill[],
  kind: WritingSkillKind,
  cluster: string | null,
  namePreferences: readonly string[] = [],
): ParsedWritingSkill | null {
  const candidates = skills.filter((skill) => skill.kind === kind);
  if (candidates.length === 0) return null;

  const inCluster = (skill: ParsedWritingSkill): boolean => cluster !== null && hasTag(skill, cluster);
  const usableGeneral = (skill: ParsedWritingSkill): boolean =>
    isGeneralPurpose(skill) && !belongsToOtherCluster(skill, cluster);

  for (const preference of namePreferences) {
    const preferred = candidates.filter((skill) => skill.name.includes(preference));
    const picked = preferred.find(inCluster) ?? preferred.find(usableGeneral);
    if (picked) return picked;
  }

  return candidates.find(inCluster)
    ?? candidates.find(usableGeneral)
    ?? candidates.find((skill) => !belongsToOtherCluster(skill, cluster))
    ?? null;
}

function pickPlatformSkill(
  skills: readonly ParsedWritingSkill[],
  platform: string | undefined,
  cluster: string | null,
): { readonly skill: ParsedWritingSkill; readonly platformLabel: string } | null {
  const normalized = normalize(platform);
  if (!normalized || normalized.includes("暂不确定")) return null;
  const entry = PLATFORM_KEYWORDS.find(({ keywords }) => keywords.some((keyword) => normalized.includes(keyword)));
  if (!entry) return null;
  const candidates = skills.filter((skill) => skill.kind === "platform" && skill.name.includes(entry.match));
  const picked = (cluster !== null ? candidates.find((skill) => hasTag(skill, cluster)) : undefined)
    ?? candidates.find((skill) => isGeneralPurpose(skill) && !belongsToOtherCluster(skill, cluster))
    ?? candidates.find((skill) => !belongsToOtherCluster(skill, cluster));
  return picked ? { skill: picked, platformLabel: entry.match } : null;
}

/** 收紧 AI 味时补一条去 AI 味 skill；名称偏好确保挑到的是去味而不是大纲审阅。 */
function pickRevisionSkill(
  skills: readonly ParsedWritingSkill[],
  aiTasteLevel: string | undefined,
  cluster: string | null,
): ParsedWritingSkill | null {
  const normalized = normalize(aiTasteLevel);
  if (!normalized || !STRICT_AI_TASTE_KEYWORDS.some((keyword) => normalized.includes(keyword.toLowerCase()))) {
    return null;
  }
  return pickForSlot(skills, "revision", cluster, ["去AI味", "去 AI 味", "deslop", "humanizer"]);
}

/** 重度题材额外补一条情节/结构类 skill：世界观越大越需要结构约束。 */
function pickPlotSkill(
  skills: readonly ParsedWritingSkill[],
  complexity: string | undefined,
  cluster: string | null,
): ParsedWritingSkill | null {
  if (normalize(complexity) !== "heavy") return null;
  return pickForSlot(skills, "plot", cluster, ["设计分卷大纲", "设计故事设定", "大纲"]);
}

/**
 * 按十一问答案给出推荐清单。
 *
 * 纯函数：不读文件、不写 book.json。启用与否由作者确认后经
 * `writing-skills.write` 落库（Runtime 权限确认在那一步）。
 */
export function recommendWritingSkills(
  input: WritingSkillRecommendationInput,
  skills: readonly ParsedWritingSkill[],
): WritingSkillRecommendation {
  // mode=always 无需显式启用，不参与推荐。
  const selectable = skills.filter((skill) => skill.mode !== "always");
  const cluster = matchGenreCluster(input.genre, input.tone);
  const genreLabel = (input.genre ?? "").trim() || "未指定题材";

  const picks: Array<{ skill: ParsedWritingSkill; score: number; reason: string }> = [];
  const seen = new Set<string>();
  const push = (skill: ParsedWritingSkill | null, score: number, reason: string): void => {
    if (!skill || seen.has(skill.id)) return;
    seen.add(skill.id);
    picks.push({ skill, score, reason });
  };

  for (const slot of CORE_CAPABILITY_SLOTS) {
    const skill = pickForSlot(selectable, slot.kind, cluster, slot.namePreferences ?? []);
    if (!skill) continue;
    const source = cluster !== null && hasTag(skill, cluster) ? `题材「${cluster}」` : "通用能力位";
    push(skill, slot.baseScore, `${source}：${slot.reasonSuffix}`);
  }

  const platform = pickPlatformSkill(selectable, input.platform, cluster);
  if (platform) {
    push(platform.skill, 85, `平台选了「${platform.platformLabel}」：按该平台的字数与章节规范输出`);
  }

  const revision = pickRevisionSkill(selectable, input.aiTasteLevel, cluster);
  push(revision, 80, `AI 味容忍度填了「${(input.aiTasteLevel ?? "").trim()}」：写后需要去 AI 味复核`);

  const plot = pickPlotSkill(selectable, input.complexity, cluster);
  push(plot, 60, `题材「${genreLabel}」判定为重度设定：需要结构与情节线约束`);

  // conflictGroup 撞车时保留分数最高的一条，落选项记账让作者可查。
  picks.sort((left, right) => right.score - left.score || left.skill.id.localeCompare(right.skill.id));
  const usedConflictGroups = new Set<string>();
  const droppedByConflict: string[] = [];
  const kept: typeof picks = [];
  for (const pick of picks) {
    const group = pick.skill.conflictGroup?.trim();
    if (group) {
      if (usedConflictGroups.has(group)) {
        droppedByConflict.push(pick.skill.id);
        continue;
      }
      usedConflictGroups.add(group);
    }
    kept.push(pick);
  }

  return {
    recommended: kept.slice(0, MAX_RECOMMENDED_WRITING_SKILLS).map((pick) => ({
      id: pick.skill.id,
      slug: pick.skill.slug,
      name: pick.skill.name,
      kind: pick.skill.kind,
      score: pick.score,
      reason: pick.reason,
    })),
    consideredCount: selectable.length,
    droppedByConflict,
    matchedGenreCluster: cluster,
  };
}
