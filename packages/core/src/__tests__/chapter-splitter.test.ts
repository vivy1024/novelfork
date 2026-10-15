import { describe, expect, it } from "vitest";
import { splitChapters, splitChaptersWithVolumes } from "../utils/chapter-splitter.js";

describe("splitChapters", () => {
  it("splits classical Chinese chapter headings with 第X回 by default", () => {
    const input = [
      "第一回：宴桃園豪傑三結義，斬黃巾英雄首立功",
      "",
      "滾滾長江東逝水，浪花淘盡英雄。",
      "",
      "第二回：張翼德怒鞭督郵，何國舅謀誅宦豎",
      "",
      "且說董卓專權，朝野震動。",
    ].join("\n");

    const chapters = splitChapters(input);

    expect(chapters).toHaveLength(2);
    expect(chapters[0]).toEqual({
      title: "宴桃園豪傑三結義，斬黃巾英雄首立功",
      content: "滾滾長江東逝水，浪花淘盡英雄。",
    });
    expect(chapters[1]).toEqual({
      title: "張翼德怒鞭督郵，何國舅謀誅宦豎",
      content: "且說董卓專權，朝野震動。",
    });
  });

  it("uses a 第N回 fallback title when a classical Chinese heading has no title text", () => {
    const input = [
      "第一回",
      "",
      "天下大勢，分久必合，合久必分。",
    ].join("\n");

    const chapters = splitChapters(input);

    expect(chapters).toHaveLength(1);
    expect(chapters[0]?.title).toBe("第1回");
  });

  it("splits classical Chinese headings that use the round-zero numeral form", () => {
    const input = [
      "第九十九回：孔明秋雨退魏兵",
      "",
      "未知孔明怎生破魏，且看下文分解。",
      "",
      "第一○○回：漢兵劫寨破曹真，武侯鬥陣辱仲達",
      "",
      "卻說眾將聞孔明不追魏兵，俱入帳告曰。",
    ].join("\n");

    const chapters = splitChapters(input);

    expect(chapters).toHaveLength(2);
    expect(chapters[0]).toEqual({
      title: "孔明秋雨退魏兵",
      content: "未知孔明怎生破魏，且看下文分解。",
    });
    expect(chapters[1]).toEqual({
      title: "漢兵劫寨破曹真，武侯鬥陣辱仲達",
      content: "卻說眾將聞孔明不追魏兵，俱入帳告曰。",
    });
  });

  it("splits English chapter headings with the default pattern", () => {
    const input = [
      "Chapter 1: Prelude",
      "",
      "The harbor bells rang before dawn.",
      "",
      "Chapter 2: Into the Fog",
      "",
      "Mara followed the last lantern into the mist.",
    ].join("\n");

    const chapters = splitChapters(input);

    expect(chapters).toHaveLength(2);
    expect(chapters[0]).toEqual({
      title: "Prelude",
      content: "The harbor bells rang before dawn.",
    });
    expect(chapters[1]).toEqual({
      title: "Into the Fog",
      content: "Mara followed the last lantern into the mist.",
    });
  });

  it("uses an English fallback title when the chapter heading has no title text", () => {
    const input = [
      "Chapter 1",
      "",
      "The harbor bells rang before dawn.",
    ].join("\n");

    const chapters = splitChapters(input);

    expect(chapters).toHaveLength(1);
    expect(chapters[0]?.title).toBe("Chapter 1");
  });

  it("splits Roman numeral English chapter headings with the default pattern", () => {
    const input = [
      "CHAPTER I.",
      "",
      "The harbor bells rang before dawn.",
      "",
      "CHAPTER II.",
      "",
      "Mara followed the last lantern into the mist.",
    ].join("\n");

    const chapters = splitChapters(input);

    expect(chapters).toHaveLength(2);
    expect(chapters[0]).toEqual({
      title: "Chapter 1",
      content: "The harbor bells rang before dawn.",
    });
    expect(chapters[1]).toEqual({
      title: "Chapter 2",
      content: "Mara followed the last lantern into the mist.",
    });
  });

  it("keeps English fallback titles when a custom regex matches Roman numeral headings", () => {
    const input = [
      "CHAPTER I.",
      "",
      "The harbor bells rang before dawn.",
    ].join("\n");

    const chapters = splitChapters(input, "^CHAPTER\\s+[IVXLCDM]+\\.$");

    expect(chapters).toHaveLength(1);
    expect(chapters[0]?.title).toBe("Chapter 1");
  });

  it("strips a Project Gutenberg trailer from the final chapter content", () => {
    const input = [
      "Chapter 1: Finale",
      "",
      "The harbor bells rang once and went silent.",
      "",
      "Project Gutenberg™ depends upon and cannot survive without widespread",
      "public support and donations to carry out its mission.",
    ].join("\n");

    const chapters = splitChapters(input);

    expect(chapters).toHaveLength(1);
    expect(chapters[0]?.content).toBe("The harbor bells rang once and went silent.");
    expect(chapters[0]?.content).not.toContain("Project Gutenberg");
  });
});


