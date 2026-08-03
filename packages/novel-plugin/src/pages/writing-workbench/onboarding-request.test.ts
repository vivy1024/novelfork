import { describe, expect, it } from "vitest";

import { buildOnboardingRequestMessage } from "./onboarding-request";

/**
 * 建书收尾的编排消息。前端不自己执行工具，只发这条请求；
 * 所以消息里的四步与工具名必须准确，否则叙述者会漏步骤。
 */
describe("buildOnboardingRequestMessage", () => {
  it("包含四步编排与正确的工具名", () => {
    const message = buildOnboardingRequestMessage();
    expect(message).toContain("writing-skills.recommend");
    expect(message).toContain("writing-skills.read");
    expect(message).toContain("AskUserQuestion");
    expect(message).toContain("writing-skills.write");
    expect(message).toContain("lore.write");
    // 落经纬必须先进 needs-review，作者确认后才升 canon
    expect(message).toContain("layer=dynamic");
    expect(message).toContain("needs-review");
  });

  it("追问覆盖四个关键设定方面", () => {
    const message = buildOnboardingRequestMessage();
    expect(message).toContain("终局");
    expect(message).toContain("对手");
    expect(message).toContain("伏笔");
    expect(message).toContain("不想写");
  });

  it("带上推荐清单与理由，供作者在对话里直接看到", () => {
    const message = buildOnboardingRequestMessage({
      bookTitle: "灵潮纪元",
      matchedGenreCluster: "异能志怪",
      recommendedWritingSkills: [
        { name: "异能志怪-强化章节开头", reason: "新书前三章决定留存" },
        { name: "异能志怪-输出番茄版", reason: "平台选了番茄" },
      ],
    });
    expect(message).toContain("《灵潮纪元》");
    expect(message).toContain("异能志怪");
    expect(message).toContain("异能志怪-强化章节开头：新书前三章决定留存");
    expect(message).toContain("异能志怪-输出番茄版：平台选了番茄");
  });

  it("没有推荐时也能生成可执行请求，不出现空清单段落", () => {
    const message = buildOnboardingRequestMessage({ recommendedWritingSkills: [] });
    expect(message).toContain("writing-skills.recommend");
    expect(message).not.toContain("预选了这些 Writing Skills");
  });

  it("明确禁止跳过确认直接启用或替作者编造设定", () => {
    const message = buildOnboardingRequestMessage();
    expect(message).toContain("不要跳过");
    expect(message).toContain("编造");
  });
});
