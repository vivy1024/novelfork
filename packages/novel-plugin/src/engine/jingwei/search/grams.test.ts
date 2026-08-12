import { describe, expect, it } from "vitest";

import {
  extractShortCjkTerms,
  isCjkChar,
  toFtsQuery,
  toGrams,
  verifyMatch,
} from "./grams.js";

describe("toGrams", () => {
  it("把中文连续段切成逐字 bigram", () => {
    expect(toGrams("韩立在太清门修炼")).toBe("韩立 立在 在太 太清 清门 门修 修炼");
  });

  it("单字中文保留原字", () => {
    expect(toGrams("婉")).toBe("婉");
  });

  it("ASCII 词原样小写", () => {
    expect(toGrams("Han Li")).toBe("han li");
    expect(toGrams("AVX2 芯片")).toBe("avx2 芯片");
  });

  it("标点与空白作为段分隔符，不产生跨段 bigram", () => {
    expect(toGrams("韩立。南宫婉")).toBe("韩立 南宫 宫婉");
  });

  it("中英混排各自切分", () => {
    expect(toGrams("寒焰诀 FrostFlame")).toBe("寒焰 焰诀 frostflame");
  });

  it("空串与纯标点返回空", () => {
    expect(toGrams("")).toBe("");
    expect(toGrams("！？。，")).toBe("");
  });
});

describe("isCjkChar", () => {
  it("识别中文与假名，不识别拉丁字母", () => {
    expect(isCjkChar("韩")).toBe(true);
    expect(isCjkChar("の")).toBe(true);
    expect(isCjkChar("a")).toBe(false);
    expect(isCjkChar("1")).toBe(false);
  });
});

describe("toFtsQuery", () => {
  it("多词查询转 phrase + AND", () => {
    const { expr, shortTerms } = toFtsQuery("韩立 太清门");
    expect(expr).toBe('"韩立" AND "太清 清门"');
    expect(shortTerms).toEqual([]);
  });

  it("单字中文进入 shortTerms，不进入 MATCH", () => {
    const { expr, shortTerms } = toFtsQuery("婉");
    expect(expr).toBe("");
    expect(shortTerms).toEqual(["婉"]);
  });

  it("混合：双字词走 FTS，单字降级", () => {
    const { expr, shortTerms } = toFtsQuery("韩立 婉");
    expect(expr).toBe('"韩立"');
    expect(shortTerms).toEqual(["婉"]);
  });

  it("英文词作为短语", () => {
    const { expr } = toFtsQuery("frostflame");
    expect(expr).toBe('"frostflame"');
  });

  it("空查询无表达式", () => {
    const { expr, terms } = toFtsQuery("   ");
    expect(expr).toBe("");
    expect(terms).toEqual([]);
  });
});

describe("extractShortCjkTerms", () => {
  it("提取孤立的单字，不拆双字词", () => {
    expect(extractShortCjkTerms("韩立 婉 太清门")).toEqual(["婉"]);
  });
});

describe("verifyMatch", () => {
  const base = {
    title: "太清门",
    aliases: ["太清宗"],
    tags: ["修仙"],
    summary: "太清门坐落于青蛟岛",
    content: "韩立在太清门修炼寒焰诀，与南宫婉同行。",
    keywords: [],
  };

  it("真实命中：词在正文中连续出现", () => {
    const matched = verifyMatch("太清门", base);
    expect(matched).toContain("title");
    expect(matched).toContain("content");
  });

  it("多词 AND：两个词都出现才通过", () => {
    expect(verifyMatch("韩立 太清门", base)).toContain("content");
    expect(verifyMatch("韩立 黄枫谷", base)).toEqual([]);
  });

  it("多词跨字段：词分布在不同字段也通过（弱命中）", () => {
    const fields = {
      title: "韩立",
      aliases: ["韩老魔"],
      tags: [],
      summary: "",
      content: "谨慎、低调。",
      keywords: ["小瓶"],
    };
    const matched = verifyMatch("韩立 小瓶", fields);
    expect(matched).toContain("title");
    expect(matched).toContain("keywords");
  });

  it("单词查询不跨字段降级：正文含词但标题不含时仍通过（整体子串）", () => {
    const fields = {
      title: "杂记",
      aliases: [],
      tags: [],
      summary: "",
      content: "韩立在太清门修炼。",
      keywords: [],
    };
    expect(verifyMatch("韩立", fields)).toEqual(["content"]);
  });

  it("假阳性剔除：标点切开的相邻 token 不通过", () => {
    const fields = {
      title: "他登上太清",
      aliases: [],
      tags: [],
      summary: "",
      content: "他登上太清。清门之外风雪交加。",
      keywords: [],
    };
    // bigram phrase "太清 清门" 会命中 content，但原文没有「太清门」
    expect(verifyMatch("太清门", fields)).toEqual([]);
  });

  it("别名反向匹配：搜正名命中别名", () => {
    const matched = verifyMatch("韩老魔", { ...base, aliases: ["韩老魔 小韩"] });
    expect(matched).toContain("aliases");
  });
});
