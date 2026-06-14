/**
 * 动态全局词频分析（P4-1 / A4）
 *
 * 统计最近 K 章正文里的高频实词（去停用词），找出"每章都在重复用"的异常高频词。
 * 与固定疲劳词表（ai-tells / genre fatigueWords）互补：那是预设清单，这是基于
 * 实际正文的动态发现。纯函数，无 LLM，中文用简单 bigram/字面切分。
 */

export interface WordFrequencyResult {
  readonly word: string;
  /** 总出现次数 */
  readonly count: number;
  /** 出现在多少个不同章节 */
  readonly chapterSpread: number;
}

// 中文常见停用词 + 功能词（不计入实词频率）
const ZH_STOPWORDS = new Set([
  "的", "了", "是", "在", "我", "他", "她", "你", "它", "们", "这", "那", "和", "与", "也",
  "都", "就", "而", "又", "却", "但", "并", "或", "把", "被", "让", "给", "对", "向", "从",
  "到", "于", "之", "其", "为", "以", "及", "且", "等", "着", "过", "得", "地", "上", "下",
  "中", "里", "外", "前", "后", "个", "些", "一", "不", "没", "有", "无", "要", "会", "能",
  "可", "说", "道", "来", "去", "看", "一个", "自己", "什么", "这样", "那样", "因为", "所以",
  "如果", "虽然", "已经", "还是", "只是", "这个", "那个", "起来", "出来", "过来", "时候",
]);

function isStopword(word: string): boolean {
  return ZH_STOPWORDS.has(word);
}

/**
 * 从中文文本提取候选实词（2-4 字的连续中文片段的 bigram/trigram）。
 * 简单切分：不依赖重型分词库，用滑窗 bigram + 过滤停用词。
 */
function extractZhBigrams(text: string): string[] {
  const result: string[] = [];
  // 仅保留中文字符序列
  const runs = text.match(/[\u4e00-\u9fff]+/g) ?? [];
  for (const run of runs) {
    // bigram 滑窗
    for (let i = 0; i < run.length - 1; i++) {
      const bigram = run.slice(i, i + 2);
      if (!isStopword(bigram) && !isStopword(bigram[0]!) && !isStopword(bigram[1]!)) {
        result.push(bigram);
      }
    }
  }
  return result;
}

/**
 * 分析最近 K 章的高频实词。
 * @param chapters 最近章节正文数组（按章节顺序）
 * @param options.minChapterSpread 至少出现在多少章才算"反复用"（默认 3）
 * @param options.minCount 至少总出现次数（默认 8）
 * @param options.topN 返回前 N 个（默认 15）
 */
export function analyzeWordFrequency(
  chapters: ReadonlyArray<string>,
  options?: { minChapterSpread?: number; minCount?: number; topN?: number },
): WordFrequencyResult[] {
  const minChapterSpread = options?.minChapterSpread ?? 3;
  const minCount = options?.minCount ?? 8;
  const topN = options?.topN ?? 15;

  const totalCount = new Map<string, number>();
  const chapterSets = new Map<string, Set<number>>();

  chapters.forEach((text, chapterIdx) => {
    const bigrams = extractZhBigrams(text);
    const seenThisChapter = new Set<string>();
    for (const w of bigrams) {
      totalCount.set(w, (totalCount.get(w) ?? 0) + 1);
      if (!seenThisChapter.has(w)) {
        seenThisChapter.add(w);
        if (!chapterSets.has(w)) chapterSets.set(w, new Set());
        chapterSets.get(w)!.add(chapterIdx);
      }
    }
  });

  const results: WordFrequencyResult[] = [];
  for (const [word, count] of totalCount) {
    const chapterSpread = chapterSets.get(word)?.size ?? 0;
    if (count >= minCount && chapterSpread >= minChapterSpread) {
      results.push({ word, count, chapterSpread });
    }
  }

  return results
    .sort((a, b) => b.chapterSpread - a.chapterSpread || b.count - a.count || a.word.localeCompare(b.word))
    .slice(0, topN);
}

/** 把高频词结果渲染成给 Writer/Auditor 的提示文本（无结果返回空串） */
export function renderWordFrequencyHint(results: ReadonlyArray<WordFrequencyResult>, language: "zh" | "en" = "zh"): string {
  if (results.length === 0) return "";
  const words = results.map((r) => `${r.word}(${r.count}次/${r.chapterSpread}章)`).join("、");
  return language === "en"
    ? `\n## Overused Words (recent chapters)\nAvoid repeating these high-frequency words; vary expression: ${words}`
    : `\n## 近章高频重复词\n以下词在最近章节反复出现，本章请尽量换用表达、避免重复：${words}`;
}
