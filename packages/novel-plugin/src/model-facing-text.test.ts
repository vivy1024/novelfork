// @vitest-environment node

/**
 * 面向模型的文本门禁：系统提示与工具说明每轮都进模型上下文。
 *
 * - 不带内部任务编号、通配工具名、表名/列名、审计规则编号这类只有开发者看得懂的东西；
 *   通配写法（memory.*）也不是真工具名，出口翻译换不成线上名。
 * - 总字数有预算：新增说明前先删掉同义重复，确需扩容时连同理由一起调高预算。
 */

import { describe, expect, it } from "vitest";

import { BUNDLED_WRITING_SKILLS } from "./engine/writing-skills/bundled-skills.generated.js";
import { NOVEL_RUNTIME_TOOL_CATALOG } from "./handlers/tool-registry.js";
import { NOVEL_RUNTIME_SYSTEM_PROMPT } from "./runtime-contribution.js";
import { NOVEL_TOOL_SCHEMAS } from "./tool-schemas.js";

/** 2026-11 精简后实测：系统提示 3204、工具说明合计 10483，各留 5% 余量。 */
const MAX_SYSTEM_PROMPT_CHARS = 3364;
const MAX_TOOL_DESCRIPTION_CHARS = 11007;
const MAX_SINGLE_TOOL_DESCRIPTION_CHARS = 900;
const MAX_WRITE_PREFLIGHT_DESCRIPTION_CHARS = 600;

/** 内部表名、列名与开发用标记：模型看不懂，作者也不该在转述里看到。 */
const INTERNAL_TERMS: readonly RegExp[] = [
  /\bjingwei_[a-z_]+/u,
  /\bnarrative_[a-z_]+/u,
  /\bfields_json\b/u,
  /\bparticipates_in_ai\b/u,
  /\bdissection_staging\b/u,
  /\bkv_store\b/u,
  /\bPUT entries\b/u,
  /legacy compatibility/iu,
  /（v\d+）/u,
  /\bTask \d+\b/u,
  // 确定性审计的规则编号（H2/H7/S1…）
  /(?<![A-Za-z0-9_])[HS]\d{1,2}(?![A-Za-z0-9_])/u,
];

const TASK_ID = /(?<![A-Za-z0-9_])T-?\d+(\.\d+)?(?![A-Za-z0-9_])/u;
const WILDCARD_TOOL = /\w+\.\*/u;

function collectParameterDescriptions(schema: unknown, path: string, out: Array<[string, string]>): void {
  if (!schema || typeof schema !== "object") return;
  if (Array.isArray(schema)) {
    schema.forEach((item, index) => collectParameterDescriptions(item, `${path}[${index}]`, out));
    return;
  }
  const node = schema as Record<string, unknown>;
  if (typeof node.description === "string") out.push([path, node.description]);
  for (const [key, child] of Object.entries(node)) {
    if (child && typeof child === "object") collectParameterDescriptions(child, `${path}.${key}`, out);
  }
}

const readyTools = NOVEL_RUNTIME_TOOL_CATALOG.filter((tool) => tool.runtimeStatus === "ready");

function modelFacingTexts(): Array<[string, string]> {
  const texts: Array<[string, string]> = [["system-prompt", NOVEL_RUNTIME_SYSTEM_PROMPT]];
  for (const tool of readyTools) {
    texts.push([tool.name, tool.description]);
    collectParameterDescriptions(NOVEL_TOOL_SCHEMAS[tool.name as keyof typeof NOVEL_TOOL_SCHEMAS], tool.name, texts);
  }
  return texts;
}

describe("面向模型的文本门禁", () => {
  it("不出现内部任务编号", () => {
    const hits = modelFacingTexts().filter(([, text]) => TASK_ID.test(text)).map(([where, text]) => `${where}: ${text.match(TASK_ID)?.[0]}`);
    expect(hits).toEqual([]);
  });

  it("不用通配写法点名工具", () => {
    const hits = modelFacingTexts().filter(([, text]) => WILDCARD_TOOL.test(text)).map(([where, text]) => `${where}: ${text.match(WILDCARD_TOOL)?.[0]}`);
    expect(hits).toEqual([]);
  });

  it("不暴露表名、列名与审计规则编号", () => {
    const hits = modelFacingTexts().flatMap(([where, text]) => (
      INTERNAL_TERMS.filter((pattern) => pattern.test(text)).map((pattern) => `${where}: ${text.match(pattern)?.[0]}`)
    ));
    expect(hits).toEqual([]);
  });

  it("系统提示与工具说明不超过字数预算", () => {
    expect(NOVEL_RUNTIME_SYSTEM_PROMPT.length).toBeLessThanOrEqual(MAX_SYSTEM_PROMPT_CHARS);
    const total = readyTools.reduce((sum, tool) => sum + tool.description.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_TOOL_DESCRIPTION_CHARS);
    const oversized = readyTools.filter((tool) => tool.description.length > MAX_SINGLE_TOOL_DESCRIPTION_CHARS).map((tool) => tool.name);
    expect(oversized).toEqual([]);
    const preflight = readyTools.find((tool) => tool.name === "write.preflight");
    expect(preflight?.description.length ?? 0).toBeLessThanOrEqual(MAX_WRITE_PREFLIGHT_DESCRIPTION_CHARS);
  });

  it("技能口径一致：按描述判断读哪些技能，硬约束在保存时校验，不写成不可跳过的门禁", () => {
    expect(NOVEL_RUNTIME_SYSTEM_PROMPT).not.toContain("不可跳过");
    expect(NOVEL_RUNTIME_SYSTEM_PROMPT).toContain("writingSkillConstraints");
    expect(NOVEL_RUNTIME_SYSTEM_PROMPT).toContain("severity=error");
  });

  it("同一段规则只在一处讲：高风险放行流程只在系统提示，章后结算只讲一次", () => {
    const releaseFlow = "AskUserQuestion";
    expect(NOVEL_RUNTIME_SYSTEM_PROMPT.split(releaseFlow).length - 1).toBe(1);
    expect(readyTools.filter((tool) => tool.description.includes(releaseFlow)).map((tool) => tool.name)).toEqual([]);
    expect(NOVEL_RUNTIME_SYSTEM_PROMPT.split("自动发起").length - 1).toBe(1);
  });

  it("结算失败由叙述者重试 memory.settle_chapter，不让作者自己调工具", () => {
    expect(NOVEL_RUNTIME_SYSTEM_PROMPT).toContain("重试 memory.settle_chapter");
    expect(readyTools.find((tool) => tool.name === "pipeline.write")?.description).toContain("重试 memory.settle_chapter");
    // 内置技能同口径：不让作者去调工具，结算失败不改用范围回填。
    const authorCallsTool = /(提醒|建议|让)作者[^。\n]{0,8}`[a-z]+_[a-z_]+`/u;
    const offenders = BUNDLED_WRITING_SKILLS.filter((skill) => authorCallsTool.test(skill.content)).map((skill) => skill.slug);
    expect(offenders).toEqual([]);
    const writeChapter = BUNDLED_WRITING_SKILLS.find((skill) => skill.slug === "nf-write-chapter")?.content ?? "";
    expect(writeChapter).toMatch(/settlementError[^\n]*memory_settle_chapter/u);
  });
});
