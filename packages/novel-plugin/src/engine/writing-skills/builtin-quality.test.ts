// @vitest-environment node

/**
 * 内置技能质量门禁（T3.2 内置瘦身 / T3.1 创作预设 / T3.3 三分）。
 *
 * 内置只放 NovelFork 自研、MIT 许可的技能；方法论写在 SKILL.md、机器检查只做
 * 「不许出现」一类判定、书级设定留给经纬与文风预设。这里把这些约定写成可执行的检查，
 * 新增或修改内置技能时违反任何一条都会失败。
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { NOVEL_TOOL_NAMES } from "../../handlers/tool-registry.js";
import { toWireToolName } from "../workflows/run-brief.js";
import { BUNDLED_WRITING_SKILLS } from "./bundled-skills.generated.js";
import { BUILTIN_WRITING_SKILLS_DIR, loadWritingSkillsSync, parseWritingSkill, splitFrontmatter } from "./loader.js";
import { THIRD_PARTY_SKILL_SOURCES, retiredBuiltinSourceOf } from "./third-party-sources.js";
import {
  WRITING_SKILL_ENTRIES,
  WRITING_SKILL_KINDS,
  type ParsedWritingSkill,
  type WritingSkillComplianceCheck,
} from "./types.js";

/** 单个 SKILL.md 正文的字符预算；长材料放进 references/ 按需读取。 */
const MAX_BODY_CHARS = 7000;
const MAX_DESCRIPTION_CHARS = 300;
const MIN_BUILTIN_COUNT = 15;
const MAX_BUILTIN_COUNT = 21;

/** 入口与承担它的技能：入口集合是产品决定，改动需同步更新这里。 */
const EXPECTED_ENTRY_SLUGS: Readonly<Record<(typeof WRITING_SKILL_ENTRIES)[number], string>> = {
  看进度: "nf-progress",
  写下一章: "nf-write-chapter",
  审这一章: "nf-review-chapter",
  改这段: "nf-revise-passage",
  伏笔: "nf-foreshadow",
  设定: "nf-lore",
  写法记忆: "nf-style-memory",
  导出: "nf-export",
};

/**
 * 性格/人设形容词。它们的取值属于本书经纬，技能若把它们声明为必现或模式要求，
 * 等于在方法论里写死了书级设定（第 28/29 章事故的根因）。
 */
const PERSONA_TERMS = [
  "理智", "冲动", "温和", "强硬", "独立", "依赖", "乐观", "悲观", "诚实", "狡诈",
  "冷酷", "腹黑", "傲娇", "高冷", "善良", "阴险", "天真", "沉稳",
];

/** 文件扩展名：`volume_outline.md` 之类不是工具名。 */
const FILE_EXTENSIONS = new Set(["md", "json", "ts", "js", "mjs", "cjs", "txt", "yaml", "yml", "tsx"]);

interface BuiltinSkillFile {
  readonly slug: string;
  readonly raw: string;
  readonly frontmatter: Record<string, unknown>;
  readonly parsed: ParsedWritingSkill;
  readonly source: Record<string, unknown>;
}

function listBuiltinDirs(): string[] {
  return readdirSync(BUILTIN_WRITING_SKILLS_DIR)
    .filter((name) => statSync(join(BUILTIN_WRITING_SKILLS_DIR, name)).isDirectory())
    .sort();
}

function loadBuiltinFiles(): BuiltinSkillFile[] {
  return listBuiltinDirs().map((slug) => {
    const dir = join(BUILTIN_WRITING_SKILLS_DIR, slug);
    const raw = readFileSync(join(dir, "SKILL.md"), "utf8");
    const split = splitFrontmatter(raw);
    const parsed = parseWritingSkill(raw, slug, "builtin");
    if (!split || !parsed) throw new Error(`内置技能 ${slug} 的 SKILL.md 无法解析`);
    return {
      slug,
      raw,
      frontmatter: split.data as Record<string, unknown>,
      parsed,
      source: JSON.parse(readFileSync(join(dir, "_source.json"), "utf8")) as Record<string, unknown>,
    };
  });
}

/** 模型实际看到的工具名：目录名的点换成下划线（与 Runtime 注册时的转换同一规则）。 */
const WIRE_TOOL_NAMES = new Set(NOVEL_TOOL_NAMES.map(toWireToolName));
const TOOL_NAMESPACES = new Set(NOVEL_TOOL_NAMES.map((name) => name.split(".")[0]!));
/** 与工具同命名空间前缀、但其实是工具参数字段的 snake_case 名。 */
const TOOL_FIELD_NAMES = new Set(["hooks_planted", "hooks_paid_off", "hooks_advanced"]);

