/**
 * 工具 renderer 契约测试。
 *
 * 防的是这种错配：工具在 novel-plugin 的 tool-registry 里声明了 renderer="x"，
 * 但 Studio 侧从来没注册过 x，结果线上静默退回 Generic JSON 卡，用户看到一堆裸 JSON。
 *
 * 规则（对应 CLAUDE.md 的交付定义）：
 * 工具声明的 renderer 必须已在 Studio 注册，或在 GENERIC_BY_DESIGN 里显式表态走 generic。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { RESERVED_TOOL_RESULT_RENDERERS, resolveToolResultRendererKey } from "./registry";

const TOOL_REGISTRY_PATH = resolve(
  __dirname,
  "../../../../novel-plugin/src/handlers/tool-registry.ts",
);

/**
 * 显式表态：这些工具的结果暂时用 generic 卡渲染。
 * 想收窄体验就为它写专属卡并从这里删掉；不要反过来往这里加以让测试变绿。
 */
const GENERIC_BY_DESIGN = new Set<string>([
  "chapter.audit",
  "chapter.content",
  "chapter.discard_range",
  "chapter.list",
  "character.arcs",
  "character.consistency",
  "hooks.manage",
  "jingwei.audit",
  "jingwei.read",
  "jingwei.write",
  "narrative.line",
  "narrative.mutationPreview",
  "narrative-memory.admin",
  "narrative-memory.events",
  "narrative-memory.graph",
  "narrative-memory.read",
  "outline.suggestions",
  "pgi.ask",
  "pipeline.import_chapters",
  "pipeline.revise",
  "resource.manage",
  "scene.spec",
  "style.import",
  "tool.rewrite-apply",
  "tool.rewrite-segment",
  // Writing Skills 迁移后的四个工具暫走 generic；H-3 提供专属卡后从这里删除。
  "writing-skills.compliance",
  "writing-skills.import",
  "writing-skills.list",
  // writing-skills.recommend 直接把 renderer 声明成 "generic"：推荐结果是扁平的
  // name/kind/reason 列表，generic 卡足够；作者真正的交互发生在随后的
  // AskUserQuestion（由 Runtime 原生渲染）。
  "generic",
]);

/** 从 tool-registry 源码里抽出所有声明的 renderer 值。 */
function declaredRenderers(): string[] {
  const source = readFileSync(TOOL_REGISTRY_PATH, "utf8");
  const matches = source.matchAll(/renderer:\s*"([^"]+)"/gu);
  return [...new Set([...matches].map((match) => match[1]!))].sort();
}

/** renderer 是否已在 Studio 侧解析到专属卡。 */
function isRegistered(renderer: string): boolean {
  return resolveToolResultRendererKey({ toolName: "contract.probe", result: { renderer } }) !== "generic";
}

describe("tool renderer 契约", () => {
  const renderers = declaredRenderers();

  it("能从 tool-registry 读到 renderer 声明", () => {
    expect(renderers.length).toBeGreaterThan(20);
    expect(renderers).toContain("write.preflight");
  });

  it("每个声明的 renderer 要么已注册，要么显式走 generic", () => {
    const unaccounted = renderers.filter(
      (renderer) => !isRegistered(renderer) && !GENERIC_BY_DESIGN.has(renderer),
    );
    expect(
      unaccounted,
      `这些 renderer 在 tool-registry 声明了但 Studio 没注册，会静默退回裸 JSON 卡：${unaccounted.join(", ")}。请补专属卡，或在 GENERIC_BY_DESIGN 里显式表态。`,
    ).toEqual([]);
  });

  it("S3 的四个专属 renderer 确实注册了", () => {
    for (const renderer of ["write.preflight", "book.dissect", "outline.volume", "compliance.publish-readiness"]) {
      expect(isRegistered(renderer), `${renderer} 未注册`).toBe(true);
    }
  });

  it("GENERIC_BY_DESIGN 不能残留已经注册的 renderer", () => {
    const stale = [...GENERIC_BY_DESIGN].filter((renderer) => isRegistered(renderer));
    expect(stale, `这些已经有专属卡了，请从 GENERIC_BY_DESIGN 删除：${stale.join(", ")}`).toEqual([]);
  });

  it("GENERIC_BY_DESIGN 不能残留已删除的工具", () => {
    const declared = new Set(renderers);
    const orphans = [...GENERIC_BY_DESIGN].filter((renderer) => !declared.has(renderer));
    expect(orphans, `这些 renderer 已不在 tool-registry 中：${orphans.join(", ")}`).toEqual([]);
  });

  it("保留 renderer key 与默认实现一一对应", () => {
    for (const key of RESERVED_TOOL_RESULT_RENDERERS) {
      expect(resolveToolResultRendererKey({ toolName: "contract.probe", result: { renderer: key } })).toBe(key);
    }
  });
});
