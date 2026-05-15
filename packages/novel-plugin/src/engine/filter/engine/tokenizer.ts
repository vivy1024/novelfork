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
