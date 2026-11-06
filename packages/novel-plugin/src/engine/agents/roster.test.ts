import { describe, expect, it } from "vitest";

import { NOVEL_RUNTIME_CONTRIBUTION } from "../../runtime-contribution";
import { NOVEL_RUNTIME_TOOL_CATALOG } from "../../handlers/tool-registry";
import { buildStepTemplates } from "../workflows/run-state-machine";
import { NOVEL_BUILTIN_WORKFLOWS } from "../workflows/novel-workflows";
import {
  GENERAL_PROPOSAL_TOOLS,
  listNovelSubagentTemplateContributions,
  NOVEL_SUBAGENT_ROSTER,
  ROSTER_FORBIDDEN_TOOLS,
  ROSTER_RUNTIME_TOOLS,
  rosterTemplatesForStep,
} from "./roster";

const WIRE_NAME = /^[A-Za-z0-9_-]{1,64}$/;

describe("内置子代理名册", () => {
  it("13 个模板齐全（写、改、审、读者、市场、文风、大纲、通用），id 带产品命名空间且不重复", () => {
    expect(NOVEL_SUBAGENT_ROSTER.map((t) => t.id).sort()).toEqual([
      "nf-assistant",
      "nf-continuity-auditor",
      "nf-deai-auditor",
      "nf-general",
      "nf-market-analyst",
      "nf-outline-planner",
      "nf-pacing-auditor",
      "nf-reader-critic",
      "nf-reviser",
      "nf-scene-architect",
      "nf-settler",
      "nf-style-keeper",
      "nf-writer",
    ]);
    for (const template of NOVEL_SUBAGENT_ROSTER) {
      expect(template.id).toMatch(/^nf-[a-z0-9-]+$/);
      expect(template.nameZh.trim()).not.toBe("");
      expect(template.description.trim()).not.toBe("");
      expect(template.prompt.length, template.id).toBeLessThan(2000);
    }
  });

  it("没有任何写权威源的工具，也没有 Runtime 的写文件 / 终端 / 再委派", () => {
    for (const template of NOVEL_SUBAGENT_ROSTER) {
      for (const tool of template.tools) {
        expect(ROSTER_FORBIDDEN_TOOLS, `${template.id} → ${tool}`).not.toContain(tool);
      }
    }
  });

  it("小说工具都是已贡献给 Runtime 的工具；除提交 / 报阻塞与通用帮手的候选工具外只用读类", () => {
    const contributed = new Map((NOVEL_RUNTIME_CONTRIBUTION.tools ?? []).map((tool) => [tool.definition.name, tool.definition.risk]));
    const catalog = new Map(NOVEL_RUNTIME_TOOL_CATALOG.map((tool) => [tool.name, tool.risk]));
    for (const template of NOVEL_SUBAGENT_ROSTER) {
      for (const tool of template.tools) {
        if (ROSTER_RUNTIME_TOOLS.includes(tool)) continue;
        expect(contributed.has(tool), `${template.id} → ${tool} 未贡献`).toBe(true);
        if (tool === "workflow.submit_step_output") continue;
        if (template.id === "nf-general" && GENERAL_PROPOSAL_TOOLS.includes(tool)) {
          // 只产候选卡、作者确认才生效的草稿级工具。
          expect(catalog.get(tool), `${template.id} → ${tool}`).toBe("draft-write");
          continue;
        }
        expect(catalog.get(tool), `${template.id} → ${tool}`).toBe("read");
      }
    }
  });

  it("贡献形状：工具名转成线上名（点号换下划线），Runtime 工具保持原名", () => {
    const contributions = listNovelSubagentTemplateContributions();
    const writer = contributions.find((t) => t.id === "nf-writer")!;
    expect(writer.tools).toContain("chapter_read");
    expect(writer.tools).toContain("workflow_submit_step_output");
    expect(writer.tools).toContain("Skill");
    for (const template of contributions) {
      for (const tool of template.tools) expect(tool, template.id).toMatch(WIRE_NAME);
    }
  });

  it("写手 / 返修 / 审校 / 镜头设计能提交；结算核对与资料助手不能提交", () => {
    const canSubmit = (id: string) => NOVEL_SUBAGENT_ROSTER.find((t) => t.id === id)!.tools.includes("workflow.submit_step_output");
    for (const id of [
      "nf-scene-architect", "nf-writer", "nf-reviser", "nf-continuity-auditor", "nf-pacing-auditor", "nf-deai-auditor",
      "nf-reader-critic", "nf-style-keeper", "nf-market-analyst", "nf-outline-planner", "nf-general",
    ]) {
      expect(canSubmit(id), id).toBe(true);
    }
    expect(canSubmit("nf-settler")).toBe(false);
    expect(canSubmit("nf-assistant")).toBe(false);
  });

  it("新模板按职责最小授权：读者 / 文风 / 大纲只读加提交，市场带榜单工具，没有删除与批量维护", () => {
    const tools = (id: string) => NOVEL_SUBAGENT_ROSTER.find((t) => t.id === id)!.tools;
    expect(tools("nf-market-analyst")).toEqual(expect.arrayContaining(["market.ranks", "market.query"]));
    expect(tools("nf-market-analyst")).not.toContain("market.scan");
    expect(tools("nf-style-keeper")).toContain("character.voice.read");
    expect(tools("nf-outline-planner")).not.toContain("outline.volume");
    for (const id of ["nf-reader-critic", "nf-style-keeper", "nf-outline-planner", "nf-market-analyst"]) {
      for (const tool of tools(id)) expect(GENERAL_PROPOSAL_TOOLS, `${id} → ${tool}`).not.toContain(tool);
    }
    const general = tools("nf-general");
    expect(general).toEqual(expect.arrayContaining([...GENERAL_PROPOSAL_TOOLS]));
    for (const banned of ["resource.manage", "chapter.discard_range", "memory.bulk_delete", "memory.bulk_approve", "memory.delete", "market.scan"]) {
      expect(general).not.toContain(banned);
    }
  });

  it("提示词点名的工具都在模板自己的上限里（线上名）", () => {
    const wire = /([a-z]+(?:_[a-z]+)+)/g;
    const contributions = listNovelSubagentTemplateContributions();
    for (const template of contributions) {
      const named = [...template.prompt.matchAll(wire)].map((match) => match[1]!).filter((name) => name.includes("_") && /^(chapter|lore|memory|cockpit|market|character|skills|scene|style|storyline|workflow|jingwei|publish|outline)_/.test(name));
      for (const name of named) expect(template.tools, `${template.id} 提示词点名 ${name}`).toContain(name);
    }
  });

  it("提示词写明输出契约：只回摘要与候选 id，不贴正文", () => {
    for (const template of NOVEL_SUBAGENT_ROSTER) {
      expect(template.prompt, template.id).toMatch(/不贴|绝不把正文/);
    }
  });
});

