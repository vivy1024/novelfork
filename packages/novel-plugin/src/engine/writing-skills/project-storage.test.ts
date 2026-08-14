import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { loadWritingSkills } from "./loader.js";
import {
  extractGeneralSkillReferences,
  legacyProjectWritingSkillsDir,
  projectWritingSkillFile,
  projectWritingSkillsDir,
  readProjectWritingSkillSelection,
  removeProjectWritingSkill,
  syncProjectWritingSkills,
  writeProjectWritingSkillRaw,
} from "./project-storage.js";

const skillContent = (id: string, name = "测试技能"): string => `---
id: ${id}
name: ${name}
description: 用于项目物化回归测试
kind: workflow
mode: manual
---

# ${name}

项目级正文。
`;

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe("project writing skill storage", () => {
  it("启用时递归复制 SKILL.md 与附件，取消时删除项目副本", async () => {
    const root = await mkdtemp(join(tmpdir(), "novelfork-project-skills-"));
    const home = join(root, "home");
    const bookRoot = join(root, "book");
    const sourceDir = join(home, ".novelfork", "skills", "project-recursive");
    try {
      await mkdir(join(sourceDir, "references", "templates"), { recursive: true });
      await writeFile(join(sourceDir, "SKILL.md"), skillContent("project-recursive"), "utf8");
      await writeFile(join(sourceDir, "references", "templates", "chapter.md"), "模板附件\n", "utf8");

      const skill = (await loadWritingSkills(home)).find((candidate) => candidate.slug === "project-recursive");
      expect(skill).toMatchObject({ id: "project-recursive", source: "user" });
      if (!skill) throw new Error("test skill was not loaded");

      const enabled = await syncProjectWritingSkills(bookRoot, [skill], { addSkillIds: [skill.id] }, { home });
      expect(enabled.createdSlugs).toEqual(["project-recursive"]);
      expect(await readFile(join(bookRoot, ".novelfork", "skills", "project-recursive", "references", "templates", "chapter.md"), "utf8"))
        .toBe("模板附件\n");

      const disabled = await syncProjectWritingSkills(bookRoot, [skill], { removeSkillIds: [skill.id] }, { home });
      expect(disabled.removedSlugs).toEqual(["project-recursive"]);
      expect(await exists(projectWritingSkillFile(bookRoot, skill.slug)!)).toBe(false);
      // 取消项目启用不能删除作者级覆盖；重新启用仍可恢复作者版本。
      expect(await exists(join(sourceDir, "SKILL.md"))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("项目独有技能可原地更新与删除且保留附件", async () => {
    const root = await mkdtemp(join(tmpdir(), "novelfork-project-only-skill-"));
    const bookRoot = join(root, "book");
    const slug = "project-only";
    const skillDir = join(projectWritingSkillsDir(bookRoot), slug);
    try {
      await mkdir(join(skillDir, "references"), { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), skillContent(slug, "项目独有技能"), "utf8");
      await writeFile(join(skillDir, "references", "note.md"), "附件\n", "utf8");

      const updatedContent = skillContent(slug, "项目独有技能（已更新）").replace("项目级正文。", "只影响当前作品。");
      const updated = await writeProjectWritingSkillRaw(bookRoot, slug, updatedContent);
      expect(updated).toMatchObject({ slug, source: "project", name: "项目独有技能（已更新）" });
      expect(await readFile(join(skillDir, "SKILL.md"), "utf8")).toBe(updatedContent);
      expect(await readFile(join(skillDir, "references", "note.md"), "utf8")).toBe("附件\n");

      expect(await removeProjectWritingSkill(bookRoot, slug)).toBe(true);
      expect(await exists(skillDir)).toBe(false);
      expect(await removeProjectWritingSkill(bookRoot, slug)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("物化题材包装层技能时自动带全「通用-X」依赖技能", async () => {
    const root = await mkdtemp(join(tmpdir(), "novelfork-project-skills-dep-"));
    const home = join(root, "home");
    const bookRoot = join(root, "book");
    try {
      await mkdir(join(home, ".novelfork", "skills", "topic-layer"), { recursive: true });
      await writeFile(
        join(home, ".novelfork", "skills", "topic-layer", "SKILL.md"),
        `---
id: topic-layer
name: AI科幻-去AI味重写
description: 题材包装层，路由到通用层
kind: revision
mode: manual
---

# AI科幻-去AI味重写

对应通用 Skill：\`通用-去AI味重写\`。必须优先强制加载。
`,
        "utf8",
      );
      await mkdir(join(home, ".novelfork", "skills", "general-layer"), { recursive: true });
      await writeFile(
        join(home, ".novelfork", "skills", "general-layer", "SKILL.md"),
        `---
id: general-layer
name: 通用-去AI味重写
description: 通用去AI味方法论
kind: revision
mode: manual
---

# 通用-去AI味重写

四维病灶诊断。
`,
        "utf8",
      );
      await writeFile(join(home, ".novelfork", "skills", "general-layer", "checklist.md"), "执行清单\n", "utf8");

      const skills = await loadWritingSkills(home);
      const topic = skills.find((skill) => skill.slug === "topic-layer");
      const general = skills.find((skill) => skill.slug === "general-layer");
      expect(topic).toBeDefined();
      expect(general).toBeDefined();
      if (!topic || !general) throw new Error("test skills not loaded");

      const enabled = await syncProjectWritingSkills(bookRoot, [topic, general], { addSkillIds: [topic.id] }, { home });
      expect(enabled.createdSlugs).toEqual(["topic-layer"]);
      // 依赖的通用技能也被自动物化（连同附件）。
      expect(await exists(join(projectWritingSkillsDir(bookRoot), "general-layer", "SKILL.md"))).toBe(true);
      expect(await readFile(join(projectWritingSkillsDir(bookRoot), "general-layer", "checklist.md"), "utf8")).toBe("执行清单\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("把旧误写的 .narrafork/skills 迁移到 canonical .novelfork/skills 并清理旧目录", async () => {
    const root = await mkdtemp(join(tmpdir(), "novelfork-project-skills-legacy-"));
    const bookRoot = join(root, "book");
    const skill = {
      id: "legacy-project-skill",
      slug: "legacy-project-skill",
      name: "旧路径技能",
      description: "旧路径迁移测试",
      kind: "workflow" as const,
      body: "正文。",
      source: "builtin" as const,
      mode: "manual" as const,
    };
    try {
      const legacyDir = join(legacyProjectWritingSkillsDir(bookRoot), skill.slug);
      await mkdir(legacyDir, { recursive: true });
      await writeFile(join(legacyDir, "SKILL.md"), skillContent(skill.id, skill.name), "utf8");

      const before = await readProjectWritingSkillSelection(bookRoot, [skill]);
      expect(before.legacyWritingSkillSlugs).toEqual([skill.slug]);
      const result = await syncProjectWritingSkills(bookRoot, [skill], { addSkillIds: [skill.id] });
      expect(result.migratedSlugs).toEqual([skill.slug]);
      expect(await exists(projectWritingSkillFile(bookRoot, skill.slug)!)).toBe(true);
      expect(await exists(join(legacyDir, "SKILL.md"))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("extractGeneralSkillReferences 提取正文中的「通用-X」引用", () => {
    const names = extractGeneralSkillReferences(
      "对应通用 Skill：`通用-去AI味重写`、`通用-创建小说正文`。必须优先强制加载 `通用-去AI味重写`。",
    );
    expect(names).toEqual(["通用-去AI味重写", "通用-创建小说正文"]);
    expect(extractGeneralSkillReferences("没有引用")).toEqual([]);
  });
});
