/**
 * 第三方写作技能来源的唯一登记表。
 *
 * 2026-09-29 起第三方技能一律不随 NovelFork 内置分发（T3.2）：内置只保留
 * `packages/novel-plugin/builtin-skills/` 下的 NovelFork 自研技能。这里记录：
 *
 * 1. 过去曾以 `nf-<前缀>--<名>` 形式内置过的来源——已有书籍目录里可能还留着
 *    这些技能的副本，界面需要认出它们并标明「来源已移出内置」；
 * 2. 哪些来源许可明确、可以作为「可选技能来源」告诉作者自行安装。
 *
 * 纯数据模块，不依赖 Node API，界面与脚本都从这里读取，避免两处各写一份许可表。
 */

import type { WritingSkillProvenance } from "./types.js";

export interface ThirdPartySkillSource {
  /** 历史内置 slug 的前缀：`nf-<slugPrefix>--<名>`。 */
  readonly slugPrefix: string;
  readonly repo: string;
  /** SPDX 标识；`UNSPECIFIED` 表示上游没有许可证（保留所有权利）。 */
  readonly license: string;
  /**
   * 是否可以列为「可选技能来源」。只有许可证明确允许使用与再分发的仓库为 true；
   * 未声明许可证或禁止商用的仓库永远不列出、也不提供一键安装。
   */
  readonly optional: boolean;
  /** 给作者看的一句话说明。 */
  readonly note: string;
}

export const THIRD_PARTY_SKILL_SOURCES: ReadonlyArray<ThirdPartySkillSource> = [
  {
    slugPrefix: "worldwonderer",
    repo: "https://github.com/worldwonderer/oh-story-claudecode",
    license: "MIT",
    optional: true,
    note: "长篇 / 短篇的扫榜、拆解、写作与审阅流程技能。",
  },
  {
    slugPrefix: "lay",
    repo: "https://github.com/LAY-lgtm/novel-writing-framework",
    license: "MIT",
    optional: true,
    note: "小说写作框架：大纲、人物、改稿等方法。上游是普通 Markdown，需自行整理成 SKILL.md 目录。",
  },
  {
    slugPrefix: "xinganliu",
    repo: "https://github.com/XINGANLIU/web-novel-writing-skill",
    license: "MIT",
    optional: true,
    note: "网文写作技能合集。",
  },
  {
    slugPrefix: "goink",
    repo: "https://github.com/sigpanic/goink-skills",
    license: "CC-BY-SA-4.0",
    optional: true,
    note: "情感弧等写作方法；上游是普通 Markdown，需自行整理成 SKILL.md 目录，衍生内容须署名并以相同许可共享。",
  },
  {
    slugPrefix: "lornshrimp",
    repo: "https://github.com/lornshrimp/Lorn.NovelWriteSkills",
    license: "UNSPECIFIED",
    optional: false,
    note: "上游未声明许可证，不能分发，也不提供安装。",
  },
  {
    slugPrefix: "mane23-ai",
    repo: "https://github.com/mane23-ai/claude-novel-skill",
    license: "UNSPECIFIED",
    optional: false,
    note: "上游未声明许可证，不能分发，也不提供安装。",
  },
  {
    slugPrefix: "zy-zmc",
    repo: "https://github.com/zy-zmc/tianming-skill",
    license: "CC-BY-NC-SA-4.0",
    optional: false,
    note: "许可证禁止商业使用，不随产品提供。",
  },
];

/** 许可明确、可以告诉作者自行安装的来源。 */
export const OPTIONAL_SKILL_SOURCES: ReadonlyArray<ThirdPartySkillSource> =
  THIRD_PARTY_SKILL_SOURCES.filter((source) => source.optional);

/**
 * 若 slug 是曾经内置过的第三方技能（`nf-<前缀>--<名>`），返回其来源；否则返回 null。
 *
 * 只按登记过的前缀识别，作者自建技能即使名字里带 `--` 也不会被误判。
 */
export function retiredBuiltinSourceOf(slug: string): ThirdPartySkillSource | null {
  for (const source of THIRD_PARTY_SKILL_SOURCES) {
    const prefix = `nf-${source.slugPrefix}--`;
    if (slug.startsWith(prefix) && slug.length > prefix.length) return source;
  }
  return null;
}

export function retiredBuiltinProvenanceOf(slug: string): WritingSkillProvenance | undefined {
  const source = retiredBuiltinSourceOf(slug);
  return source ? { repo: source.repo, license: source.license } : undefined;
}
