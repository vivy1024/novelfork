import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  handleWritingSkillsCheckCompliance,
  handleWritingSkillsRead,
  handleWritingSkillsWrite,
} from "./writing-skill-handlers.js";

const skillContent = (id: string, name = "迁移技能"): string => `---
id: ${id}
name: ${name}
description: Handler 迁移回归测试
kind: workflow
mode: manual
---

# ${name}

迁移正文。
`;

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function setupBook(root: string, bookId: string, book: Record<string, unknown>): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "book.json"), JSON.stringify({ id: bookId, ...book }, null, 2), "utf8");
}

describe("writing skill handlers use project disk state", () => {
  it("自动发现 `.novelfork/skills`，增删操作不写 book.json 选择字段", async () => {
    const root = await mkdtemp(join(tmpdir(), "novelfork-writing-skill-handler-"));
    const home = join(root, "home");
    const bookRoot = join(root, "book");
    const bookId = "book-project-files";
    try {
      const authorDir = join(home, ".novelfork", "skills", "handler-skill");
      await mkdir(authorDir, { recursive: true });
      await writeFile(join(authorDir, "SKILL.md"), skillContent("handler-skill", "项目文件技能"), "utf8");
      await setupBook(bookRoot, bookId, { title: "文件发现测试" });

      const initial = await handleWritingSkillsRead({ bookId, scope: "enabled" }, { bookRoot, home });
      expect(initial.ok).toBe(true);
      expect(initial.data).toMatchObject({ projectSkillSlugs: [], projectSkillsDirectory: ".novelfork/skills" });

      const added = await handleWritingSkillsWrite(
        { bookId, addSkillIds: ["handler-skill"] },
        { bookRoot, home },
      );
      expect(added.ok).toBe(true);
      expect(added.data).toMatchObject({ projectSkillSlugs: ["handler-skill"], createdSlugs: ["handler-skill"] });
      expect(await exists(join(bookRoot, ".novelfork", "skills", "handler-skill", "SKILL.md"))).toBe(true);

      const enabled = await handleWritingSkillsRead({ bookId, scope: "enabled" }, { bookRoot, home });
      expect(enabled.data).toMatchObject({ projectSkillSlugs: ["handler-skill"] });
      expect((enabled.data as { skills: Array<{ slug: string; source: string }> }).skills).toEqual(
        expect.arrayContaining([expect.objectContaining({ slug: "handler-skill", source: "project" })]),
      );

      const removed = await handleWritingSkillsWrite(
        { bookId, removeSkillIds: ["handler-skill"] },
        { bookRoot, home },
      );
      expect(removed.data).toMatchObject({ projectSkillSlugs: [], removedSlugs: ["handler-skill"] });
      expect(await exists(join(bookRoot, ".novelfork", "skills", "handler-skill"))).toBe(false);
      const savedBook = JSON.parse(await readFile(join(bookRoot, "book.json"), "utf8")) as Record<string, unknown>;
      expect(savedBook).not.toHaveProperty("enabledWritingSkillIds");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("项目目录文件优先，book.json 中的旧字段既不启用也不被清洗", async () => {
    const root = await mkdtemp(join(tmpdir(), "novelfork-writing-skill-authority-"));
    const home = join(root, "home");
    const bookRoot = join(root, "book");
    const bookId = "book-disk-authority";
    try {
      await setupBook(bookRoot, bookId, {
        enabledWritingSkillIds: ["stale-skill"],
        enabledPresetIds: ["stale-preset"],
      });
      const diskDir = join(bookRoot, ".novelfork", "skills", "disk-skill");
      await mkdir(diskDir, { recursive: true });
      await writeFile(join(diskDir, "SKILL.md"), skillContent("disk-skill", "项目真实技能"), "utf8");

      const result = await handleWritingSkillsRead({ bookId, scope: "enabled" }, { bookRoot, home });
      expect(result.ok).toBe(true);
      expect(result.data).toMatchObject({ projectSkillSlugs: ["disk-skill"] });
      expect((result.data as { skills: Array<{ slug: string }> }).skills).toEqual(
        [expect.objectContaining({ slug: "disk-skill" })],
      );
      const saved = JSON.parse(await readFile(join(bookRoot, "book.json"), "utf8")) as Record<string, unknown>;
      expect(saved).toHaveProperty("enabledWritingSkillIds", ["stale-skill"]);
      expect(saved).toHaveProperty("enabledPresetIds", ["stale-preset"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("check_compliance 对题材层技能校验「本体+通用依赖」加载完整性", async () => {
    const root = await mkdtemp(join(tmpdir(), "novelfork-compliance-deps-"));
    const home = join(root, "home");
    const bookRoot = join(root, "book");
    const bookId = "book-compliance-deps";
    try {
      // 题材包装层：引用通用技能，无 checks 声明。
      await mkdir(join(home, ".novelfork", "skills", "topic-deps"), { recursive: true });
      await writeFile(
        join(home, ".novelfork", "skills", "topic-deps", "SKILL.md"),
        `---
id: topic-deps
name: AI科幻-去AI味重写
description: 题材包装层
kind: revision
mode: manual
---

对应通用 Skill：\`通用-去AI味重写\`。必须优先强制加载。
`,
        "utf8",
      );
      await mkdir(join(home, ".novelfork", "skills", "general-deps"), { recursive: true });
      await writeFile(
        join(home, ".novelfork", "skills", "general-deps", "SKILL.md"),
        `---
id: general-deps
name: 通用-去AI味重写
description: 通用方法论
kind: revision
mode: manual
---

四维病灶诊断。
`,
        "utf8",
      );
      await setupBook(bookRoot, bookId, { title: "依赖校验" });
      await handleWritingSkillsWrite(
        { bookId, addSkillIds: ["topic-deps"] },
        { bookRoot, home },
      );

      // 只加载了本体、没加载通用依赖 → 上报 warning 违规。
      const partial = await handleWritingSkillsCheckCompliance(
        {
          bookId,
          content: "正文。",
          loadedSkills: [{ name: "AI科幻-去AI味重写", loadedAt: "2026-08-10T00:00:00.000Z" }],
        },
        { bookRoot, home },
      );
      expect(partial.ok).toBe(true);
      const partialViolations = (partial.data as { violations: Array<{ checkId: string; violation: string }> }).violations;
      expect(partialViolations).toEqual(expect.arrayContaining([
        expect.objectContaining({
          checkId: "dependency-loaded",
          violation: expect.stringContaining("通用-去AI味重写") as unknown,
        }),
      ]));

      // 本体 + 通用依赖都加载 → 无依赖违规。
      const complete = await handleWritingSkillsCheckCompliance(
        {
          bookId,
          content: "正文。",
          loadedSkills: [
            { name: "AI科幻-去AI味重写", loadedAt: "2026-08-10T00:00:00.000Z" },
            { name: "通用-去AI味重写", loadedAt: "2026-08-10T00:00:01.000Z" },
          ],
        },
        { bookRoot, home },
      );
      expect(complete.ok).toBe(true);
      const completeViolations = (complete.data as { violations: Array<{ checkId: string }> }).violations;
      expect(completeViolations.some((violation) => violation.checkId === "dependency-loaded")).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
