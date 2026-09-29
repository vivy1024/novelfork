// @vitest-environment node

import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { BUNDLED_WRITING_SKILLS } from "../writing-skills/bundled-skills.generated.js";
import { loadWritingSkillsSync, parseWritingSkill } from "../writing-skills/loader.js";
import { syncProjectWritingSkills } from "../writing-skills/project-storage.js";
import type { ParsedWritingSkill } from "../writing-skills/types.js";
import { NOVEL_BUILTIN_WORKFLOWS, type NovelWorkflowRecipe } from "./novel-workflows.js";
import { buildWorkflowRunBrief } from "./run-brief.js";
import { createRunState, transition } from "./run-state-machine.js";

function skillNames(recipe: NovelWorkflowRecipe): string[] {
  return recipe.nodes.flatMap((node) => node.type === "step" ? [...node.skills ?? []] : []);
}

let home: string;
let catalog: readonly ParsedWritingSkill[];
const bundledCatalog = BUNDLED_WRITING_SKILLS.flatMap((entry) => {
  const skill = parseWritingSkill(entry.content, entry.slug, "builtin");
  return skill ? [skill] : [];
});

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "novelfork-workflow-skills-"));
  // 显式 home，避免作者自己的技能覆盖内置缺陷或被测试读取。
  catalog = loadWritingSkillsSync(home);
});

afterAll(async () => {
  if (home) await rm(home, { recursive: true, force: true });
});

describe("内置工作流的技能引用", () => {
  it.each(NOVEL_BUILTIN_WORKFLOWS)("$id 的全部工序在开发目录和打包快照中均可按名称解析", (recipe) => {
    for (const [source, skills] of [["开发目录", catalog], ["打包快照", bundledCatalog]] as const) {
      for (const name of skillNames(recipe)) {
        const matches = skills.filter((skill) => skill.name === name);
        expect(matches, `${source}：${recipe.id} 引用了无法唯一解析的技能「${name}」`).toHaveLength(1);
        expect(matches[0]!.source).toBe("builtin");
        expect(matches[0]!.slug).toMatch(/^nf-[a-z]+(?:-[a-z]+)*$/);
        expect(matches[0]!.body.trim()).not.toBe("");
      }
    }
  });

  it.each([
    { id: "fanqie-xuanhuan-serial", expectedIds: ["nf-payoff-density", "nf-chapter-hook"] },
    { id: "zhihu-short-story", expectedIds: ["nf-conflict-suspense-split"] },
  ])("$id 的蓝图技能保留原有创作意图，且进入实际工序简报", ({ id, expectedIds }) => {
    const recipe = NOVEL_BUILTIN_WORKFLOWS.find((item) => item.id === id)!;
    const blueprint = recipe.nodes.find((node) => node.type === "step" && node.id === "step-blueprint");
    expect(blueprint?.type).toBe("step");
    if (blueprint?.type !== "step") throw new Error("内置配方缺少蓝图工序");
    const names = blueprint.skills ?? [];
    expect(names.map((name) => catalog.find((skill) => skill.name === name)?.id)).toEqual(expectedIds);

    const created = createRunState(recipe);
    if (!created.ok) throw new Error(created.explanation.what);
    const advanced = transition(recipe, created.state, { type: "submit", stepId: "step-context" });
    if (!advanced.ok) throw new Error(advanced.explanation.what);
    expect(advanced.state.currentStepId).toBe("step-blueprint");
    const brief = buildWorkflowRunBrief({
      id: "test-run", bookId: "test-book", chapterNumber: 1, narratorId: "test-narrator",
      recipeId: recipe.id, recipe, state: advanced.state, createdAt: 0, updatedAt: 0,
    });
    expect(brief).toContain(`需要遵循的写作技能：${names.join("、")}（用 Skill 工具读取）。`);
  });
});

// 公开 checkout 不带私有 Runtime；本地物化树存在时额外使用真实的项目 Skill registry。
const runtimeRoot = new URL("../../../../narrafork-runtime-private/server/", import.meta.url);
const runtimePath = (relativePath: string) => fileURLToPath(new URL(relativePath, runtimeRoot));
const runtimeServicePath = runtimePath("services/skill-service.ts");

describe.skipIf(!existsSync(runtimeServicePath))("内置配方与 Runtime 项目技能注册表", () => {
  let bookRoot: string;
  let loadByName: (root: string, name: string) => Promise<{ name: string; content: string } | null>;

  beforeAll(async () => {
    bookRoot = join(home, "book");
    const requiredNames = new Set(NOVEL_BUILTIN_WORKFLOWS.flatMap(skillNames));
    const selected = catalog.filter((skill) => requiredNames.has(skill.name));
    const synced = await syncProjectWritingSkills(bookRoot, selected, {
      addSkillIds: selected.map((skill) => skill.id),
    }, { home });
    expect(synced.invalidIds).toEqual([]);

    // 只替换未使用的基础设施：真实文件扫描、frontmatter 解析和名称查找不做 mock。
    // 一旦项目扫描误走数据库路径就直接失败，绝不打开用户 Runtime 数据库。
    vi.doMock(runtimePath("db/index.ts"), () => ({
      db: new Proxy({}, { get() { throw new Error("技能引用测试禁止访问 Runtime 数据库"); } }),
    }));
    vi.doMock(runtimePath("db/schema.ts"), () => ({}));
    vi.doMock(runtimePath("lib/logger.ts"), () => ({ logger: { warn: vi.fn() } }));
    vi.doMock(runtimePath("lib/errors.ts"), () => ({
      AppError: Error, NotFoundError: Error, ValidationError: Error,
    }));
    const runtime = await import(/* @vite-ignore */ runtimeServicePath);
    loadByName = runtime.loadProjectSkillByName;
  });

  afterAll(() => {
    for (const path of ["db/index.ts", "db/schema.ts", "lib/logger.ts", "lib/errors.ts"]) {
      vi.doUnmock(runtimePath(path));
    }
  });

  it.each(NOVEL_BUILTIN_WORKFLOWS)("$id 的技能经过产品物化后可由真实 Runtime 按名称读取", async (recipe) => {
    for (const name of skillNames(recipe)) {
      const skill = await loadByName(bookRoot, name);
      expect(skill, `${recipe.id} 的技能「${name}」未在 Runtime 注册`).not.toBeNull();
      expect(skill?.name).toBe(name);
      expect(skill?.content).toBe(catalog.find((item) => item.name === name)?.body);
    }
  });

  it.each([
    "chapter-end-hook", "xuanhuan-suppression-release", "emotional-tension-twist",
    "nf-chapter-hook", "nf-payoff-density", "nf-conflict-suspense-split",
  ])("历史悬空 ID 或 catalog ID %s 不能冒充 Runtime 技能名称", async (id) => {
    expect(await loadByName(bookRoot, id)).toBeNull();
  });
});
