import { describe, expect, it, vi } from "vitest";

import type { DistillableChapter } from "./style-distillation.js";
import {
  assessStyleBatchEvidence,
  extractStyleRulesFromBatch,
  isStyleDistillationOutputTruncated,
  locateStyleEvidenceInChapters,
  parseStyleDistillationBatchOutput,
  STYLE_DISTILLATION_BATCH_MAX_TOKENS,
  type StyleDistillationTextGenerator,
} from "./style-distillation-model.js";
import { normalizeEvidenceForMatch } from "./style-distillation-normalize.js";

// 繁体原文、〈〉引号、全角 Ｑ：真模型验收样文《阿Ｑ正傳》的写法。
const chapter: DistillableChapter = {
  number: 1,
  title: "序",
  content: "我要給阿Ｑ做正傳，已經不止一兩年了。但一面要做，一面又往回想，這足見我不是一個〈立言〉的人。他說：〈我們先前——比你闊的多啦！你算是什麼東西！〉",
};

function rule(evidence: string, text = "叙述者先自嘲再入正题，制造反讽距离") {
  return { category: "voice", text, evidence, transfer: "transferable", reason: "与题材无关" };
}

describe("D1 蒸馏批次被截断的判定", () => {
  it("宿主报 outputTruncated 时，即使输出里没有 JSON 也报截断，并建议缩小批次或降低思考强度", () => {
    const result = parseStyleDistillationBatchOutput("我先分析一下这几章的写法……", [chapter], { outputTruncated: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.explanation.what).toContain("模型输出被截断");
    expect(result.explanation.next).toContain("思考强度");
    expect(result.explanation.next).toContain("缩小");
    expect(result.explanation.next).not.toContain("更守格式");
  });

  it("输出 token 达到上限的 98% 以上视为截断（宿主不报 outputTruncated 时的兜底）", () => {
    const max = STYLE_DISTILLATION_BATCH_MAX_TOKENS;
    expect(isStyleDistillationOutputTruncated({ usage: { completionTokens: Math.ceil(max * 0.98) } })).toBe(true);
    expect(isStyleDistillationOutputTruncated({ usage: { completionTokens: max } })).toBe(true);
    expect(isStyleDistillationOutputTruncated({ usage: { completionTokens: Math.floor(max * 0.9) } })).toBe(false);
    expect(isStyleDistillationOutputTruncated({ outputTruncated: true })).toBe(true);
    expect(isStyleDistillationOutputTruncated({})).toBe(false);
    // 验收里的实例：上限 8000 时 7996 token 判为截断。
    expect(isStyleDistillationOutputTruncated({ usage: { completionTokens: 7_996 } }, 8_000)).toBe(true);
  });

  it("模型用满输出上限却没写出 JSON（思考把额度耗尽）：批次报截断而不是「没有 JSON」", async () => {
    const generateText = vi.fn<StyleDistillationTextGenerator>(async () => ({
      text: "",
      usage: { completionTokens: STYLE_DISTILLATION_BATCH_MAX_TOKENS - 4 },
    }));
    const result = await extractStyleRulesFromBatch({ generateText, sourceName: "阿Q正传", chapters: [chapter] });
    expect(generateText.mock.calls[0]?.[0].maxTokens).toBe(STYLE_DISTILLATION_BATCH_MAX_TOKENS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.explanation.what).toContain("模型输出被截断");
    expect(result.explanation.what).not.toContain("没有 JSON");
    expect(result.explanation.next).not.toContain("更守格式");
  });

  it("JSON 没闭合（截在半截）同样走截断建议；未截断时真没有 JSON 仍报没有 JSON", () => {
    const half = parseStyleDistillationBatchOutput('{"rules":[{"category":"voice","text":"叙述', [chapter]);
    expect(half.ok).toBe(false);
    if (!half.ok) {
      expect(half.explanation.what).toContain("模型输出被截断");
      expect(half.explanation.next).toContain("思考强度");
    }
    const noJson = parseStyleDistillationBatchOutput("我不想输出 JSON", [chapter]);
    expect(noJson.ok).toBe(false);
    if (!noJson.ok) expect(noJson.explanation.what).toContain("没有 JSON");
  });

  it("输出上限给思考型模型的推理留了余量（≥16000）", () => {
    expect(STYLE_DISTILLATION_BATCH_MAX_TOKENS).toBeGreaterThanOrEqual(16_000);
  });
});

describe("D2 证据比对的归一", () => {
  it("〈〉写成「」、繁体写成简体、全角 Ｑ 写成半角 Q 都能命中，返回的片段仍是原文原字", () => {
    const located = locateStyleEvidenceInChapters("这足见我不是一个「立言」的人", [chapter]);
    expect(located).toEqual({ chapterNumber: 1, excerpt: "這足見我不是一個〈立言〉的人" });
    expect(locateStyleEvidenceInChapters("我要给阿Q做正传，已经不止一两年了", [chapter])?.excerpt)
      .toBe("我要給阿Ｑ做正傳，已經不止一兩年了");
    expect(locateStyleEvidenceInChapters("他说：“我们先前——比你阔的多啦！", [chapter])?.chapterNumber).toBe(1);
    expect(locateStyleEvidenceInChapters("《我們先前——比你闊的多啦！》", [chapter])?.chapterNumber).toBe(1);
    // 繁简混写与半角标点
    expect(locateStyleEvidenceInChapters("你算是什么東西!", [chapter])?.excerpt).toBe("你算是什麼東西！");
  });

  it("归一只用于比对：各类引号与空白忽略，全半角、大小写、繁简逐字映射", () => {
    expect(normalizeEvidenceForMatch("〈說〉『個』《Ｑ》“q”")).toBe(normalizeEvidenceForMatch("「说」\"个\"'Q'〔q〕"));
    expect(normalizeEvidenceForMatch("〈說〉 個Ｑ")).toBe("说个q");
    expect(normalizeEvidenceForMatch("說是〈外傳〉")).toBe(normalizeEvidenceForMatch("说是外传"));
  });

  it("模型省略了原文引号仍能命中，返回的片段带回原文引号", () => {
    const quoted: DistillableChapter = { number: 2, title: "序", content: "然而要做這一篇速朽的文章，說是〈外傳〉，〈內傳〉在那裡呢？" };
    // 全部省略
    expect(locateStyleEvidenceInChapters("說是外傳，內傳在那裡呢", [quoted]))
      .toEqual({ chapterNumber: 2, excerpt: "說是〈外傳〉，〈內傳〉在那裡呢" });
    // 部分省略、部分换样式，外加整段再套一层引号
    expect(locateStyleEvidenceInChapters("“说是外传，「內传」在那里呢”", [quoted])?.excerpt)
      .toBe("說是〈外傳〉，〈內傳〉在那裡呢");
    // 含引号的证据照常命中
    expect(locateStyleEvidenceInChapters("說是〈外傳〉，〈內傳〉在那裡呢？", [quoted])?.excerpt)
      .toBe("說是〈外傳〉，〈內傳〉在那裡呢？");
    // 多段证据同样适用
    expect(locateStyleEvidenceInChapters("速朽的文章……說是外傳", [quoted])?.excerpt)
      .toBe("速朽的文章……說是〈外傳");
    // 真编造仍被拒：删掉引号不会让改写的字对上
    expect(locateStyleEvidenceInChapters("說是正傳，內傳在那裡呢", [quoted])).toBeNull();
    expect(locateStyleEvidenceInChapters("〈〉", [quoted])).toBeNull();
  });

  it("真编造的证据仍被拒，并保留被丢弃条目与原因", () => {
    const result = parseStyleDistillationBatchOutput(JSON.stringify({ rules: [rule("阿Q在城里做了一回大官")] }), [chapter]);
    expect(result).toMatchObject({ ok: true, rules: [] });
    if (!result.ok) return;
    expect(result.rejected).toEqual([{ category: "voice", text: "叙述者先自嘲再入正题，制造反讽距离", evidence: "阿Q在城里做了一回大官", reason: "证据未在本批原文中逐字找到" }]);
    expect(result.issues[0]).toContain("证据未在本批原文中逐字找到");
  });

  it("模型改了引号与繁简的证据被收录，存储的证据是原文原字", () => {
    const result = parseStyleDistillationBatchOutput(JSON.stringify({ rules: [rule("这足见我不是一个「立言」的人")] }), [chapter]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rules[0]?.evidence).toBe("第1章原文：「這足見我不是一個〈立言〉的人」");
    expect(result.rejected).toEqual([]);
  });
});

describe("D3 证据丢弃的关注判定", () => {
  it("全部丢弃判失败、过半丢弃判提醒、少量丢弃照常", () => {
    expect(assessStyleBatchEvidence(0, 10)).toMatchObject({ level: "failed", explanation: { what: expect.stringContaining("10 条模型规则因证据未在原文找到被丢弃") } });
    expect(assessStyleBatchEvidence(2, 5)).toMatchObject({ level: "warning", explanation: { what: expect.stringContaining("仅收录 2 条") } });
    expect(assessStyleBatchEvidence(5, 2)).toEqual({ level: "ok" });
    expect(assessStyleBatchEvidence(3, 0)).toEqual({ level: "ok" });
    // 模型本就没给规则：不算丢弃
    expect(assessStyleBatchEvidence(0, 0)).toEqual({ level: "ok" });
  });
});
