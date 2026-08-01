import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  authorWritingSkillsDir,
  getWritingSkillRawContentSync,
  loadWritingSkillsSync,
  parseWritingSkill,
} from "./loader.js";

const validSkill = (name: string, checks = ""): string => `---
name: ${name}
description: 测试用 Writing Skill
kind: workflow
${checks}---

# ${name}

正文。\n`;

describe("writing skill loader", () => {
  it("每次加载重新读取作者目录，并以同 slug 覆盖 builtin", async () => {
    const home = await mkdtemp(join(tmpdir(), "novelfork-writing-skills-"));
    const target = join(authorWritingSkillsDir(home), "golden-opening", "SKILL.md");
    try {
      await mkdir(join(authorWritingSkillsDir(home), "golden-opening"), { recursive: true });
      await writeFile(target, validSkill("作者版黄金三章"), { encoding: "utf8", flush: true });
      const first = loadWritingSkillsSync(home).find((skill) => skill.slug === "golden-opening");
      expect(first).toMatchObject({ name: "作者版黄金三章", source: "user" });

      await writeFile(target, validSkill("更新后的作者版"), { encoding: "utf8", flush: true });
      const second = loadWritingSkillsSync(home).find((skill) => skill.slug === "golden-opening");
      expect(second).toMatchObject({ name: "更新后的作者版", source: "user" });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("解析声明式 checks，跳过不安全 pattern", () => {
    const parsed = parseWritingSkill(validSkill("合规测试", `checks:
  - type: required-terms
    terms: [主角, 冲突]
    minOccurrences: 1
  - type: forbidden-terms
    terms:
      - 元话语
  - type: pattern
    pattern: "危险(.*)+"
  - type: pattern
    pattern: "章末钩子"
    flags: i
    maxMatches: 2
`), "compliance-test", "user");

    expect(parsed?.checks).toEqual([
      { type: "required-terms", terms: ["主角", "冲突"], minOccurrences: 1 },
      { type: "forbidden-terms", terms: ["元话语"] },
      { type: "pattern", pattern: "章末钩子", flags: "i", maxMatches: 2 },
    ]);
  });

  it("拒绝越界 slug，且内置 bundle 可作为单一 fallback", () => {
    expect(parseWritingSkill(validSkill("越界"), "../escape", "user")).toBeNull();
    expect(getWritingSkillRawContentSync("../golden-opening")).toBeNull();
    expect(getWritingSkillRawContentSync("golden-opening")).toContain("# 黄金三章");

    const skills = loadWritingSkillsSync();
    expect(skills.some((skill) => skill.slug === "worldwonderer--story-review" && skill.provenance?.repo)).toBe(true);
  });
});