describe("工序 → 模板", () => {
  it("内置方案里旧角色 id 映射到名册模板；被打回的写正文工序也接受返修", () => {
    const [fanqie, zhihu] = NOVEL_BUILTIN_WORKFLOWS;
    const steps = new Map(buildStepTemplates(fanqie!).map((step) => [step.stepId, step]));
    expect(rosterTemplatesForStep(steps.get("step-draft")!)).toEqual(["nf-writer"]);
    expect(rosterTemplatesForStep({ ...steps.get("step-draft")!, note: { what: "x", why: "y", action: "z" } })).toEqual(["nf-writer", "nf-reviser"]);
    expect(rosterTemplatesForStep(steps.get("step-adversarial-audit")!)).toEqual(["nf-continuity-auditor"]);
    expect(rosterTemplatesForStep(steps.get("step-blueprint")!)).toEqual(["nf-scene-architect"]);
    const zhihuAudit = buildStepTemplates(zhihu!).find((step) => step.stepId === "step-audit")!;
    expect(rosterTemplatesForStep(zhihuAudit)).toEqual(["nf-deai-auditor"]);
    // 上下文与落盘工序不分给子代理
    expect(rosterTemplatesForStep(steps.get("step-context")!)).toEqual([]);
    expect(rosterTemplatesForStep(steps.get("step-settlement")!)).toEqual([]);
  });

  it("大纲推演工序默认交给大纲推演子代理；精修一章的三路审校各归其主", () => {
    expect(rosterTemplatesForStep({ kind: "outline-plan", expectedOutput: "outline" })).toEqual(["nf-outline-planner"]);
    const refine = NOVEL_BUILTIN_WORKFLOWS.find((recipe) => recipe.id === "refine-chapter")!;
    const steps = new Map(buildStepTemplates(refine).map((step) => [step.stepId, step]));
    expect(rosterTemplatesForStep(steps.get("step-reader")!)).toEqual(["nf-reader-critic"]);
    expect(rosterTemplatesForStep(steps.get("step-style")!)).toEqual(["nf-style-keeper"]);
    expect(rosterTemplatesForStep(steps.get("step-deai")!)).toEqual(["nf-deai-auditor"]);
    expect(rosterTemplatesForStep(steps.get("step-revise")!)).toEqual(["nf-reviser"]);
    const forecast = NOVEL_BUILTIN_WORKFLOWS.find((recipe) => recipe.id === "outline-forecast")!;
    const forecastSteps = new Map(buildStepTemplates(forecast).map((step) => [step.stepId, step]));
    expect(rosterTemplatesForStep(forecastSteps.get("step-market")!)).toEqual(["nf-market-analyst"]);
    expect(rosterTemplatesForStep(forecastSteps.get("step-outline")!)).toEqual(["nf-outline-planner"]);
  });
});
