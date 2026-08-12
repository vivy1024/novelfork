/** 平台写作卡文档与实现的一致性。 */
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
      const row = `| 章字数建议 | ${chapterWords.min} / **${chapterWords.ideal}** / ${chapterWords.max}`;
      expect(text, `${platform} 章字数行应为 ${row}`).toContain(row);
    }
  });

  it("钩子密度与实现一致", () => {
    for (const platform of SUPPORTED_PUBLISH_PLATFORMS) {
      const { hooksPerChapter } = getPlatformProfile(platform);
      const row = `| 每章钩子建议 | 至少 ${hooksPerChapter.min}，建议 ${hooksPerChapter.ideal} |`;
      expect(text, `${platform} 钩子行应为 ${row}`).toContain(row);
    }
  });

  it("每条 profile note 都出现在文档里", () => {
    for (const platform of SUPPORTED_PUBLISH_PLATFORMS) {
      for (const note of getPlatformProfile(platform).notes) {
        expect(text, `${platform} 缺少 note：${note}`).toContain(note);
      }
    }
  });

  it("文档明确 AI 味和敏感词命中只供人工复核", () => {
    expect(text).toContain("不能替代平台审核");
    expect(text).toContain("不阻断正式章节保存");
    expect(text).not.toContain("AI 率容忍");
    expect(text).not.toContain("敏感词阻断");
  });

  it("平台别名表覆盖实现支持的写法", () => {
    const aliases: Array<[string, string]> = [
      ["tomato", "fanqie"], ["fanqie", "fanqie"], ["番茄", "fanqie"],
      ["qidian", "qidian"], ["起点", "qidian"], ["jjwxc", "jjwxc"],
      ["晋江", "jjwxc"], ["qimao", "qimao"], ["七猫", "qimao"],
      ["feilu", "generic"], ["飞卢", "generic"], ["other", "generic"],
    ];
    for (const [input, expected] of aliases) {
      expect(resolvePublishPlatform({ platform: input }), `别名 ${input}`).toBe(expected);
      expect(text, `文档缺少别名 ${input}`).toContain(input);
    }
  });
});
