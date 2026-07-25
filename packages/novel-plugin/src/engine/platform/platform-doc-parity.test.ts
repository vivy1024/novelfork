/**
 * 平台写作卡文档与实现的一致性。
 *
 * docs/learning/26-platform-writing-cards.md 把 profile 数值抄成了作者可读的表格。
 * 抄写就会漂移：改了 PROFILES 却忘记改文档，用户读到的就是错的口径。
 * 这里让文档里的每个数字都回到实现上核对。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  SUPPORTED_PUBLISH_PLATFORMS,
  getPlatformProfile,
  resolvePublishPlatform,
} from "./platform-profile.js";

const DOC_PATH = resolve(__dirname, "../../../../../docs/learning/26-platform-writing-cards.md");

function doc(): string {
  return readFileSync(DOC_PATH, "utf8");
}

describe("平台写作卡文档一致性", () => {
  const text = doc();

  it("每个受支持平台都在文档里有小节", () => {
    for (const platform of SUPPORTED_PUBLISH_PLATFORMS) {
      const profile = getPlatformProfile(platform);
      expect(text, `缺少 ${platform} 小节`).toContain(`（${platform}）`);
      expect(text, `缺少 ${platform} 的中文标签`).toContain(profile.label);
    }
  });

  it("章字数窗口与实现一致", () => {
    for (const platform of SUPPORTED_PUBLISH_PLATFORMS) {
      const { chapterWords } = getPlatformProfile(platform);
      const row = `| 章字数 | ${chapterWords.min} / **${chapterWords.ideal}** / ${chapterWords.max}`;
      expect(text, `${platform} 章字数行应为 ${row}`).toContain(row);
    }
  });

  it("钩子密度与实现一致", () => {
    for (const platform of SUPPORTED_PUBLISH_PLATFORMS) {
      const { hooksPerChapter } = getPlatformProfile(platform);
      const row = `| 每章钩子 | 至少 ${hooksPerChapter.min}，建议 ${hooksPerChapter.ideal} |`;
      expect(text, `${platform} 钩子行应为 ${row}`).toContain(row);
    }
  });

  it("AI 率容忍与实现一致", () => {
    for (const platform of SUPPORTED_PUBLISH_PLATFORMS) {
      const { aiRatioTolerance } = getPlatformProfile(platform);
      // 0 用「零容忍」表述，其余写成百分数
      const expected = aiRatioTolerance === 0
        ? "0（零容忍口径）"
        : `${Math.round(aiRatioTolerance * 100)}%`;
      expect(text, `${platform} 的 AI 率应表述为 ${expected}`).toContain(expected);
    }
  });

  it("每条 profile note 都出现在文档里", () => {
    for (const platform of SUPPORTED_PUBLISH_PLATFORMS) {
      for (const note of getPlatformProfile(platform).notes) {
        expect(text, `${platform} 缺少 note：${note}`).toContain(note);
      }
    }
  });

  it("平台别名表覆盖实现支持的写法", () => {
    // 文档承诺这些别名可用，逐个回到解析函数核对
    const aliases: Array<[string, string]> = [
      ["tomato", "fanqie"],
      ["fanqie", "fanqie"],
      ["番茄", "fanqie"],
      ["qidian", "qidian"],
      ["起点", "qidian"],
      ["jjwxc", "jjwxc"],
      ["晋江", "jjwxc"],
      ["qimao", "qimao"],
      ["七猫", "qimao"],
      ["feilu", "generic"],
      ["飞卢", "generic"],
      ["other", "generic"],
    ];
    for (const [input, expected] of aliases) {
      expect(resolvePublishPlatform({ platform: input }), `别名 ${input}`).toBe(expected);
      expect(text, `文档缺少别名 ${input}`).toContain(input);
    }
  });

  it("敏感词阻断口径与实现一致", () => {
    // generic 是唯一不阻断保存的平台，文档必须如实说明
    expect(getPlatformProfile("generic").blockOnSensitiveBlock).toBe(false);
    expect(text).toContain("| 敏感词阻断 | **否** |");
    for (const platform of SUPPORTED_PUBLISH_PLATFORMS.filter((p) => p !== "generic")) {
      expect(getPlatformProfile(platform).blockOnSensitiveBlock, platform).toBe(true);
    }
  });
});
