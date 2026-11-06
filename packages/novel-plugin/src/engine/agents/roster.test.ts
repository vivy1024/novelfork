import { describe, expect, it } from "vitest";

import { NOVEL_RUNTIME_CONTRIBUTION } from "../../runtime-contribution";
import { NOVEL_RUNTIME_TOOL_CATALOG } from "../../handlers/tool-registry";
import { buildStepTemplates } from "../workflows/run-state-machine";
import { NOVEL_BUILTIN_WORKFLOWS } from "../workflows/novel-workflows";
import {
  listNovelSubagentTemplateContributions,
  NOVEL_SUBAGENT_ROSTER,
  ROSTER_FORBIDDEN_TOOLS,
  ROSTER_RUNTIME_TOOLS,
  rosterTemplatesForStep,
} from "./roster";

const WIRE_NAME = /^[A-Za-z0-9_-]{1,64}$/;

describe("内置子代理名册", () => {
  it("P1 的 8 个模板齐全，id 带产品命名空间且不重复", () => {
    expect(NOVEL_SUBAGENT_ROSTER.map((t) => t.id).sort()).toEqual([
      "nf-assistant",
      "nf-continuity-auditor",
      "nf-deai-auditor",
      "nf-pacing-auditor",
      "nf-reviser",
      "nf-scene-architect",
      "nf-settler",
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

  it("小说工具都是已贡献给 Runtime 的工具；除提交 / 报阻塞外只用读类", () => {
    const contributed = new Map((NOVEL_RUNTIME_CONTRIBUTION.tools ?? []).map((tool) => [tool.definition.name, tool.definition.risk]));
    const catalog = new Map(NOVEL_RUNTIME_TOOL_CATALOG.map((tool) => [tool.name, tool.risk]));
    for (const template of NOVEL_SUBAGENT_ROSTER) {
      for (const tool of template.tools) {
        if (ROSTER_RUNTIME_TOOLS.includes(tool)) continue;
        expect(contributed.has(tool), `${template.id} → ${tool} 未贡献`).toBe(true);
        if (tool === "workflow.submit_step_output") continue;
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
    for (const id of ["nf-scene-architect", "nf-writer", "nf-reviser", "nf-continuity-auditor", "nf-pacing-auditor", "nf-deai-auditor"]) {
      expect(canSubmit(id), id).toBe(true);
    }
    expect(canSubmit("nf-settler")).toBe(false);
    expect(canSubmit("nf-assistant")).toBe(false);
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
});
