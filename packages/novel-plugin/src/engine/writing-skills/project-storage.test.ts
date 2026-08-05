import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { loadWritingSkills } from "./loader.js";
import {
  legacyProjectWritingSkillsDir,
  projectWritingSkillFile,
  projectWritingSkillsDir,
  readProjectWritingSkillSelection,
  syncProjectWritingSkills,
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
});
