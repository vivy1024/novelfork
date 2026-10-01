/**
 * 文风预设 → 本书专属 Writing Skill（T3.5 第二步）。
 *
 * 把文风预设里「已确认且可迁移」的来源规则汇总生成为书级技能文件
 * `.novelfork/skills/<slug>/SKILL.md`。内容由本书自己的确认规则原创生成；
 * 待审、作品专属条目与人物/世界/剧情设定都不进入技能。重复生成覆盖同一 slug。
 */

import { loadStylePreset } from "../writing-layers/style-preset-store.js";
import { projectWritingSkillFile, writeProjectWritingSkillRaw } from "./project-storage.js";
import type { ParsedWritingSkill } from "./types.js";

export const BOOK_STYLE_MEMORY_SKILL_SLUG = "book-style-memory";
export const BOOK_STYLE_MEMORY_SKILL_RELATIVE_PATH = ".novelfork/skills/book-style-memory/SKILL.md";

export class StyleSkillExportError extends Error {
  constructor(message: string, readonly code: "STYLE_SKILL_EXPORT_EMPTY") {
    super(message);
    this.name = "StyleSkillExportError";
  }
}

export interface StyleSkillExportResult {
  readonly slug: string;
  /** 书内相对路径，固定为 PROJECT_WRITING_SKILLS_RELATIVE_DIR 下的 SKILL.md。 */
  readonly file: string;
  readonly content: string;
  readonly ruleCount: number;
  readonly sourceTitles: readonly string[];
  readonly skill: Pick<ParsedWritingSkill, "id" | "slug" | "name" | "description" | "kind" | "mode">;
}

function markdownListSafe(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

/** 汇总预设中全部「已确认且可迁移」的来源规则，生成 SKILL.md 文本。 */
export function buildBookStyleSkillContent(preset: {
  readonly sources: readonly {
    readonly title: string;
    readonly rules: readonly { readonly text: string; readonly transfer: string; readonly status: string }[];
  }[];
}): { readonly content: string; readonly ruleCount: number; readonly sourceTitles: readonly string[] } | null {
  const entries = preset.sources.flatMap((source) => source.rules
    .filter((rule) => rule.transfer === "transferable" && rule.status === "confirmed")
    .map((rule) => ({ text: markdownListSafe(rule.text), sourceTitle: source.title })));
  if (entries.length === 0) return null;
  const sourceTitles = [...new Set(entries.map((entry) => entry.sourceTitle))];
  const rules = entries.map((entry) => `- ${entry.text}（来源：${entry.sourceTitle}）`).join("\n");
  const content = `---
id: ${BOOK_STYLE_MEMORY_SKILL_SLUG}
name: 本书写法记忆
description: 汇总本书文风预设中作者已确认、标记为可迁移的写法规则；写作或修改本书正文时按这些规则把握文风。
kind: prose
mode: manual
tags:
  - 文风
  - 本书专属
---

# 本书写法记忆

本技能由本书文风预设汇总生成，收录作者逐条确认、标记为可迁移的写法规则，共 ${entries.length} 条。

## 什么时候用

写作、续写、改写或润色本书正文时，把下面的规则当成本书文风约束。人物、世界与剧情设定仍以经纬和作者当前要求为准，本技能只管「怎么写」。

## 已确认写法

${rules}

## 纪律

- 规则之间冲突时，以作者最近一次确认为准；拿不准就先问作者。
- 作者增补或改写风格记忆后，重新生成会用最新汇总覆盖本文件。
`;
  return { content, ruleCount: entries.length, sourceTitles };
}

/**
 * 读取当前预设并生成/更新本书专属技能。预设缺失、损坏或没有可收录规则时抛错，
 * 不写任何文件。落盘复用书级技能的既有写入路径（frontmatter 校验不过会拒绝写入）。
 */
export async function exportBookStyleSkill(bookRoot: string): Promise<StyleSkillExportResult> {
  const loaded = await loadStylePreset(bookRoot);
  const built = loaded.preset ? buildBookStyleSkillContent(loaded.preset) : null;
  if (!built) {
    throw new StyleSkillExportError(
      "文风预设里还没有「已确认且可迁移」的来源规则，没有内容可生成本书技能。",
      "STYLE_SKILL_EXPORT_EMPTY",
    );
  }
  const skill = await writeProjectWritingSkillRaw(bookRoot, BOOK_STYLE_MEMORY_SKILL_SLUG, built.content);
  const file = projectWritingSkillFile(bookRoot, BOOK_STYLE_MEMORY_SKILL_SLUG);
  return {
    slug: skill.slug,
    file: file ?? BOOK_STYLE_MEMORY_SKILL_RELATIVE_PATH,
    content: built.content,
    ruleCount: built.ruleCount,
    sourceTitles: built.sourceTitles,
    skill: {
      id: skill.id,
      slug: skill.slug,
      name: skill.name,
      description: skill.description,
      kind: skill.kind,
      mode: skill.mode,
    },
  };
}
