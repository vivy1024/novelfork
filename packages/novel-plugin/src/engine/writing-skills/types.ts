/**
 * `SKILL.md` 解析后的瞬态 DTO。
 *
 * Writing Skills 没有数据库实体、Repository 或全局 registry；这些类型只描述
 * 当前请求/当前写作调用从文件读取到的内容。
 */

export const WRITING_SKILL_KINDS = [
  "opening",
  "pacing",
  "character",
  "plot",
  "prose",
  "revision",
  "platform",
  "packaging",
  "research",
  "workflow",
] as const;

export type WritingSkillKind = (typeof WRITING_SKILL_KINDS)[number];

/**
 * 「NovelFork 创作」预设的作者入口，顺序即界面陈列顺序。
 *
 * 技能在 frontmatter 写 `entry: <入口名>` 即成为该入口；未声明的技能不对作者陈列为入口，
 * 由模型按任务调用。入口集合是产品决定，不在这里的值会被解析器忽略。
 */
export const WRITING_SKILL_ENTRIES = [
  "看进度",
  "写下一章",
  "审这一章",
  "改这段",
  "伏笔",
  "设定",
  "写法记忆",
  "导出",
] as const;

export type WritingSkillEntry = (typeof WRITING_SKILL_ENTRIES)[number];
export type WritingSkillMode = "manual" | "auto" | "always";
export type WritingSkillSource = "builtin" | "user" | "project";

export interface WritingSkillProvenance {
  readonly repo: string;
  readonly license: string;
  readonly upstreamPath?: string;
}

/** 可由 SKILL.md frontmatter 声明、供后续合规校验执行器消费的检查类型。 */
export const WRITING_SKILL_COMPLIANCE_CHECK_TYPES = [
  "required-terms",
  "forbidden-terms",
  "pattern",
] as const;

export type WritingSkillComplianceCheckType =
  (typeof WRITING_SKILL_COMPLIANCE_CHECK_TYPES)[number];

/**
 * 检查作用目标。缺省 `prose`（对章节正文生效）；
 * `card` 表示面向设定卡/设计文档的检查（如人物基线、情感弧设计），
 * 不会进章节正文校验、也不会进 scene.spec 的写作约束摘要——
 * 否则模型会为通过 required-terms 把「理智/温和…」这种人设字段写进正文。
 */
export type WritingSkillCheckTarget = "prose" | "card";

interface WritingSkillComplianceCheckBase {
  /** 可选的稳定标识，便于执行结果回写到声明的检查项。 */
  readonly id?: string;
  /** 展示给作者的失败说明；缺省时由执行器提供默认说明。 */
  readonly message?: string;
  /** 缺省为 `warning`：只有显式声明 `error` 才会阻断保存。 */
  readonly severity?: "warning" | "error";
  /** 缺省为 `prose`；见 WritingSkillCheckTarget。 */
  readonly target?: WritingSkillCheckTarget;
}

export interface WritingSkillRequiredTermsCheck extends WritingSkillComplianceCheckBase {
  readonly type: "required-terms";
  readonly terms: ReadonlyArray<string>;
  /** 每个词至少出现几次；缺省为 1。 */
  readonly minOccurrences?: number;
}

export interface WritingSkillForbiddenTermsCheck extends WritingSkillComplianceCheckBase {
  readonly type: "forbidden-terms";
  readonly terms: ReadonlyArray<string>;
}

export interface WritingSkillPatternCheck extends WritingSkillComplianceCheckBase {
  readonly type: "pattern";
  /** 仅接受 loader 通过安全校验的正则模式。 */
  readonly pattern: string;
  /** 不接受 g/y，避免未来执行器出现有状态匹配。 */
  readonly flags?: "i" | "m" | "im";
  readonly minMatches?: number;
  readonly maxMatches?: number;
}

export type WritingSkillComplianceCheck =
  | WritingSkillRequiredTermsCheck
  | WritingSkillForbiddenTermsCheck
  | WritingSkillPatternCheck;

export interface ParsedWritingSkill {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly kind: WritingSkillKind;
  /** SKILL.md frontmatter 之后的 Markdown 正文。 */
  readonly body: string;
  readonly source: WritingSkillSource;
  readonly mode: WritingSkillMode;
  /** 作者入口；未声明表示该技能由模型按任务调用，不作为作者入口陈列。 */
  readonly entry?: WritingSkillEntry;
  readonly compatibleGenres?: ReadonlyArray<string>;
  readonly tags?: ReadonlyArray<string>;
  readonly conflictGroup?: string;
  readonly author?: string;
  readonly version?: string;
  readonly references?: ReadonlyArray<string>;
  /** 声明式写作合规检查；未声明时保持既有行为。 */
  readonly checks?: ReadonlyArray<WritingSkillComplianceCheck>;
  readonly provenance?: WritingSkillProvenance;
}
