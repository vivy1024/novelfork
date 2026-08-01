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
export type WritingSkillMode = "manual" | "auto" | "always";
export type WritingSkillSource = "builtin" | "user";

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

interface WritingSkillComplianceCheckBase {
  /** 可选的稳定标识，便于执行结果回写到声明的检查项。 */
  readonly id?: string;
  /** 展示给作者的失败说明；缺省时由执行器提供默认说明。 */
  readonly message?: string;
  /** 缺省为 `warning`：只有显式声明 `error` 才会阻断保存。 */
  readonly severity?: "warning" | "error";
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
