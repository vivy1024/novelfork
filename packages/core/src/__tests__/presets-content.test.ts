import { describe, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseGenreProfile } from "../models/genre-profile.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const presetsDir = join(root, "presets");

const expectedToneSections = [
  "叙事声音与语气",
  "对话风格",
  "场景描写特征",
  "转折与衔接手法",
  "节奏特征",
  "词汇偏好",
  "情绪表达方式",
  "禁止漂移方向",
  "参考来源与可学习技法",
  "推荐 settingBase",
];

const expectedSettingBaseSections = [
  "现实/历史参照",
  "社会阶层",
  "权力结构",
  "经济系统",
  "技术/魔法边界",
  "交通与信息传播",
  "日常生活材料",
  "可借用元素",
  "不可照搬元素",
  "常见违和点",
];

describe("preset content files", () => {
  it("parses all genre profile files", async () => {
    const genreDir = join(presetsDir, "genres");
    const files = (await readdir(genreDir)).filter((file) => file.endsWith(".md"));

    expect(files.sort()).toEqual([
      "history.md",
      "mystery.md",
      "romance.md",
      "scifi.md",
      "urban.md",
      "xianxia.md",
    ]);

    for (const file of files) {
      const raw = await readFile(join(genreDir, file), "utf8");
      const parsed = parseGenreProfile(raw);

      expect(parsed.profile.id).toBeTruthy();
      expect(parsed.profile.chapterTypes.length).toBeGreaterThanOrEqual(5);
      expect(parsed.profile.fatigueWords.length).toBeGreaterThanOrEqual(5);
      expect(parsed.profile.pacingRule.length).toBeGreaterThan(0);
      expect(parsed.profile.satisfactionTypes.length).toBeGreaterThanOrEqual(4);
      expect(parsed.body).toContain("## 流派核心");
      expect(parsed.body).toContain("## 常见结构");
      expect(parsed.body).toContain("## 写作禁忌");
    }
  });

  it("requires numerical system flags for xianxia and scifi", async () => {
    const xianxia = parseGenreProfile(await readFile(join(presetsDir, "genres", "xianxia.md"), "utf8"));
    const scifi = parseGenreProfile(await readFile(join(presetsDir, "genres", "scifi.md"), "utf8"));

    expect(xianxia.profile.numericalSystem).toBe(true);
    expect(xianxia.profile.powerScaling).toBe(true);
    expect(scifi.profile.numericalSystem).toBe(true);
    expect(scifi.profile.powerScaling).toBe(true);
  });

  it("requires era research for history", async () => {
    const history = parseGenreProfile(await readFile(join(presetsDir, "genres", "history.md"), "utf8"));

    expect(history.profile.eraResearch).toBe(true);
  });

  it("validates tone templates contain style-only dimensions", async () => {
    const toneDir = join(presetsDir, "tones");
    const files = (await readdir(toneDir)).filter((file) => file.endsWith(".md"));

    expect(files.sort()).toEqual([
      "austere-pragmatic.md",
      "classical-imagery.md",
      "comedic-light.md",
      "dark-humor-social.md",
      "tragic-solitude.md",
    ]);

    for (const file of files) {
      const raw = await readFile(join(toneDir, file), "utf8");
      for (const section of expectedToneSections) {
        expect(raw).toContain(`## ${section}`);
      }
      expect(raw).not.toContain("## 现实/历史参照");
      expect(raw).not.toContain("## 社会阶层");
      expect(raw).not.toContain("## 权力结构");
      expect(raw).not.toContain("## 技术/魔法边界");
    }
  });

  it("validates setting base templates contain 10 fixed sections", async () => {
    const settingDir = join(presetsDir, "setting-bases");
    const files = (await readdir(settingDir)).filter((file) => file.endsWith(".md"));

    expect(files.sort()).toEqual([
      "classical-travelogue-jianghu.md",
      "historical-court-livelihood.md",
      "modern-platform-economy-satire.md",
      "near-future-industrial-scifi.md",
      "sect-family-xianxia.md",
      "victorian-industrial-occult.md",
    ]);

    for (const file of files) {
      const raw = await readFile(join(settingDir, file), "utf8");
      for (const section of expectedSettingBaseSections) {
        expect(raw).toContain(`## ${section}`);
      }
      expect(raw).toContain("参考而非复刻");
    }
  });
});
