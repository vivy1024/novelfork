import type { RuleHit, RuleSeverity, RuleSpan } from "../types.js";
import { AhoCorasickMatcher } from "./ac-matcher.js";
import { loadFilterDictionary } from "./dictionaries.js";
import { stdDev, tokenizeChineseText, type TokenizedChineseText } from "./tokenizer.js";

export interface RuleContext {
  text: string;
  tokenized?: TokenizedChineseText;
  priorHits: RuleHit[];
}

export interface FilterRule {
  id: string;
  name: string;
  weight: number;
  run(text: string, ctx: RuleContext): RuleHit | null;
}

const suggestions: Record<string, string> = {
  r01: "删掉总结式官腔，改为角色动作或场景细节推进。",
  r02: "打散首先/其次/最后结构，用动作顺序自然承接。",
  r03: "删除典型 AI 套话，保留具体信息。",
  r04: "把感到/觉得/认为替换成表情、动作、触觉等具体描写。",
  r05: "补入口头禅、习惯动作、偏执用词等角色癖好。",
  r06: "拉开长短句差异，让节奏有顿挫。",
  r07: "调整段落长短，用短段制造冲击、长段承载沉浸。",
  r08: "减少抽象术语，改为人物可感知的事实。",
  r09: "删减连续形容词，只留一个最有画面的词。",
  r10: "把很/非常/十分后面的情绪改成具体行为。",
  r11: "让对话更口语，加入停顿、反问、语气词或省略。",
  r12: "综合重写：减少模板、增加细节、打破整齐结构。",
};

function makeHit(ruleId: string, name: string, severity: RuleSeverity, spans: RuleSpan[], weightContribution: number): RuleHit | null {
  if (spans.length === 0) return null;
  return { ruleId, name, severity, spans, suggestion: suggestions[ruleId], weightContribution };
}

function keywordSpans(text: string, keywords: string[]): RuleSpan[] {
  const matcher = new AhoCorasickMatcher(keywords);
  return matcher.search(text).map((match) => ({ start: match.start, end: match.end, matched: match.keyword }));
}

function tokenized(ctx: RuleContext): TokenizedChineseText {
  return ctx.tokenized ?? tokenizeChineseText(ctx.text);
}

function densityHit(id: string, name: string, severity: RuleSeverity, text: string, keywords: string[], threshold: number, weight: number): RuleHit | null {
  const spans = keywordSpans(text, keywords);
  const density = spans.length / Math.max(1, text.length / 1000);
  return density >= threshold ? makeHit(id, name, severity, spans, spans.length * weight) : null;
}

const r01: FilterRule = {
  id: "r01",
  name: "过度正式 / 官腔",
  weight: 1,
  run(text) {
    return densityHit("r01", this.name, "medium", text, loadFilterDictionary("officialese"), 0.8, this.weight);
  },
};

const r02: FilterRule = {
  id: "r02",
  name: "固定句式模板",
  weight: 1.2,
  run(text) {
    const patterns = [
      /首先[\s\S]{0,80}其次[\s\S]{0,80}最后/gu,
      /第一[，,、\s\S]{0,80}第二[，,、\s\S]{0,80}第三/gu,
      /一方面[\s\S]{0,80}另一方面/gu,
    ];
    const spans = patterns.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => ({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length, matched: match[0] })));
    return makeHit("r02", this.name, "high", spans, spans.length * this.weight);
  },
};

const r03: FilterRule = {
  id: "r03",
  name: "典型 AI 词汇",
  weight: 1.5,
  run(text) {
    return densityHit("r03", this.name, "high", text, loadFilterDictionary("ai-vocabulary"), 0.8, this.weight);
  },
};

const r04: FilterRule = {
  id: "r04",
  name: "缺乏情感动词具体化",
  weight: 0.8,
  run(text) {
    const spans = keywordSpans(text, ["感到", "觉得", "认为"]);
    return spans.length >= 3 ? makeHit("r04", this.name, "medium", spans, spans.length * this.weight) : null;
  },
};

