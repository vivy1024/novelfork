/**
 * 文风金库（T2.7）的逐句比对与段落对齐纯函数。
 *
 * 无 Node 依赖：服务端（文风金库面板的 GET /style/vault）与写作台编辑器的实时占比徽标
 * 引用同一份实现，两处数字按同一规则算出，不会各说各话。
 */

function normalize(text: string): string {
  return text.replace(/\r\n?/gu, "\n").replace(/[ \t　]+/gu, "").trim();
}

/** 按中文句末标点与换行切句；标点留在句尾，空句丢弃。 */
export function splitSentences(text: string): string[] {
  return normalize(text)
    .split(/(?<=[。！？!?…])|\n+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

export interface AuthorShare {
  /** 当前正文中原样来自 AI 原稿的字数。 */
  readonly aiChars: number;
  /** 当前正文中作者改写或新写的字数。 */
  readonly authorChars: number;
  readonly totalChars: number;
  /** 作者占比 0–1；正文为空时为 0。 */
  readonly authorRatio: number;
}

/**
 * 逐句比对：原稿里的句子按出现次数计入多重集合，当前正文的句子能在集合里匹配到就算 AI（匹配一次消耗一次），
 * 否则算作者。删掉的 AI 句子不计入当前正文，自然不影响占比。
 */
export function computeAuthorShare(aiText: string, currentText: string): AuthorShare {
  const pool = new Map<string, number>();
  for (const sentence of splitSentences(aiText)) pool.set(sentence, (pool.get(sentence) ?? 0) + 1);
  let aiChars = 0;
  let authorChars = 0;
  for (const sentence of splitSentences(currentText)) {
    const left = pool.get(sentence) ?? 0;
    if (left > 0) {
      pool.set(sentence, left - 1);
      aiChars += sentence.length;
    } else {
      authorChars += sentence.length;
    }
  }
  const totalChars = aiChars + authorChars;
  return { aiChars, authorChars, totalChars, authorRatio: totalChars > 0 ? authorChars / totalChars : 0 };
}

function bigrams(text: string): Set<string> {
  const compact = normalize(text).replace(/\s+/gu, "");
  const grams = new Set<string>();
  for (let i = 0; i < compact.length - 1; i += 1) grams.add(compact.slice(i, i + 2));
  return grams;
}

function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared += 1;
  return shared / (a.size + b.size - shared);
}

export interface RevisionPair {
  readonly aiText: string;
  readonly authorText: string;
  /** 两段的字符二元组相似度 0–1：太低是另起炉灶，太高是没怎么改。 */
  readonly similarity: number;
}

// 网文段落普遍很短（一两句对白就是一段），下限不能按出版物的段落长度定。
const MIN_PARAGRAPH_CHARS = 12;
const MIN_SIMILARITY = 0.25;
const MAX_SIMILARITY = 0.9;

/**
 * 按段对齐改稿：每个当前段落找最相似的原稿段落，相似度落在「改过但还认得出」区间的记为一对。
 * 同一原稿段只配一次；结果按改动幅度从大到小排序。
 */
export function extractRevisionPairs(aiText: string, currentText: string, limit = 8): RevisionPair[] {
  const paragraphs = (text: string) => normalize(text).split(/\n+/u).map((item) => item.trim()).filter((item) => item.length >= MIN_PARAGRAPH_CHARS);
  const aiParagraphs = paragraphs(aiText).map((text) => ({ text, grams: bigrams(text) }));
  const used = new Set<number>();
  const pairs: RevisionPair[] = [];
  for (const current of paragraphs(currentText)) {
    const grams = bigrams(current);
    let best = -1;
    let bestScore = 0;
    aiParagraphs.forEach((candidate, index) => {
      if (used.has(index)) return;
      const score = similarity(grams, candidate.grams);
      if (score > bestScore) { bestScore = score; best = index; }
    });
    if (best < 0 || bestScore < MIN_SIMILARITY || bestScore >= MAX_SIMILARITY) continue;
    used.add(best);
    pairs.push({ aiText: aiParagraphs[best]!.text, authorText: current, similarity: Math.round(bestScore * 1000) / 1000 });
  }
  return pairs.sort((a, b) => a.similarity - b.similarity).slice(0, limit);
}
