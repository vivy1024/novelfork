/**
 * Runtime Skill 生效记录。
 *
 * Skill 的真实性由 Runtime narratorToolCalls 中同一 narrator 的成功 Skill 调用证明；
 * 产品工具不再要求模型提交长原文引用，也不在工具内部再次调用模型。
 */

export const MIN_SKILL_QUOTE_CHARS = 0;

export interface AcknowledgeableWritingSkill {
  readonly slug: string;
  readonly name: string;
  readonly body?: string;
  readonly description?: string;
  readonly kind?: string;
  readonly tags?: readonly string[];
  readonly mode?: string;
}

/** 兼容旧客户端：quote 保留但不再参与门禁。 */
export interface WritingSkillAcknowledgement {
  readonly slug?: string;
  readonly name?: string;
  readonly quote?: string;
}

export interface RuntimeLoadedSkillEvidence {
  readonly name: string;
  readonly loadedAt: string;
  readonly contentHash?: string;
}

export interface WritingSkillAcknowledgementRequirement {
  readonly slug: string;
  readonly name: string;
  readonly minQuoteChars: number;
}

export interface WritingSkillAcknowledgementVerdict {
  readonly ok: boolean;
  /** 当前任务相关、但同一 Runtime narrator 尚未成功加载的技能。 */
  readonly missing: readonly string[];
  readonly tooShort: readonly string[];
  readonly notFound: readonly string[];
  readonly unknown: readonly string[];
  readonly loaded: readonly string[];
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function skillEvidenceMatches(skill: AcknowledgeableWritingSkill, evidence: RuntimeLoadedSkillEvidence): boolean {
  const target = normalize(evidence.name);
  return target === normalize(skill.name) || target === normalize(skill.slug);
}

/**
 * 按当前任务筛选相关技能。显式任务词命中名称/描述/kind/tags 的技能优先；
 * always 技能始终相关；无法从任务文本判定时保留全部启用技能，避免误漏用户规则。
 */
export function selectRelevantWritingSkills(
  skills: readonly AcknowledgeableWritingSkill[],
  taskText = "",
): readonly AcknowledgeableWritingSkill[] {
  const text = normalize(taskText);
  if (!text.trim()) return skills;
  const matched = skills.filter((skill) => {
    if (skill.mode === "always") return true;
    const searchable = [skill.slug, skill.name, skill.description ?? "", skill.kind ?? "", ...(skill.tags ?? [])]
      .map(normalize)
      .filter(Boolean);
    return searchable.some((token) => token.length >= 2 && text.includes(token));
  });
  return matched.length > 0 ? matched : skills;
}

/** 兼容旧字段名；现在只返回相关技能清单，不声明引用长度要求。 */
export function describeWritingSkillAcknowledgementRequirement(
  skills: readonly AcknowledgeableWritingSkill[],
): readonly WritingSkillAcknowledgementRequirement[] {
  return skills.map((skill) => ({ slug: skill.slug, name: skill.name, minQuoteChars: 0 }));
}

export function verifyWritingSkillAcknowledgements(params: {
  readonly skills: readonly AcknowledgeableWritingSkill[];
  readonly acknowledged?: readonly WritingSkillAcknowledgement[];
  readonly loadedSkills?: readonly RuntimeLoadedSkillEvidence[];
  readonly taskText?: string;
}): WritingSkillAcknowledgementVerdict {
  const relevant = selectRelevantWritingSkills(params.skills, params.taskText);
  const loadedSkills = params.loadedSkills ?? [];
  const missing = relevant
    .filter((skill) => !loadedSkills.some((evidence) => skillEvidenceMatches(skill, evidence)))
    .map((skill) => skill.slug);
  const loaded = relevant
    .filter((skill) => loadedSkills.some((evidence) => skillEvidenceMatches(skill, evidence)))
    .map((skill) => skill.slug);

  const known = new Set(params.skills.map((skill) => skill.slug));
  const unknown = (params.acknowledged ?? [])
    .filter((item) => typeof item.slug === "string" && item.slug.trim() && !known.has(item.slug.trim()))
    .map((item) => item.slug!.trim());

  return { ok: missing.length === 0 && unknown.length === 0, missing, tooShort: [], notFound: [], unknown, loaded };
}

export function explainWritingSkillAcknowledgementVerdict(params: {
  readonly verdict: WritingSkillAcknowledgementVerdict;
  readonly skills: readonly AcknowledgeableWritingSkill[];
}): { readonly whatHappened: string; readonly whyItMatters: string; readonly suggestedAction: string } {
  const nameOf = (slug: string) => params.skills.find((skill) => skill.slug === slug)?.name ?? slug;
  const missing = params.verdict.missing.map(nameOf);
  const unknown = params.verdict.unknown;
  const parts: string[] = [];
  if (missing.length > 0) parts.push(`当前任务相关技能尚未由本 Runtime Agent 加载：${missing.join("、")}`);
  if (unknown.length > 0) parts.push(`提交了本书未启用的技能：${unknown.join("、")}`);
  return {
    whatHappened: parts.join("；") || "当前任务相关 Writing Skills 已由同一 Runtime Agent 加载。",
    whyItMatters:       "技能生效证据必须来自同一 narrator 会话的真实 Skill 调用，不能由模型自行伪造引用或由工具内部另开模型会话。",

    suggestedAction: missing.length > 0
      ? `请先在当前会话调用 Skill 读取：${missing.join("、")}，然后重试写作工具。`
      : "可以继续执行当前写作工具。",
  };
}
