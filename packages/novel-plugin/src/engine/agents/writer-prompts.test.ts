import { describe, expect, it } from "vitest";

import type { BookConfig, GenreProfile } from "@vivy1024/novelfork-core";
import { buildLengthSpec } from "@vivy1024/novelfork-core";
import { buildWriterSystemPrompt } from "./writer-prompts.js";
import type { ParsedWritingSkill } from "../writing-skills/types.js";

const BOOK: BookConfig = {
  id: "prompt-book",
  title: "Prompt Book",
  platform: "tomato",
  genre: "other",
  status: "active",
  targetChapters: 20,
  chapterWordCount: 3000,
  createdAt: "2026-03-22T00:00:00.000Z",
  updatedAt: "2026-03-22T00:00:00.000Z",
};

const GENRE: GenreProfile = {
  id: "other",
  name: "综合",
  language: "zh",
  chapterTypes: ["setup", "conflict"],
  fatigueWords: [],
  numericalSystem: false,
  powerScaling: false,
  eraResearch: false,
  pacingRule: "",
  satisfactionTypes: [],
  auditDimensions: [],
};

/**
 * Writing Skills 只能经由 style 通道进入上下文包，不得直进 Writer system prompt。
 * 这条边界由本测试锁定：`buildWriterSystemPrompt` 不接受任何 skill 入参。
 */
const STYLE_ONLY_SKILL: ParsedWritingSkill = {
  id: "style-only",
  slug: "style-only",
  name: "只允许风格通道技法",
  description: "测试 Writing Skills 不能直进 Writer 系统提示。",
  kind: "prose",
  body: "SENTINEL_WRITING_SKILL_DIRECT_INJECTION_SHOULD_NOT_APPEAR",
  source: "builtin",
  mode: "manual",
};

describe("writer prompt writing-skill/style channel boundary", () => {
  it("does not inject writing skills directly into the Writer system prompt", () => {
    const prompt = buildWriterSystemPrompt(
      BOOK,
      GENRE,
      null,
      "# Book Rules",
      "# Genre Body",
      "# Style Guide\n\nKeep the prose restrained.",
      undefined,
      3,
      "creative",
      undefined,
      "zh",
      "governed",
      buildLengthSpec(2200, "zh"),
    );

    expect(prompt).toContain("## 输入治理契约");
    expect(prompt).toContain("Keep the prose restrained");
    expect(prompt).not.toContain(STYLE_ONLY_SKILL.name);
    expect(prompt).not.toContain(STYLE_ONLY_SKILL.body);
    expect(prompt).not.toContain("## 文风规则");
  });
});
