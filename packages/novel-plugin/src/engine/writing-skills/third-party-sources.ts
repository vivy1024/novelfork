/**
 * 第三方写作技能来源的唯一登记表。
 *
 * 2026-09-29 起第三方技能一律不随 NovelFork 内置分发（T3.2）：内置只保留
 * `packages/novel-plugin/builtin-skills/` 下的 NovelFork 自研技能。这里记录过去曾以
 * `nf-<前缀>--<名>` 形式内置过的来源——已有书籍目录里可能还留着这些技能的副本，
 * 界面需要认出它们并标明「来源已移出内置」。
 *
 * 「可选技能来源」那个面向作者的清单已随 S-9 下线：技能的安装与管理统一归 Runtime
 * 的「套路 › 项目技能」（同一批 `.novelfork/skills` 目录），面板不再复制一份。
 * 许可与说明保留，因为「来源已移出内置」的徽标仍需标明许可与出处。
 *
 * 纯数据模块，不依赖 Node API。
 */

import type { WritingSkillProvenance } from "./types.js";

export interface ThirdPartySkillSource {
  /** 历史内置 slug 的前缀：`nf-<slugPrefix>--<名>`。 */
  readonly slugPrefix: string;
  readonly repo: string;
  /** SPDX 标识；`UNSPECIFIED` 表示上游没有许可证（保留所有权利）。 */
  readonly license: string;
  /** 上游内容的一句话说明（登记溯源用；界面不再单独列出这份清单）。 */
  readonly note: string;
}

export const THIRD_PARTY_SKILL_SOURCES: ReadonlyArray<ThirdPartySkillSource> = [
  {
    slugPrefix: "worldwonderer",
    repo: "https://github.com/worldwonderer/oh-story-claudecode",
    license: "MIT",
    note: "长篇 / 短篇的扫榜、拆解、写作与审阅流程技能。",
  },
  {
    slugPrefix: "lay",
    repo: "https://github.com/LAY-lgtm/novel-writing-framework",
    license: "MIT",
    note: "小说写作框架：大纲、人物、改稿等方法。上游是普通 Markdown，需自行整理成 SKILL.md 目录。",
  },
  {
    slugPrefix: "xinganliu",
    repo: "https://github.com/XINGANLIU/web-novel-writing-skill",
    license: "MIT",
    note: "网文写作技能合集。",
  },
  {
    slugPrefix: "goink",
    repo: "https://github.com/sigpanic/goink-skills",
    license: "CC-BY-SA-4.0",
    note: "情感弧等写作方法；上游是普通 Markdown，需自行整理成 SKILL.md 目录，衍生内容须署名并以相同许可共享。",
  },
  {
    slugPrefix: "lornshrimp",
    repo: "https://github.com/lornshrimp/Lorn.NovelWriteSkills",
    license: "UNSPECIFIED",
    note: "上游未声明许可证，不能分发，也不提供安装。",
  },
  {
    slugPrefix: "mane23-ai",
    repo: "https://github.com/mane23-ai/claude-novel-skill",
    license: "UNSPECIFIED",
    note: "上游未声明许可证，不能分发，也不提供安装。",
  },
  {
    slugPrefix: "zy-zmc",
    repo: "https://github.com/zy-zmc/tianming-skill",
    license: "CC-BY-NC-SA-4.0",
    note: "许可证禁止商业使用，不随产品提供。",
  },
];

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
