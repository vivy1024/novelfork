import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseWritingSkill } from "./loader.js";
import { projectWritingSkillFile } from "./project-storage.js";
import {
  BOOK_STYLE_MEMORY_SKILL_SLUG,
  exportBookStyleSkill,
  StyleSkillExportError,
} from "./style-skill-export.js";
import { adoptStyleMemories } from "../writing-layers/style-memory.js";
import { createStylePreset } from "../writing-layers/style-preset.js";
import { loadStylePreset, saveStylePreset } from "../writing-layers/style-preset-store.js";

const roots: string[] = [];
let bookRoot = "";

beforeEach(async () => {
  bookRoot = await mkdtemp(join(tmpdir(), "novelfork-style-skill-export-"));
  roots.push(bookRoot);
});
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("exportBookStyleSkill", () => {
  it("没有预设或没有可迁移确认规则时拒绝，不写任何文件", async () => {
    await expect(exportBookStyleSkill(bookRoot)).rejects.toMatchObject({ code: "STYLE_SKILL_EXPORT_EMPTY" });
    expect(projectWritingSkillFile(bookRoot, BOOK_STYLE_MEMORY_SKILL_SLUG)).toContain(BOOK_STYLE_MEMORY_SKILL_SLUG);
    await expect(readFile(projectWritingSkillFile(bookRoot, BOOK_STYLE_MEMORY_SKILL_SLUG)!, "utf8")).rejects.toThrow();

    const preset = createStylePreset();
    preset.sources.push({
      id: "src-1",
      title: "参考作品甲",
      rules: [
        { text: "待审规则", evidence: "e", transfer: "transferable", status: "needs-review" },
        { text: "专属规则", evidence: "e", transfer: "source-only", status: "confirmed" },
      ],
      samples: [],
    });
    await saveStylePreset(bookRoot, preset, null);
    await expect(exportBookStyleSkill(bookRoot)).rejects.toBeInstanceOf(StyleSkillExportError);
    await expect(readFile(projectWritingSkillFile(bookRoot, BOOK_STYLE_MEMORY_SKILL_SLUG)!, "utf8")).rejects.toThrow();
  });

  it("汇总全部来源的已确认且可迁移规则生成 SKILL.md，可通过技能解析器", async () => {
    const preset = createStylePreset();
    preset.sources.push(
      {
        id: "src-1",
        title: "参考作品甲",
        rules: [
          { text: "句末多留白，不用解释性收束。", evidence: "e", transfer: "transferable", status: "confirmed" },
          { text: "待审规则不进技能", evidence: "e", transfer: "transferable", status: "needs-review" },
        ],
        samples: [],
      },
      {
        id: "src-2",
        title: "手动写法记忆",
        rules: [{ text: "对话密度高，以对话推进场景。", evidence: "e", transfer: "transferable", status: "confirmed" }],
        samples: [],
      },
    );
    await saveStylePreset(bookRoot, preset, null);

    const result = await exportBookStyleSkill(bookRoot);
    expect(result.slug).toBe(BOOK_STYLE_MEMORY_SKILL_SLUG);
    expect(result.ruleCount).toBe(2);
    expect(result.sourceTitles).toEqual(["参考作品甲", "手动写法记忆"]);
    expect(result.file.endsWith(join(".novelfork", "skills", "book-style-memory", "SKILL.md"))).toBe(true);
    expect(result.content).toContain("句末多留白，不用解释性收束。（来源：参考作品甲）");
    expect(result.content).toContain("对话密度高，以对话推进场景。（来源：手动写法记忆）");
    expect(result.content).not.toContain("待审规则不进技能");

    const raw = await readFile(result.file, "utf8");
    expect(raw).toBe(result.content);
    const parsed = parseWritingSkill(raw, BOOK_STYLE_MEMORY_SKILL_SLUG, "project");
    expect(parsed).not.toBeNull();
    expect(parsed!.kind).toBe("prose");
    expect(parsed!.mode).toBe("manual");
    expect(parsed!.entry).toBeUndefined();
  });

  it("重复生成覆盖同一技能文件，新版规则立即生效", async () => {
    await adoptStyleMemories(bookRoot, { rules: [{ text: "第一批规则。" }] }, null);
    const first = await exportBookStyleSkill(bookRoot);
    expect(first.content).toContain("第一批规则。");

    const current = await loadStylePreset(bookRoot);
    await adoptStyleMemories(bookRoot, { rules: [{ text: "第二批规则。" }] }, current.revision);
    const again = await exportBookStyleSkill(bookRoot);
    expect(again.ruleCount).toBe(2);
    const raw = await readFile(again.file, "utf8");
    expect(raw).toContain("第二批规则。");
    expect(raw).toContain("第一批规则。");
  });

  it("损坏的预设直接报错，不生成技能也不改文件", async () => {
    await mkdir(join(bookRoot, "story"), { recursive: true });
    const file = join(bookRoot, "story", "style_preset.json");
    await writeFile(file, "invalid", "utf8");
    await expect(exportBookStyleSkill(bookRoot)).rejects.toThrow("文风预设损坏");
    await expect(readFile(file, "utf8")).resolves.toBe("invalid");
  });
});
