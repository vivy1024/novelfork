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
    expect(getWritingSkillRawContentSync("nf-golden-opening")).toContain("# 黄金三章");

  });

  it("第三方技能不再内置；作者自行安装后带着 _source.json 的来源与许可出现", async () => {
    const home = await mkdtemp(join(tmpdir(), "novelfork-writing-skills-third-party-"));
    try {
      expect(loadWritingSkillsSync(home).some((skill) => skill.slug.includes("--"))).toBe(false);

      const dir = join(authorWritingSkillsDir(home), "nf-worldwonderer--story-review");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "SKILL.md"), validSkill("作者安装的审阅技能"), "utf8");
      await writeFile(join(dir, "_source.json"), JSON.stringify({
        repo: "https://github.com/worldwonderer/oh-story-claudecode",
        license: "MIT",
      }), "utf8");

      const installed = loadWritingSkillsSync(home).find((skill) => skill.slug === "nf-worldwonderer--story-review");
      expect(installed).toMatchObject({
        source: "user",
        provenance: { repo: "https://github.com/worldwonderer/oh-story-claudecode", license: "MIT" },
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("只认产品定义的作者入口，未知入口名被忽略", () => {
    const withEntry = (entry: string) => `---
name: 入口测试
description: 测试用
kind: workflow
entry: ${entry}
---

正文。
`;
    expect(parseWritingSkill(withEntry("写下一章"), "entry-ok", "user")?.entry).toBe("写下一章");
    expect(parseWritingSkill(withEntry("随便写写"), "entry-unknown", "user")).not.toHaveProperty("entry");
  });

  it("作者目录默认跟随 NOVELFORK_HOME，显式 home 仍按 <home>/.novelfork/skills 解析", () => {
    const original = process.env.NOVELFORK_HOME;
    const relocated = join(tmpdir(), "relocated-novelfork-home");
    const explicitHome = join(tmpdir(), "explicit-home");
    try {
      process.env.NOVELFORK_HOME = relocated;
      expect(authorWritingSkillsDir()).toBe(join(relocated, "skills"));
      expect(authorWritingSkillsDir(explicitHome)).toBe(join(explicitHome, ".novelfork", "skills"));
    } finally {
      if (original === undefined) delete process.env.NOVELFORK_HOME;
      else process.env.NOVELFORK_HOME = original;
    }
  });
});