/**
 * 从正文与描述里抽出像工具名的引用，分两类：
 * - dotted：目录里的点号名（`chapter.read`）。技能原文直接进模型上下文，不经过 Runtime 的名称翻译，
 *   模型拿到的工具叫 chapter_read，写点号名它对不上号，所以一律判错；
 * - wire：命名空间与现有工具相同的下划线标识符（`chapter_read`、`hooks_manage(action=list)`），必须真实存在。
 */
function referencedToolNames(text: string): { dotted: string[]; wire: string[] } {
  const dotted = new Set<string>();
  const wire = new Set<string>();
  // 反引号内的点号标识符一律当作工具引用（扩展名除外）。
  for (const match of text.matchAll(/`([a-z][a-z-]*\.[a-z][a-z_.]*)`/g)) {
    const token = match[1]!;
    if (!FILE_EXTENSIONS.has(token.split(".").at(-1)!)) dotted.add(token);
  }
  // 裸写的点号引用：命名空间与现有工具相同。
  for (const match of text.matchAll(/(?<![\w./-])([a-z][a-z-]*)\.([a-z][a-z_.]*[a-z])(?![\w-])/g)) {
    if (TOOL_NAMESPACES.has(match[1]!) && !FILE_EXTENSIONS.has(match[2]!.split(".").at(-1)!)) dotted.add(`${match[1]}.${match[2]}`);
  }
  // 下划线线上名：命名空间与现有工具相同。参数字段也是 snake_case（scene_spec 的 hooks_planted），
  // 已知字段名单独排除；其余同前缀的下划线名都必须是真实工具。
  for (const match of text.matchAll(/(?<![\w./-])([a-z]+)_([a-z][a-z_]*[a-z])(?![\w-])/g)) {
    if (TOOL_NAMESPACES.has(match[1]!) && !TOOL_FIELD_NAMES.has(`${match[1]}_${match[2]}`)) wire.add(`${match[1]}_${match[2]}`);
  }
  return { dotted: [...dotted], wire: [...wire] };
}

function isNegativeProseCheck(check: WritingSkillComplianceCheck): boolean {
  if (check.type === "forbidden-terms") return true;
  if (check.type === "pattern") return check.minMatches === 0 && check.maxMatches !== undefined;
  return false;
}

function checkTerms(check: WritingSkillComplianceCheck): string[] {
  return check.type === "pattern" ? [check.pattern] : [...check.terms];
}

const builtins = loadBuiltinFiles();

describe("内置技能只含 NovelFork 自研 MIT 技能", () => {
  it(`数量在 ${MIN_BUILTIN_COUNT}–${MAX_BUILTIN_COUNT} 之间`, () => {
    expect(builtins.length).toBeGreaterThanOrEqual(MIN_BUILTIN_COUNT);
    expect(builtins.length).toBeLessThanOrEqual(MAX_BUILTIN_COUNT);
  });

  it.each(builtins.map((skill) => [skill.slug, skill] as const))("%s 带 NovelFork 自研 MIT 来源声明", (_slug, skill) => {
    expect(skill.source.origin).toBe("novelfork");
    expect(skill.source.license).toBe("MIT");
    // 不带 repo：界面据此显示「NovelFork 原生」，而不是某个上游仓库。
    expect(skill.source).not.toHaveProperty("repo");
    expect(skill.slug).toMatch(/^nf-[a-z]+(?:-[a-z]+)*$/);
    expect(retiredBuiltinSourceOf(skill.slug)).toBeNull();
  });

  it("打包快照与 builtin-skills/ 目录逐一一致，且不含任何第三方技能", () => {
    const bundled = new Map(BUNDLED_WRITING_SKILLS.map((entry) => [entry.slug, entry]));
    expect([...bundled.keys()].sort(), "快照过期：请运行 pnpm skills:bundle").toEqual(builtins.map((skill) => skill.slug));
    for (const skill of builtins) {
      const entry = bundled.get(skill.slug)!;
      expect(entry.content, `${skill.slug} 快照过期：请运行 pnpm skills:bundle`).toBe(skill.raw.replace(/\r\n/g, "\n"));
      expect(entry.provenance).toBeNull();
    }
    for (const entry of BUNDLED_WRITING_SKILLS) {
      expect(entry.slug).not.toContain("--");
    }
  });

  it("开发态目录只有内置技能，旧 skills/ 导入缓存不再被读取", () => {
    expect(BUILTIN_WRITING_SKILLS_DIR.split("\\").join("/")).toMatch(/\/packages\/novel-plugin\/builtin-skills$/);
    const catalog = loadWritingSkillsSync(join(tmpdir(), "novelfork-quality-no-author-home"));
    expect(catalog.map((skill) => skill.slug).sort()).toEqual(builtins.map((skill) => skill.slug));
    expect(catalog.every((skill) => skill.source === "builtin" && !skill.provenance)).toBe(true);
    for (const source of THIRD_PARTY_SKILL_SOURCES) {
      expect(catalog.some((skill) => skill.slug.startsWith(`nf-${source.slugPrefix}--`))).toBe(false);
    }
  });
});

