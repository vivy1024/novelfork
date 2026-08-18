export interface TextSegment {
  text: string;
  start: number;
  end: number;
}

export interface TokenizedChineseText {
  text: string;
  charCount: number;
  paragraphs: TextSegment[];
  sentences: TextSegment[];
}

const sentenceEndPattern = /[。！？…]+/gu;

function trimSegment(text: string, start: number, end: number): TextSegment | null {
  let nextStart = start;
  let nextEnd = end;
  while (nextStart < nextEnd && /\s/u.test(text[nextStart]!)) nextStart += 1;
  while (nextEnd > nextStart && /\s/u.test(text[nextEnd - 1]!)) nextEnd -= 1;
  if (nextStart >= nextEnd) return null;
  return { text: text.slice(nextStart, nextEnd), start: nextStart, end: nextEnd };
}

function splitParagraphs(text: string): TextSegment[] {
  const paragraphs: TextSegment[] = [];
  const pattern = /\n\s*\n/gu;
  let lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    const segment = trimSegment(text, lastIndex, index);
    if (segment) paragraphs.push(segment);
    lastIndex = index + match[0].length;
  }
  const finalSegment = trimSegment(text, lastIndex, text.length);
  if (finalSegment) paragraphs.push(finalSegment);
  return paragraphs;
}

function splitSentences(text: string): TextSegment[] {
  const sentences: TextSegment[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(sentenceEndPattern)) {
    const index = match.index ?? 0;
    const end = index + match[0].length;
    const segment = trimSegment(text, lastIndex, end);
    if (segment) sentences.push(segment);
    lastIndex = end;
  }
  const finalSegment = trimSegment(text, lastIndex, text.length);
  if (finalSegment) sentences.push(finalSegment);
  return sentences;
}

export function tokenizeChineseText(text: string): TokenizedChineseText {
  return {
    text,
    charCount: text.length,
    paragraphs: splitParagraphs(text),
    sentences: splitSentences(text),
  };
}

export function variance(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
}

export function stdDev(values: number[]): number {
  return Math.sqrt(variance(values));
}

/**
 * 爆发度（Burstiness）：`(σ - μ) / (σ + μ)`。
 *
 * 这是 AI 文本检测的标准统计指标之一。取值范围 (-1, 1)：
 * - 趋近 -1：分布高度均质（每句长度都差不多），是 AI 生成的典型特征；
 * - 大于 0：长短错落明显，人类写作的常见形态。
 *
 * 相比变异系数（σ/μ），它把「均质」映射到负值区间，阈值判断更直观，也不会
 * 因为均值很小而失真。样本不足 2 个时返回 0（无法判断，不作结论）。
 */
export function burstiness(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const sigma = stdDev(values);
  const denominator = sigma + mean;
  return denominator === 0 ? 0 : (sigma - mean) / denominator;
}

/**
 * 词汇丰富度（Type-Token Ratio）。
 *
 * 中文没有天然词边界，这里用相邻双字（bigram）近似「词」：AI 生成文本倾向于
 * 在固定搭配池里循环，bigram 去重率显著偏低；人类用词长尾更明显。
 *
 * 只统计中文字符，跳过标点与空白，避免标点风格影响结果。
 */
export function bigramTypeTokenRatio(text: string): number {
  const chars = [...text].filter((char) => /[\u4e00-\u9fa5]/u.test(char));
  if (chars.length < 4) return 1;
  const bigrams: string[] = [];
  for (let index = 0; index < chars.length - 1; index += 1) {
    bigrams.push(`${chars[index]}${chars[index + 1]}`);
  }
  return new Set(bigrams).size / bigrams.length;
}