describe("splitChaptersWithVolumes", () => {
  it("按「第N卷」分卷，卷标题行不再吃进上一章正文", () => {
    const input = [
      "第一卷 光与影",
      "第一章 正义",
      "夜里开店。",
      "第二章 坠落",
      "天亮了。",
      "第二卷 血海",
      "第三章 报仇",
      "再见。",
      "",
      "第四十章 远行",
      "上路。",
    ].join("\n");

    const { volumes, chapters } = splitChaptersWithVolumes(input);
    expect(volumes).toEqual([
      { index: 1, title: "光与影" },
      { index: 2, title: "血海" },
    ]);
    expect(chapters.map((chapter) => chapter.title)).toEqual(["正义", "坠落", "报仇", "远行"]);
    expect(chapters.map((chapter) => chapter.volumeIndex)).toEqual([1, 1, 2, 2]);
    expect(chapters[1]!.content).toBe("天亮了。");
  });

  it("没有卷标题的旧稿整体归一卷，行为与 splitChapters 一致", () => {
    const input = "第一章 起\n开头。\n第二章 承\n中段。";
    const { volumes, chapters } = splitChaptersWithVolumes(input);
    expect(volumes).toEqual([]);
    expect(chapters.map((chapter) => chapter.volumeIndex)).toEqual([1, 1]);
  });

  it("自定义切分 pattern 时不做卷捕获", () => {
    const input = "第一卷 x\n第一章 a\n第一段。\n第二章 b\n第二段。";
    const { volumes, chapters } = splitChaptersWithVolumes(input, "^第[一二三四五六七八九十百千万\\d]+章");
    expect(volumes).toEqual([]);
    expect(chapters.map((chapter) => chapter.title)).toEqual(["第1章", "第2章"]);
  });
});

describe("T-07 分章正则 ReDoS 与导入上限", () => {
  it("rejects a catastrophic-backtracking splitPattern instead of executing it", () => {
    const input = `${"a".repeat(24)}!\n第一章 x\n正文。`;
    expect(() => splitChapters(input, "^(a+)+$")).toThrow(/splitPattern/);
  });

  it("rejects a splitPattern longer than the allowed length", () => {
    const longPattern = "^第".repeat(200);
    expect(() => splitChapters("第一章 x\n正文。", longPattern)).toThrow(/splitPattern/);
  });

  it("rejects an oversized chapter body before splitting", () => {
    const hugeBody = "字".repeat(5_000_000);
    expect(() => splitChapters(`第一章 x\n${hugeBody}`)).toThrow(/正文/);
  });
});

