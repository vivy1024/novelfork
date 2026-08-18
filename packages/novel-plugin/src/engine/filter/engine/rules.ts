import type { RuleHit, RuleSeverity, RuleSpan } from "../types.js";
import { AhoCorasickMatcher } from "./ac-matcher.js";
import { loadFilterDictionary } from "./dictionaries.js";
import { bigramTypeTokenRatio, burstiness, stdDev, tokenizeChineseText, type TokenizedChineseText } from "./tokenizer.js";

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
  r13: "避免连续 3 句以上使用相同主语（如「他/她」）开头，改用场景、动作或环境自然切入。",
  r14: "「突然/瞬间/骤然/旋即」等高疲劳转折词全章建议不超过 2 次，避免突兀转折。",
  r15: "连续出现过多「了」字句尾，建议打散动词完成态，加入正在进行或状态描写。",
  r16: "单段超过 300 字，网文阅读容易疲劳，建议按镜头或动作自然分段。",
  r17: "词汇搭配过于集中，同一批词组反复循环。换具体名词、动作和角色专属用语打开词面。",
  r18: "转折词密度过高，读起来像论述。删掉一半，用动作顺序和场景变化承接。",
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
  name: "句长爆发度过低",
  weight: 0.7,
  run(text, ctx) {
    if (text.length < 200) return null;
    const lengths = tokenized(ctx).sentences.map((sentence) => sentence.text.length).filter((length) => length > 1);
    if (lengths.length < 8) return null;
    // 爆发度趋近 -1 表示句长高度均质，是 AI 生成的典型统计特征。
    // 阈值 -0.55 由「人类样本普遍高于 -0.5、模板化样本普遍低于 -0.6」标定。
    const value = burstiness(lengths);
    return value < -0.55
      ? makeHit("r06", this.name, "medium", [{ start: 0, end: Math.min(30, text.length), matched: `句长爆发度 ${value.toFixed(3)}（越接近 -1 越均质）` }], this.weight * 2)
      : null;
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

const r13: FilterRule = {
  id: "r13",
  name: "连续同主语开头",
  weight: 0.5,
  run(text, ctx) {
    if (text.length < 100) return null;
    const sentences = tokenized(ctx).sentences;
    if (sentences.length < 3) return null;
    const spans: RuleSpan[] = [];
    const subjects = ["他", "她", "它", "他们", "她们", "然后", "于是", "接着"];
    for (let i = 0; i <= sentences.length - 3; i++) {
      const s1 = sentences[i].text.trim();
      const s2 = sentences[i + 1].text.trim();
      const s3 = sentences[i + 2].text.trim();
      for (const subj of subjects) {
        if (s1.startsWith(subj) && s2.startsWith(subj) && s3.startsWith(subj)) {
          spans.push({
            start: sentences[i].start,
            end: sentences[i + 2].end,
            matched: `连续3句以「${subj}」开头`,
          });
          break;
        }
      }
    }
    return spans.length > 0
      ? makeHit("r13", this.name, "medium", spans, Math.min(1.5, spans.length * this.weight))
      : null;
  },
};

const r14: FilterRule = {
  id: "r14",
  name: "高疲劳突发词频超标",
  weight: 0.5,
  run(text) {
    const fatigueWords = ["突然", "瞬间", "骤然", "旋即"];
    const spans = keywordSpans(text, fatigueWords);
    // 全章 > 2次即警告
    return spans.length > 2
      ? makeHit("r14", this.name, "medium", spans, Math.min(2, (spans.length - 2) * this.weight))
      : null;
  },
};

const r15: FilterRule = {
  id: "r15",
  name: "连续完成态（了字）堆叠",
  weight: 0.4,
  run(text, ctx) {
    const sentences = tokenized(ctx).sentences;
    if (sentences.length < 6) return null;
    const spans: RuleSpan[] = [];
    let consecutiveLe = 0;
    let startIdx = 0;
    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i].text.trim();
      if (s.endsWith("了") || s.endsWith("了。")) {
        if (consecutiveLe === 0) startIdx = i;
        consecutiveLe++;
        if (consecutiveLe >= 6) {
          spans.push({
            start: sentences[startIdx].start,
            end: sentences[i].end,
            matched: `连续 ${consecutiveLe} 句以「了」结尾`,
          });
        }
      } else {
        consecutiveLe = 0;
      }
    }
    return spans.length > 0
      ? makeHit("r15", this.name, "low", spans, Math.min(1.2, spans.length * this.weight))
      : null;
  },
};

const r16: FilterRule = {
  id: "r16",
  name: "单段字数超长",
  weight: 0.2,
  run(text, ctx) {
    const paragraphs = tokenized(ctx).paragraphs;
    const longPars = paragraphs.filter((p) => p.text.length > 300);
    if (longPars.length === 0) return null;
    const spans: RuleSpan[] = longPars.map((p) => ({
      start: p.start,
      end: p.end,
      matched: `单段长达 ${p.text.length} 字（建议 ≤300 字）`,
    }));
    return makeHit("r16", this.name, "low", spans, Math.min(1, spans.length * this.weight));
  },
};

const r17: FilterRule = {
  id: "r17",
  name: "词汇丰富度过低",
  weight: 0.6,
  run(text) {
    // 样本太短时 bigram 去重率天然偏高，不足以判断，直接跳过。
    if (text.length < 400) return null;
    const ratio = bigramTypeTokenRatio(text);
    // 阈值 0.72：AI 生成长文本常落在 0.6-0.7，人类正文普遍高于 0.8。
    return ratio < 0.72
      ? makeHit("r17", this.name, "medium", [{
        start: 0,
        end: Math.min(30, text.length),
        matched: `双字搭配去重率 ${ratio.toFixed(3)}（越低越像固定词池循环）`,
      }], this.weight * 2)
      : null;
  },
};

const r18: FilterRule = {
  id: "r18",
  name: "转折词密度过高",
  weight: 0.5,
  run(text) {
    if (text.length < 300) return null;
    const spans = keywordSpans(text, ["然而", "但是", "不过", "与此同时", "另一方面", "尽管如此"]);
    // 每 3000 字允许 1 次；超额部分才算问题。
    const budget = Math.max(1, Math.ceil(text.length / 3000));
    return spans.length > budget
      ? makeHit("r18", this.name, "low", spans, Math.min(2, (spans.length - budget) * this.weight))
      : null;
  },
};

export function createCompositeHit(priorHits: RuleHit[]): RuleHit | null {
  if (priorHits.length < 3) return null;
  const weight = priorHits.reduce((sum, hit) => sum + hit.weightContribution, 0);
  return makeHit("r12", "伪人感综合", weight > 10 ? "high" : "medium", [{ start: 0, end: 0, matched: `${priorHits.length} 类 AI 味信号叠加` }], Math.min(20, weight * 0.8));
}

export const FILTER_RULES: FilterRule[] = [r01, r02, r03, r04, r05, r06, r07, r08, r09, r10, r11, r13, r14, r15, r16, r17, r18];
