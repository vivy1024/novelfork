import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildProjectWritingSkillsPrompt,
  loadProjectWritingSkillInjection,
  mergeLoadedSkillEvidence,
} from "./prompt-injection";
import type { ParsedWritingSkill } from "./types";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function skill(slug: string, body: string): ParsedWritingSkill {
  return {
    id: `writing-skill-${slug}`,
    slug,
    name: slug,
    description: slug,
    kind: "prose",
    body,
    source: "project",
    mode: "manual",
  };
}

describe("Writing Skills system prompt injection", () => {
  it("按稳定顺序把所有启用项目正文放进 system 扩展", () => {
    const prompt = buildProjectWritingSkillsPrompt([
      skill("zeta", "ZETA_STYLE_MARKER"),
      skill("empty", "   "),
      skill("alpha", "ALPHA_STYLE_MARKER"),
    ]);

    expect(prompt).toContain("NovelFork 当前作品已启用的 Writing Skills");
    expect(prompt).toContain("ALPHA_STYLE_MARKER");
    expect(prompt).toContain("ZETA_STYLE_MARKER");
    expect(prompt).not.toContain("### Writing Skill 2: empty");
    expect(prompt!.indexOf("ALPHA_STYLE_MARKER")).toBeLessThan(prompt!.indexOf("ZETA_STYLE_MARKER"));
  });

  it("从当前作品目录读取正文，并同时生成可信 loadedSkills 证据", async () => {
    const root = await mkdtemp(join(tmpdir(), "novelfork-prompt-injection-"));
    roots.push(root);
    const dir = join(root, ".novelfork", "skills", "direct-style");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "SKILL.md"), `---
id: writing-skill-direct-style
name: 直接注入文风
description: 验证首轮注入
kind: prose
mode: manual
---

使用克制、具体的动作描写。
`, "utf8");

    const result = await loadProjectWritingSkillInjection(root, "2026-08-14T00:00:00.000Z");

    expect(result.prompt).toContain("使用克制、具体的动作描写");
    expect(result.loadedSkills).toHaveLength(1);
    expect(result.loadedSkills[0]).toMatchObject({
      name: "直接注入文风",
      loadedAt: "2026-08-14T00:00:00.000Z",
    });
    expect(result.loadedSkills[0]?.contentHash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("系统预注入证据覆盖同名的旧 Skill 调用证据", () => {
    expect(mergeLoadedSkillEvidence(
      [{ name: "文风", loadedAt: "old", contentHash: "old" }],
      [{ name: "文风", loadedAt: "current", contentHash: "current" }],
    )).toEqual([{ name: "文风", loadedAt: "current", contentHash: "current" }]);
  });
});