/** 计时断言统一放宽：只区分「线性/秒级以内」与「二次/指数爆炸」，不在慢机器上抖动。 */
function elapsedMs(task: () => unknown): number {
  const started = performance.now();
  try {
    task();
  } catch {
    // 计时用例只关心耗时；抛错与否由各自的断言判断。
  }
  return performance.now() - started;
}

describe("T-07 分章规则校验：解析器而非「用正则判定正则」", () => {
  const benign = "第一章 x\n正文。\n第二章 y\n正文二。";

  it.each([
    ["^(a|aa)+$", /分组/],
    ["^((a+))+$", /分组/],
    ["^(a|a?)+$", /分组/],
    ["^(a?){24}a{24}$", /分组/],
    ["^(?:第\\d+章)*$", /分组/],
    ["^(第)\\1章", /反向引用/],
    ["^(?<n>第)\\k<n>", /反向引用/],
    ["^(?=第)第\\d+章", /环视/],
    ["^(?!序)第\\d+章", /环视/],
    ["(?<=^)第\\d+章", /环视/],
    ["(?<!序)第\\d+章", /环视/],
    ["^a*b*c*d*e*$", /无界量词/],
    ["^.*.*.*.*x$", /组合过多/],
    [".*.*.*.*x", /组合过多/],
    [`${"a?".repeat(24)}${"a".repeat(24)}b`, /组合过多/],
  ])("拒绝 %s", (pattern, reason) => {
    expect(() => splitChapters(benign, pattern)).toThrow(/splitPattern/);
    expect(() => splitChapters(benign, pattern)).toThrow(reason);
    expect(() => splitChaptersWithVolumes(benign, pattern)).toThrow(reason);
  });

  it("语法错误的规则给出明确原因而不是原样抛 SyntaxError", () => {
    expect(() => splitChapters(benign, "^第(\\d+章")).toThrow(/splitPattern.*不是有效的正则/);
  });

  it("正常的章节标题规则仍可用", () => {
    const text = [
      "第1章 风起", "甲。",
      "第2章 云涌", "乙。",
    ].join("\n");
    expect(splitChapters(text, "^第(\\d+)章\\s*(.*)$").map((chapter) => chapter.content)).toEqual(["甲。", "乙。"]);
    expect(splitChapters(text, "^\\s*第(\\d+)章\\s*(.*)$")).toHaveLength(2);

    const bracketed = "【1】开篇\n甲。\n【2】转折\n乙。";
    expect(splitChapters(bracketed, "^【\\d+】(.*)").map((chapter) => chapter.title)).toEqual(["开篇", "转折"]);

    const numbered = "1、开篇\n甲。\n第2.转折\n乙。";
    expect(splitChapters(numbered, "^(?:第)?(\\d+)[、.](.*)$")).toHaveLength(2);

    const english = "Chapter 1\nThe bells.\nChapter 2\nThe fog.";
    expect(splitChapters(english, "^Chapter\\s+(\\d+)").map((chapter) => chapter.content)).toEqual(["The bells.", "The fog."]);
  });

  it("CRLF 正文里 $ 结尾的规则照常命中（逐行去掉行尾 \\r 再匹配）", () => {
    const text = "第1章 风起\r\n甲。\r\n第2章 云涌\r\n乙。";
    expect(splitChapters(text, "^第\\d+章\\s*(.+)$").map((chapter) => chapter.title)).toEqual(["风起", "云涌"]);
  });
});

