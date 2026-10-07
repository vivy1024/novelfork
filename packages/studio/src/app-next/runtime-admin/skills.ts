// 技能数据类型：产品契约（书籍技能网关）在使用。
// 全局/项目技能的管理读写由 Runtime 原页承担，Studio 不再保留 createSkillsClient。

export interface SkillSummary {
  readonly name: string;
  readonly description: string;
  readonly location: string;
  readonly files: readonly string[];
  readonly disabled?: boolean;
}

export interface Skill extends SkillSummary {
  readonly content: string;
}

export interface SkillInput {
  readonly name: string;
  readonly description: string;
  readonly content: string;
}

export interface SkillUpdateInput {
  readonly name?: string;
  readonly description: string;
  readonly content: string;
}
