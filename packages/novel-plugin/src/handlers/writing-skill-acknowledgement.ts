/**
 * Writing Skill 生效强制机制 —— 不依赖模型自觉。
 *
 * 问题：Skills 启用后物化到作品 `.novelfork/skills/`，Runtime 会把它们交给
 * 正在调用工具的 agent，但「交到了」不等于「读了并照做」。有些模型根本不主动
 * 打开 SKILL.md，写前提示词又无法强制。
 *
 * 做法：写章前要求调用方对每个已启用技能提交一段**原文引用**。引用必须是该
 * SKILL.md 正文里的连续子串且不短于下限——没真正读过文件就拿不出来。
 * 这里不用内容哈希：哈希需要由产品侧先算给模型，模型照抄即可通过，等于没门。
 */

/**
 * 单条引用的最小长度（按去空白后的字符数）。
 * 30 字的中文原句已经不可能靠猜命中，同时不会苛刻到逼作者的短条目无法引用。
 */
export const MIN_SKILL_QUOTE_CHARS = 30;

export interface AcknowledgeableWritingSkill {
  readonly slug: string;
  readonly name: string;
  readonly body: string;
}

export interface WritingSkillAcknowledgement {
  readonly slug: string;
  readonly quote: string;
}

export interface WritingSkillAcknowledgementRequirement {
  readonly slug: string;
  readonly name: string;
  readonly minQuoteChars: number;
}

export interface WritingSkillAcknowledgementVerdict {
  readonly ok: boolean;
  /** 完全没有提交引用的技能 slug。 */
  readonly missing: readonly string[];
  /** 提交了但长度不足下限的技能 slug。 */
  readonly tooShort: readonly string[];
  /** 提交了但在该技能正文中找不到的技能 slug（说明不是原文）。 */
  readonly notFound: readonly string[];
  /** 提交了但本书并未启用该技能的 slug。 */
  readonly unknown: readonly string[];
}

/**
 * 比较前去掉全部空白。
 *
 * 只折叠成单空格不够：中文正文里换行处本来没有空格，模型按行复制后
 * 会在原文没有空白的位置多出一个空格，导致原文引用被误判为编造。
 * 直接剥离空白后比较，允许任意重新折行与缩进，但不允许改字。
 */
function normalizeForMatch(text: string): string {
  return text.replace(/\s+/gu, "");
}

export function describeWritingSkillAcknowledgementRequirement(
  skills: readonly AcknowledgeableWritingSkill[],
): readonly WritingSkillAcknowledgementRequirement[] {
  return skills
    .filter((skill) => normalizeForMatch(skill.body).length >= MIN_SKILL_QUOTE_CHARS)
    .map((skill) => ({ slug: skill.slug, name: skill.name, minQuoteChars: MIN_SKILL_QUOTE_CHARS }));
}

export function verifyWritingSkillAcknowledgements(params: {
  readonly skills: readonly AcknowledgeableWritingSkill[];
  readonly acknowledged: readonly WritingSkillAcknowledgement[];
}): WritingSkillAcknowledgementVerdict {
  const required = describeWritingSkillAcknowledgementRequirement(params.skills);
  const bySlug = new Map(params.skills.map((skill) => [skill.slug, skill]));
  const submitted = new Map<string, string>();
  const unknown: string[] = [];

  for (const item of params.acknowledged) {
    const slug = item.slug?.trim();
    if (!slug) continue;
    if (!bySlug.has(slug)) {
      unknown.push(slug);
      continue;
    }
    submitted.set(slug, item.quote ?? "");
  }

  const missing: string[] = [];
  const tooShort: string[] = [];
  const notFound: string[] = [];

  for (const requirement of required) {
    const quote = submitted.get(requirement.slug);
    if (quote === undefined) {
      missing.push(requirement.slug);
      continue;
    }
    const normalizedQuote = normalizeForMatch(quote);
    if (normalizedQuote.length < requirement.minQuoteChars) {
      tooShort.push(requirement.slug);
      continue;
    }
    const body = normalizeForMatch(bySlug.get(requirement.slug)?.body ?? "");
    if (!body.includes(normalizedQuote)) notFound.push(requirement.slug);
  }

  return {
    ok: missing.length === 0 && tooShort.length === 0 && notFound.length === 0 && unknown.length === 0,
    missing,
    tooShort,
    notFound,
    unknown,
  };
}

/** 把判定结果写成可直接转述的三段式说明。 */
export function explainWritingSkillAcknowledgementVerdict(params: {
  readonly verdict: WritingSkillAcknowledgementVerdict;
  readonly skills: readonly AcknowledgeableWritingSkill[];
}): { readonly whatHappened: string; readonly whyItMatters: string; readonly suggestedAction: string } {
  const nameOf = (slug: string) => params.skills.find((skill) => skill.slug === slug)?.name ?? slug;
  const parts: string[] = [];
  if (params.verdict.missing.length > 0) {
    parts.push(`未提交原文引用：${params.verdict.missing.map(nameOf).join("、")}`);
  }
  if (params.verdict.tooShort.length > 0) {
    parts.push(`引用长度不足 ${MIN_SKILL_QUOTE_CHARS} 字：${params.verdict.tooShort.map(nameOf).join("、")}`);
  }
  if (params.verdict.notFound.length > 0) {
    parts.push(`引用在该技能正文中找不到：${params.verdict.notFound.map(nameOf).join("、")}`);
  }
  if (params.verdict.unknown.length > 0) {
    parts.push(`提交了本书未启用的技能：${params.verdict.unknown.join("、")}`);
  }
  return {
    whatHappened: parts.join("；") || "已启用的 Writing Skills 尚未确认。",
    whyItMatters:
      "写章前必须确认已读过本书启用的写作技能。只靠提示词要求模型「记得看技能」不可靠：不读也能照写，作者定的文风与节奏就形同虚设。",
    suggestedAction:
      "逐个读取作品目录下 .novelfork/skills/<slug>/SKILL.md，把其中一段不少于 " +
      `${MIN_SKILL_QUOTE_CHARS} 字的原文放进 acknowledgedSkills:[{slug,quote}] 再重试。引用需为原文连续片段，允许换行与缩进不同。`,
  };
}
