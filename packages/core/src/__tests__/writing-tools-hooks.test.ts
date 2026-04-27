import { describe, expect, it } from "vitest";
import { generateChapterHooks, parseGeneratedHooks } from "../tools/chapter-hooks/hook-generator.js";

describe("chapter hook generator", () => {
  it("parses structured hook JSON", () => {
    const hooks = parseGeneratedHooks(JSON.stringify([
      {
        style: "suspense",
        text: "门外响起了第三个人的脚步声。",
        rationale: "制造新问题。",
        retentionEstimate: "high",
        relatedHookIds: ["H001"],
      },
      {
        style: "reversal",
        text: "他终于看清，令牌背面刻着自己的名字。",
        rationale: "反转身份线索。",
        retentionEstimate: "medium",
      },
      {
        style: "emotional",
        text: "师父没有回头，只把那把旧剑推到他面前。",
        rationale: "用情感牵引下一章。",
        retentionEstimate: "medium",
      },
    ]));

    expect(hooks).toHaveLength(3);
    expect(hooks[0]).toEqual(expect.objectContaining({
      id: "hook-1",
      style: "suspense",
      retentionEstimate: "high",
    }));
  });

  it("generates at least three hooks through an injected chat function", async () => {
    const hooks = await generateChapterHooks({
      input: {
        chapterContent: "林青在山门前看见了血玉令。",
        chapterNumber: 8,
        pendingHooks: "H001 血玉令",
        nextChapterIntent: "揭露血玉令来历",
        bookGenre: "xianxia",
      },
      chat: async () => ({
        content: JSON.stringify([
          { style: "suspense", text: "血玉令忽然发烫。", rationale: "引出异变。", retentionEstimate: "high" },
          { style: "info-gap", text: "令牌背后少了最后一笔。", rationale: "留下信息缺口。", retentionEstimate: "medium" },
          { style: "mystery", text: "山门石阶下传来熟悉的叹息。", rationale: "制造谜团。", retentionEstimate: "medium" },
        ]),
      }),
    });

    expect(hooks.length).toBeGreaterThanOrEqual(3);
    expect(hooks.every((hook) => hook.text.length > 0)).toBe(true);
  });
});
