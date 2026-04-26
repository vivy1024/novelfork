import { describe, expect, it } from "vitest";
import type { BookConfig } from "../models/book.js";
import type { GenreProfile } from "../models/genre-profile.js";
import { LengthSpecSchema } from "../models/length-governance.js";
import { buildWriterSystemPrompt, buildPresetInjections } from "../agents/writer-prompts.js";
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

describe("buildWriterSystemPrompt", () => {
  it("demotes always-on methodology blocks in governed mode", () => {
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
    );

    expect(prompt).toContain("## 输入治理契约");
    expect(prompt).toContain("卷纲是默认规划");
    expect(prompt).not.toContain("## 六步走人物心理分析");
    expect(prompt).not.toContain("## 读者心理学框架");
    expect(prompt).not.toContain("## 黄金三章规则");
  });

  it("uses target-range wording when a length spec is provided", () => {
    const lengthSpec = LengthSpecSchema.parse({
      target: 2200,
      softMin: 1900,
      softMax: 2500,
      hardMin: 1600,
      hardMax: 2800,
      countingMode: "zh_chars",
      normalizeMode: "none",
    });

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
      lengthSpec,
    );

    expect(prompt).toContain("目标字数：2200");
    expect(prompt).toContain("允许区间：1900-2500");
    expect(prompt).not.toContain("正文不少于2200字");
  });

  it("keeps hard guardrails and book/style constraints in governed mode", () => {
    const prompt = buildWriterSystemPrompt(
      BOOK,
      GENRE,
      null,
      "# Book Rules\n\n- Do not reveal the mastermind.",
      "# Genre Body",
      "# Style Guide\n\nKeep the prose restrained.",
      undefined,
      3,
      "creative",
      undefined,
      "zh",
      "governed",
    );

    expect(prompt).toContain("## 核心规则");
    expect(prompt).toContain("## 硬性禁令");
    expect(prompt).toContain("Do not reveal the mastermind");
    expect(prompt).toContain("Keep the prose restrained");
  });

  it("tells governed English prompts to obey variance briefs and include resistance-bearing exchanges", () => {
    const prompt = buildWriterSystemPrompt(
      {
        ...BOOK,
        language: "en",
      },
      {
        ...GENRE,
        language: "en",
        name: "General",
      },
      null,
      "# Book Rules",
      "# Genre Body",
      "# Style Guide\n\nKeep the prose restrained.",
      undefined,
      3,
      "creative",
      undefined,
      "en",
      "governed",
    );

    expect(prompt).toContain("English Variance Brief");
    expect(prompt).toContain("resistance-bearing exchange");
  });
});

describe("buildPresetInjections", () => {
  it("returns empty string for no presets", () => {
    expect(buildPresetInjections([])).toBe("");
  });

  it("injects presets in fixed category order: genre → tone → setting-base → logic-risk → anti-ai → literary", () => {
    const presets: Preset[] = [
      { id: "lit-1", name: "文学A", category: "literary", description: "", promptInjection: "literary-inject" },
      { id: "tone-1", name: "文风A", category: "tone", description: "", promptInjection: "tone-inject" },
      { id: "anti-1", name: "去AI味A", category: "anti-ai", description: "", promptInjection: "anti-ai-inject" },
      { id: "setting-1", name: "基底A", category: "setting-base", description: "", promptInjection: "setting-inject" },
      { id: "logic-1", name: "逻辑A", category: "logic-risk", description: "", promptInjection: "logic-inject" },
      { id: "genre-1", name: "流派A", category: "genre", description: "", promptInjection: "genre-inject" },
    ];

    const result = buildPresetInjections(presets);

    const genreIdx = result.indexOf("## 流派规则");
    const toneIdx = result.indexOf("## 文风规则");
    const settingIdx = result.indexOf("## 时代/社会基底");
    const logicIdx = result.indexOf("## 逻辑风险约束");
    const antiIdx = result.indexOf("## AI味过滤");
    const litIdx = result.indexOf("## 文学技法");

    expect(genreIdx).toBeGreaterThanOrEqual(0);
    expect(toneIdx).toBeGreaterThan(genreIdx);
    expect(settingIdx).toBeGreaterThan(toneIdx);
    expect(logicIdx).toBeGreaterThan(settingIdx);
    expect(antiIdx).toBeGreaterThan(logicIdx);
    expect(litIdx).toBeGreaterThan(antiIdx);
  });

  it("skips categories with empty promptInjection", () => {
    const presets: Preset[] = [
      { id: "tone-1", name: "文风A", category: "tone", description: "", promptInjection: "tone-inject" },
      { id: "empty-1", name: "空注入", category: "anti-ai", description: "", promptInjection: "   " },
    ];

    const result = buildPresetInjections(presets);
    expect(result).toContain("## 文风规则");
    expect(result).not.toContain("## AI味过滤");
  });
});
