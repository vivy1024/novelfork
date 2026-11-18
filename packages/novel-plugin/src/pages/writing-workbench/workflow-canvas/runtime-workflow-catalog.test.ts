import { describe, expect, it } from "vitest";

import { NOVEL_RUNTIME_TOOL_CATALOG } from "../../../handlers/tool-registry.js";
import {
  AUTHORITATIVE_WRITABLE_NOVEL_TOOLS,
  mergeRuntimeSkillsResponses,
  parseRuntimeGlobalSubagentsResponse,
  parseRuntimeModelsResponse,
} from "./runtime-workflow-catalog";

describe("runtime-workflow-catalog", () => {
  it("parseRuntimeModelsResponse 兼容数组、{ models } 与 { providers }，并过滤 enabled === false", () => {
    const fromArray = parseRuntimeModelsResponse([
      { providerId: "p1", providerName: "Provider One", modelId: "m1", modelName: "Model 1", enabled: true },
      { providerId: "p1", modelId: "m-disabled", enabled: false },
      { id: "standalone-model", name: "Standalone" },
    ]);
    expect(fromArray).toEqual([
      { value: "p1:m1", label: "Provider One · Model 1", providerName: "Provider One" },
      { value: "standalone-model", label: "Standalone" },
    ]);

    const fromProviders = parseRuntimeModelsResponse({
      providers: [
        {
          id: "4sapi-2",
          name: "4SAPI",
          enabled: true,
          models: [
            { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash" },
            { id: "off-model", enabled: false },
          ],
        },
        {
          id: "disabled-provider",
          enabled: false,
          models: [{ id: "should-skip" }],
        },
      ],
    });
    expect(fromProviders).toEqual([
      { value: "4sapi-2:deepseek-v4.1-flash", label: "4SAPI · DeepSeek V4.1 Flash", providerName: "4SAPI" },
    ]);
  });

  it("parseRuntimeGlobalSubagentsResponse 兼容数组与对象包装并去重", () => {
    const parsed = parseRuntimeGlobalSubagentsResponse({
      subagents: [
        { name: "global-editor", description: "全局精修", prompt: "精修正文", model: "p1:m1" },
        { name: "global-editor", description: "重复项" },
        { name: "off-agent", description: "停用", enabled: false },
      ],
    });
    expect(parsed).toEqual([
      { name: "global-editor", description: "全局精修", prompt: "精修正文", model: "p1:m1" },
    ]);
  });

  it("mergeRuntimeSkillsResponses 严格以 skill.name 合并去重，不混入 slug", () => {
    const merged = mergeRuntimeSkillsResponses(
      { skills: [{ id: "nf-golden-opening", slug: "nf-golden-opening", name: "黄金三章", description: "", kind: "opening" }] },
      [{ name: "黄金三章", description: "前三章留存策略" }, { name: "项目专属技能", description: "本书规则", kind: "project" }],
    );
    expect(merged).toEqual([
      { name: "黄金三章", description: "前三章留存策略", kind: "opening" },
      { name: "项目专属技能", description: "本书规则", kind: "project" },
    ]);
  });

  it("AUTHORITATIVE_WRITABLE_NOVEL_TOOLS 只包含 risk !== read 且 runtimeStatus === ready 的小说工具", () => {
    expect(AUTHORITATIVE_WRITABLE_NOVEL_TOOLS.length).toBeGreaterThan(0);
    const catalogMap = new Map(NOVEL_RUNTIME_TOOL_CATALOG.map((item) => [item.name, item]));
    for (const item of AUTHORITATIVE_WRITABLE_NOVEL_TOOLS) {
      const origin = catalogMap.get(item.name);
      expect(origin).toBeDefined();
      expect(origin?.risk).not.toBe("read");
      expect(origin?.runtimeStatus).toBe("ready");
      expect(item.descriptionZh.trim()).not.toBe("");
    }
    const names = AUTHORITATIVE_WRITABLE_NOVEL_TOOLS.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "pipeline.write",
        "chapter.write",
        "lore.write",
        "hooks.manage",
        "outline.volume",
        "memory.settle_chapter",
      ]),
    );
    expect(names).not.toContain("chapter.read");
    expect(names).not.toContain("lore.read");
  });
});
