import { describe, expect, it } from "vitest";

import type { BookConfig, GenreProfile } from "@vivy1024/novelfork-core";
import { buildLengthSpec } from "@vivy1024/novelfork-core";
import { buildWriterSystemPrompt } from "./writer-prompts.js";
import type { Preset } from "../presets/types.js";

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

const STYLE_ONLY_PRESET: Preset = {
  id: "style-only",
  name: "只允许风格通道预设",
  category: "tone",
  description: "测试预设不能直进 Writer 系统提示。",
  promptInjection: "SENTINEL_PRESET_DIRECT_INJECTION_SHOULD_NOT_APPEAR",
};

describe("writer prompt preset/style channel boundary", () => {
  it("does not inject enabled presets directly into the Writer system prompt", () => {
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
      [STYLE_ONLY_PRESET],
    );

    expect(prompt).toContain("## 输入治理契约");
    expect(prompt).toContain("Keep the prose restrained");
    expect(prompt).not.toContain(STYLE_ONLY_PRESET.name);
    expect(prompt).not.toContain(STYLE_ONLY_PRESET.promptInjection);
    expect(prompt).not.toContain("## 文风规则");
  });
});