describe("T-07 分章规则执行：行长上限与累计时限", () => {
  it("用户规则只在不超过 200 字的行上尝试：超长行不会被当成章节标题", () => {
    const longLine = `第3章 ${"字".repeat(300)}`;
    const text = ["第1章 起", "甲。", longLine, "第2章 承", "乙。"].join("\n");
    const chapters = splitChapters(text, "^第\\d+章");
    expect(chapters).toHaveLength(2);
    expect(chapters[0]!.content).toContain(longLine);
  });

  it("两个入口一致：splitChaptersWithVolumes 也只在短行上尝试用户规则", () => {
    const longLine = `第3章 ${"字".repeat(300)}`;
    const text = ["第1章 起", "甲。", longLine, "第2章 承", "乙。"].join("\n");
    expect(splitChaptersWithVolumes(text, "^第\\d+章").chapters).toHaveLength(2);
  });

  it("多项式规则在 200 字的行上很快返回；超长行直接跳过，不会卡住", () => {
    const shortLines = Array.from({ length: 5 }, () => "a".repeat(199)).join("\n");
    const hugeLine = "a".repeat(100_000);
    expect(elapsedMs(() => splitChapters(`${shortLines}\n第1章 x\n正文`, "^.*.*.*x$"))).toBeLessThan(1_000);
    expect(elapsedMs(() => splitChapters(`${hugeLine}\n第1章 x\n正文`, "^.*.*.*x$"))).toBeLessThan(1_000);
  });

  it("通过校验但逐行回溯较多的规则，累计超过时限即报错，不会把服务卡住", () => {
    // 每行约几十毫秒（通过了组合预算），400 行不设时限要跑好几秒。
    const pattern = `${"(?:a|aa)".repeat(15)}x`;
    const text = Array.from({ length: 400 }, () => "a".repeat(200)).join("\n");
    let error: unknown;
    const elapsed = elapsedMs(() => {
      try {
        splitChapters(text, pattern);
      } catch (caught) {
        error = caught;
        throw caught;
      }
    });
    expect(String(error)).toContain("分章规则执行超时，请简化规则或不填写");
    // 时限 1500ms + 最后一行的耗时；阈值放宽到 8 秒，只用来证明不是跑满全部行。
    expect(elapsed).toBeLessThan(8_000);
  }, 30_000);
});

describe("T-07 默认路径不再有二次以上复杂度", () => {
  it("正文里 10 万个空行时，去除 Gutenberg 尾注不跨行回溯（1 秒内完成）", () => {
    const text = `第一章 a\n${"\n".repeat(100_000)}`;
    expect(elapsedMs(() => splitChapters(text))).toBeLessThan(1_000);
  });

  it("全角缩进的 Gutenberg 尾注仍被识别并去掉", () => {
    const text = "Chapter 1: Finale\nThe end.\n　　Project Gutenberg™ license text";
    expect(splitChapters(text)[0]!.content).toBe("The end.");
  });

  it("卷标题行里大段空白不再引发二次回溯", () => {
    const text = `第一卷x${" ".repeat(60_000)}y\n第一章 a\n正文。`;
    let result: ReturnType<typeof splitChaptersWithVolumes> | undefined;
    expect(elapsedMs(() => { result = splitChaptersWithVolumes(text); })).toBeLessThan(1_000);
    expect(result!.volumes).toHaveLength(1);
    expect(result!.volumes[0]!.title).toBe(`x${" ".repeat(60_000)}y`);
  });

  it("卷标题去掉首尾空白（含全角空格与 CRLF），与旧写法一致", () => {
    const { volumes } = splitChaptersWithVolumes("第一卷　 光与影 　\r\n第一章 正义\r\n正文。");
    expect(volumes).toEqual([{ index: 1, title: "光与影" }]);
  });

  it("上千个卷与章交替时，按行定位所属卷是线性的", () => {
    const parts: string[] = [];
    for (let index = 1; index <= 5_000; index += 1) parts.push(`第${index}卷 卷${index}`, `第${index}章 章${index}`, "正文。");
    let result: ReturnType<typeof splitChaptersWithVolumes> | undefined;
    expect(elapsedMs(() => { result = splitChaptersWithVolumes(parts.join("\n")); })).toBeLessThan(1_500);
    expect(result!.chapters).toHaveLength(5_000);
    expect(result!.chapters[4_999]!.volumeIndex).toBe(5_000);
    expect(result!.chapters[0]!.volumeIndex).toBe(1);
  }, 60_000);
});