describe("内置技能 frontmatter", () => {
  it.each(builtins.map((skill) => [skill.slug, skill] as const))("%s 字段完整且取值合法", (_slug, skill) => {
    const fm = skill.frontmatter;
    expect(fm.id).toBe(skill.slug);
    expect(typeof fm.name === "string" && fm.name.trim()).toBeTruthy();
    expect(typeof fm.description === "string" && fm.description.trim()).toBeTruthy();
    expect((fm.description as string).length).toBeLessThanOrEqual(MAX_DESCRIPTION_CHARS);
    // kind 与 mode 必须显式声明，不靠解析器兜底。
    expect(WRITING_SKILL_KINDS).toContain(fm.kind);
    expect(["manual", "auto", "always"]).toContain(fm.mode);
    expect(typeof fm.version).toBe("string");
    if (fm.entry !== undefined) expect(WRITING_SKILL_ENTRIES).toContain(fm.entry);
    expect(skill.parsed.body.length, `${skill.slug} 正文超出 ${MAX_BODY_CHARS} 字符预算，长材料请移到 references/`)
      .toBeLessThanOrEqual(MAX_BODY_CHARS);
  });

  it("技能名称唯一（Runtime 按 name 查找技能）", () => {
    const names = builtins.map((skill) => skill.parsed.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("创作预设的作者入口", () => {
  it("入口集合固定，每个入口恰好由约定的技能承担", () => {
    const actual = Object.fromEntries(
      builtins.filter((skill) => skill.parsed.entry).map((skill) => [skill.parsed.entry!, skill.slug]),
    );
    expect(actual).toEqual(EXPECTED_ENTRY_SLUGS);
    expect(builtins.filter((skill) => skill.parsed.entry)).toHaveLength(WRITING_SKILL_ENTRIES.length);
  });
});

describe("技能里引用的工具必须是模型可见的线上名", () => {
  it("引用抽取能认出反引号、裸写与下划线的工具名，并忽略文件名", () => {
    expect(referencedToolNames("先 `chapter.read`，再 rewrite.apply；导出 `story/volume_outline.md`，读 `SKILL.md`").dotted)
      .toEqual(["chapter.read", "rewrite.apply"]);
    expect(referencedToolNames("先 `chapter_read`，再 hooks_manage(action=list)；读 `story/volume_outline.md`").wire)
      .toEqual(["chapter_read", "hooks_manage"]);
  });

  it.each(builtins.map((skill) => [skill.slug, skill] as const))("%s", (_slug, skill) => {
    const references = referencedToolNames(`${skill.parsed.description}\n${skill.parsed.body}`);
    expect(references.dotted, `${skill.slug} 写了点号工具名，模型看到的是下划线名`).toEqual([]);
    const missing = references.wire.filter((name) => !WIRE_TOOL_NAMES.has(name));
    expect(missing, `${skill.slug} 引用了不存在的工具`).toEqual([]);
  });
});

describe("方法论 / 机器检查 / 书级设定各归其位", () => {
  it.each(builtins.map((skill) => [skill.slug, skill] as const))("%s 的正文检查只做「不许出现」判定", (_slug, skill) => {
    for (const check of skill.parsed.checks ?? []) {
      if (check.target === "card") continue;
      // 要求正文必须出现某些词，会逼模型把创作术语或标签写进故事。
      expect(isNegativeProseCheck(check), `${skill.slug} 声明了正文必现检查：${JSON.stringify(check)}`).toBe(true);
    }
  });

  it.each(builtins.map((skill) => [skill.slug, skill] as const))("%s 不在检查里写死人设词", (_slug, skill) => {
    for (const check of skill.parsed.checks ?? []) {
      if (check.type === "forbidden-terms") continue;
      const hits = checkTerms(check).filter((term) => PERSONA_TERMS.some((persona) => term.includes(persona)));
      expect(hits, `${skill.slug} 的检查写死了人设词`).toEqual([]);
    }
  });
});
