import { describe, expect, it } from "vitest";

import { analyzeWordFrequency, scanMetaLeaks } from "./prose-lenses.js";

describe("prose-lenses: scanMetaLeaks 工程元信息穿帮扫描", () => {
  it("忽略首行 Markdown 章节标题或第一行章名，但精准捕获正文段落中的穿帮词", () => {
    const content = [
      "# 第十二章 夜探藏经阁",
      "",
      "延续上一章的悬念，陈默推开了沉重的木门。",
      "这里埋下一个关键伏笔，为下一章的反击做铺垫。",
    ].join("\n");

    const hits = scanMetaLeaks(content);
    const terms = hits.map((h) => h.term);
    expect(terms).toContain("上一章");
    expect(terms).toContain("伏笔");
    expect(terms).toContain("下一章");
    // 首行标题「第十二章」不应被误判为穿帮
    expect(terms).not.toContain("第十二章");
    // 每条均具备三要素 explanation 与非空定位原句 quote
    for (const hit of hits) {
      expect(hit.quote.length).toBeGreaterThan(2);
      expect(hit.explanation.whatHappened).toContain(hit.term);
      expect(hit.explanation.whyItMatters.length).toBeGreaterThan(4);
      expect(hit.explanation.suggestedAction.length).toBeGreaterThan(4);
    }
  });

  it("台词引号内的正常角色对话（如讨论方案大纲、提到读者）不误报，但叙述区的裸『第三章』会提示复核", () => {
    const content = [
      "第3章 会议室争锋",
      "",
      "林岚敲了敲桌面：“这份企划大纲必须重做，目标读者的画像太模糊了，再像第三章那样写就废了。”",
      "正如第三章交代过的那样，财务总监脸色铁青。",
    ].join("\n");

    const hits = scanMetaLeaks(content);
    expect(hits.some((h) => h.term === "大纲")).toBe(false);
    expect(hits.some((h) => h.term === "读者")).toBe(false);
    // 第二段叙述区的裸「第三章」应命中且标记 reviewOnly
    const bareHit = hits.find((h) => h.term === "第三章");
    expect(bareHit).toBeDefined();
    expect(bareHit?.paragraphIndex).toBe(2);
    expect(bareHit?.reviewOnly).toBe(true);
  });

  it("干净的正常网文正文返回空数组", () => {
    const clean = [
      "# 第一章 寒门风雪",
      "",
      "鹅毛大雪压弯了院角的枯枝。少年握紧手里的铁刀，一步步走向祠堂。",
      "屋檐下的铜铃在北风里发出清脆声响，却没人敢推开那扇门。",
    ].join("\n");

    expect(scanMetaLeaks(clean)).toEqual([]);
  });
});

describe("prose-lenses: analyzeWordFrequency 零 Token 高频词与疲劳词透镜", () => {
  it("优先识别网文高频疲劳词并提取重复出现的实词，过滤常见虚词", () => {
    const content = [
      "# 第五章 青铜古殿",
      "",
      "顾长生深吸一口气，目光落在青铜古剑上。他的眼神微微一凝，心中暗道不好。",
      "就在这时，青铜古剑发出一阵嗡鸣。顾长生深吸一口气，目光死死盯着剑柄上的裂纹。",
      "大殿深处寒气弥漫，他再次深吸一口气，收回目光，握住了那柄冰冷的青铜古剑。",
      "周围的石像没有任何动静，但是他的心里很清楚事情并不简单，目光依旧没有离开祭坛。",
    ].join("\n");

    const items = analyzeWordFrequency(content, { minCount: 3, limit: 12 });
    expect(items.length).toBeGreaterThan(0);

    const muguang = items.find((i) => i.term === "目光");
    expect(muguang).toBeDefined();
    expect(muguang?.count).toBe(4);
    expect(muguang?.category).toBe("fatigue");
    expect(muguang?.sampleQuote).toContain("目光");

    const breathe = items.find((i) => i.term === "深吸一口气");
    expect(breathe).toBeDefined();
    expect(breathe?.count).toBe(3);
    expect(breathe?.category).toBe("fatigue");

    const sword = items.find((i) => i.term === "青铜古剑");
    expect(sword).toBeDefined();
    expect(sword?.count).toBe(3);
    expect(sword?.category).toBe("ngram");

    // 虚词如「他的」「没有」「事情」不应混入榜单
    const terms = items.map((i) => i.term);
    expect(terms).not.toContain("他的");
    expect(terms).not.toContain("没有");
    expect(terms).not.toContain("事情");
    // 已被「青铜古剑」覆盖的子串「青铜」「古剑」不应重复刷屏
    expect(terms).not.toContain("青铜");
    expect(terms).not.toContain("古剑");
  });
});