const colloquial = loadFilterDictionary("dialogue-colloquial");
const r05: FilterRule = {
  id: "r05",
  name: "缺乏口头禅 / 人称癖好",
  weight: 0.6,
  run(text, ctx) {
    if (text.length < 160) return null;
    const tokens = tokenized(ctx);
    const markerCount = colloquial.reduce((sum, marker) => sum + (text.split(marker).length - 1), 0);
    const dialogueCount = [...text.matchAll(/[“"][^”"]+[”"]/gu)].length;
    const hasVoicePunctuation = /[：？！]/u.test(text);
    if (markerCount === 0 && dialogueCount === 0 && !hasVoicePunctuation && tokens.sentences.length >= 20) {
      return makeHit("r05", this.name, "low", [{ start: 0, end: Math.min(20, text.length), matched: text.slice(0, Math.min(20, text.length)) }], this.weight);
    }
    return null;
  },
};

const r06: FilterRule = {
  id: "r06",
  name: "句长方差过低",
  weight: 0.7,
  run(text, ctx) {
    if (text.length < 200) return null;
    const lengths = tokenized(ctx).sentences.map((sentence) => sentence.text.length).filter((length) => length > 1);
    if (lengths.length < 8) return null;
    const mean = lengths.reduce((sum, value) => sum + value, 0) / lengths.length;
    const cv = stdDev(lengths) / Math.max(1, mean);
    return cv < 0.18 ? makeHit("r06", this.name, "medium", [{ start: 0, end: Math.min(30, text.length), matched: `句长变异系数 ${cv.toFixed(3)}` }], this.weight * 2) : null;
  },
};

const r07: FilterRule = {
  id: "r07",
  name: "段落长度过于均匀",
  weight: 0.6,
  run(text, ctx) {
    if (text.length < 20) return null;
    const lengths = tokenized(ctx).paragraphs.map((paragraph) => paragraph.text.length).filter((length) => length > 1);
    if (lengths.length < 3) return null;
    const mean = lengths.reduce((sum, value) => sum + value, 0) / lengths.length;
    const cv = stdDev(lengths) / Math.max(1, mean);
    return cv < 0.18 ? makeHit("r07", this.name, "medium", [{ start: 0, end: Math.min(30, text.length), matched: `段落变异系数 ${cv.toFixed(3)}` }], this.weight * 2) : null;
  },
};

const r08: FilterRule = {
  id: "r08",
  name: "行话 / 术语密度过高",
  weight: 0.5,
  run(text) {
    return densityHit("r08", this.name, "medium", text, loadFilterDictionary("jargon"), 20, this.weight);
  },
};

const r09: FilterRule = {
  id: "r09",
  name: "形容词堆叠",
  weight: 0.9,
  run(text) {
    const adjectives = loadFilterDictionary("adjectives");
    const pattern = new RegExp(`(?:${adjectives.join("|")}){2,}`, "gu");
    const spans = [...text.matchAll(pattern)].map((match) => ({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length, matched: match[0] }));
    return makeHit("r09", this.name, "medium", spans, spans.length * this.weight);
  },
};

const r10: FilterRule = {
  id: "r10",
  name: "空话密度",
  weight: 0.8,
  run(text) {
    const spans = keywordSpans(text, loadFilterDictionary("empty-words"));
    return makeHit("r10", this.name, "medium", spans, spans.length * this.weight);
  },
};

const r11: FilterRule = {
  id: "r11",
  name: "对话书面语",
  weight: 1.1,
  run(text) {
    const dialogueMatches = [...text.matchAll(/[“"]([^”"]+)[”"]/gu)];
    const formal = ["我认为", "综上所述", "从某种意义上", "应当", "进一步讨论", "路径依赖"];
    const spans = dialogueMatches
      .filter((match) => formal.some((word) => match[1]?.includes(word)) && !colloquial.some((marker) => match[1]?.includes(marker)))
      .map((match) => ({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length, matched: match[0] }));
    return makeHit("r11", this.name, "high", spans, spans.length * this.weight);
  },
};

export function createCompositeHit(priorHits: RuleHit[]): RuleHit | null {
  if (priorHits.length < 3) return null;
  const weight = priorHits.reduce((sum, hit) => sum + hit.weightContribution, 0);
  return makeHit("r12", "伪人感综合", weight > 10 ? "high" : "medium", [{ start: 0, end: 0, matched: `${priorHits.length} 类 AI 味信号叠加` }], Math.min(20, weight * 0.8));
}

export const FILTER_RULES: FilterRule[] = [r01, r02, r03, r04, r05, r06, r07, r08, r09, r10, r11];
