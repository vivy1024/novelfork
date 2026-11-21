import { describe, expect, it } from "vitest";

import {
  analyzeWordFrequency,
  scanAdverbAndHedgingClutter,
  scanMetaLeaks,
  scanPovSelfSightLeaks,
} from "./prose-lenses.js";

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

describe("prose-lenses: 冗余副词/弱化词与有限 POV 自我不可见初筛", () => {
  it("达到阈值时捕获叙述段冗余「副词+地+动词」与弱化词聚集，并放行对白引号内部", () => {
    const content = [
      "# 第九章 审讯室",
      "",
      "他冷冷地说道：“或许、大概、似乎你早就知道了。”",
      "陈默愤怒地喊道，接着用力地关上铁门，又缓缓地走回桌前。",
      "走廊里大概或许似乎稍稍有点不对劲，仿佛连灯光都非常暗淡。",
    ].join("\n");

    const hits = scanAdverbAndHedgingClutter(content);
    expect(hits.some((h) => h.kind === "redundant-adverb")).toBe(true);
    // 第 1 段弱化词在引号内应放行；第 3 段叙述段弱化词聚集应命中
    const hedgingHits = hits.filter((h) => h.kind === "hedging-cluster");
    expect(hedgingHits).toHaveLength(1);
    expect(hedgingHits[0]?.paragraphIndex).toBe(3);
  });

  it("有限视角无镜面时初筛角色看不见的自我眼神/神情描写，有镜面或倒影语境则放行", () => {
    const content = [
      "# 第十章 暗室",
      "",
      "沈追眼底闪过一丝寒意。沈追抬起坚毅的双眸望向长廊。",
      "我走到铜盆边，借着水面看见我眼底闪过一丝疲惫。",
      "林岚眼底闪过一丝狐疑，没有接话。",
    ].join("\n");

    const hits = scanPovSelfSightLeaks(content, "沈追");
    expect(hits).toHaveLength(2);
    expect(hits.every((h) => h.paragraphIndex === 1 && h.reviewOnly)).toBe(true);
    // 非视角人物林岚与有水面反光的第 2 段不应误报
    expect(hits.some((h) => h.quote.includes("林岚"))).toBe(false);
    expect(hits.some((h) => h.paragraphIndex === 2)).toBe(false);
  });
});
