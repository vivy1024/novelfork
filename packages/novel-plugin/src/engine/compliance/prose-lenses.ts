/**
 * 零 Token 确定性正文透镜（Prose Lenses）
 *
 * 1. `scanMetaLeaks`：扫描正文段落中的写作工程元信息穿帮词（如「上一章」「本章」「伏笔」「细纲」「爽点」「读者」等）
 *    以及台词引号外的裸章节指代（如「第三章」「第12章」），自动跳过首行章节标题与台词引号内合理语境。
 * 2. `analyzeWordFrequency`：零外部依赖统计本章网文高频疲劳词（动作/神态/转折套话）与中文高频双字/三字/四字实词，
 *    供编辑器码字条实时展开词频胶囊并一键定位到正文。
 */

export interface MetaLeakHit {
  /** 命中的穿帮词原文 */
  readonly term: string;
  /** 所在段落序号（1-based，仅统计非空正文段） */
  readonly paragraphIndex: number;
  /** 包含命中词的原句或上下文摘录（用于编辑器查找定位） */
  readonly quote: string;
  /** 是否属于需要人工复核的轻度疑似项（例如章节号引用） */
  readonly reviewOnly?: boolean;
  /** 结构化三要素说明（发生了什么 / 为什么要看 / 建议怎么做） */
  readonly explanation: {
    readonly whatHappened: string;
    readonly whyItMatters: string;
    readonly suggestedAction: string;
  };
}

export interface WordFrequencyItem {
  readonly term: string;
  readonly count: number;
  readonly category: "fatigue" | "ngram";
  /** 首次命中所在上下文摘录，供点击胶囊直接定位 */
  readonly sampleQuote: string;
}

export interface AnalyzeWordFrequencyOptions {
  /** 最低出现次数阈值（默认 3） */
  readonly minCount?: number;
  /** 返回最大条数（默认 12） */
  readonly limit?: number;
}

const META_ENGINEERING_TERMS: readonly {
  readonly term: string;
  readonly suggestion: string;
}[] = [
  { term: "上一章", suggestion: "改为角色可感知的具体时间或事件锚点（如「昨夜城门一役后」「半个时辰前」）。" },
  { term: "上章", suggestion: "改为角色视角内的具体时间或前情事件，去掉章节元叙事词。" },
  { term: "前一章", suggestion: "改为故事内部的时间推移或事件指代。" },
  { term: "下一章", suggestion: "删去章节预告口吻，改用悬念动作或未解危机自然收尾。" },
  { term: "本章", suggestion: "删去写作工程视角词，直接落回当前场景的人物行动。" },
  { term: "这一章", suggestion: "确认是否为「印章/勋章」语义；若指章节，请改为故事内时间锚点。" },
  { term: "前文", suggestion: "改为角色回忆或具体事件指代，避免论文/大纲式「前文」腔调。" },
  { term: "后文", suggestion: "删去全知剧透口吻，让事件按叙事自然展开。" },
  { term: "伏笔", suggestion: "正文中不宜直接点破「伏笔」，请改写为具体器物、异常细节或人物暗桩。" },
  { term: "细纲", suggestion: "疑似大纲/提示词残留混入正文，请删除并改写为叙事描写。" },
  { term: "大纲", suggestion: "疑似写作设定词混入正文（现代职场戏讨论方案大纲除外），请核对并清理。" },
  { term: "爽点", suggestion: "疑似策划/审稿元话语泄漏进正文，请删除并转化为人物具体反应。" },
  { term: "读者", suggestion: "疑似打破第四面墙或 AI 总结腔残留（书中人物看书场景除外），请核对。" },
  { term: "卡文", suggestion: "疑似作者吐槽或写作元词残留，请检查是否属于书中写手角色设定。" },
  { term: "水字数", suggestion: "疑似写作元词泄漏进正文，请立即删除。" },
];

const BARE_CHAPTER_REF_RE = /第[一二三四五六七八九十百千万两零\d]{1,6}章/gu;

/** 判断首段是否为章节标题行（Markdown `#` 标题，或单行以 `第X章` 开头的短标题） */
function isChapterHeadingLine(line: string, isFirstNonEmptyLine: boolean): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/^#{1,6}\s+/u.test(trimmed)) return true;
  if (isFirstNonEmptyLine && trimmed.length <= 45 && /^第\s*[一二三四五六七八九十百千万两零\d]+\s*[章节回卷]/u.test(trimmed)) {
    return true;
  }
  return false;
}

/** 将中文/英文引号内的对白内容替换成等长占位符，保持原字符串下标不变 */
function maskQuotedDialogue(paragraph: string): string {
  return paragraph
    .replace(/“[^”\n]*”/gu, (m) => "□".repeat(m.length))
    .replace(/「[^」\n]*」/gu, (m) => "□".repeat(m.length))
    .replace(/『[^』\n]*』/gu, (m) => "□".repeat(m.length))
    .replace(/"[^"\n]*"/gu, (m) => "□".repeat(m.length));
}

function extractContextQuote(paragraph: string, index: number, termLength: number): string {
  // 优先截取所在分句/整句，保证编辑器查找能精准唯一命中
  const sentenceBreak = /[。！？!?\n]/u;
  let start = index;
  while (start > 0 && !sentenceBreak.test(paragraph[start - 1]!)) {
    start -= 1;
  }
  let end = index + termLength;
  while (end < paragraph.length && !sentenceBreak.test(paragraph[end]!)) {
    end += 1;
  }
  const sentence = paragraph.slice(start, end).trim();
  if (sentence.length >= termLength && sentence.length <= 48) {
    return sentence;
  }
  const winStart = Math.max(0, index - 12);
  const winEnd = Math.min(paragraph.length, index + termLength + 16);
  return paragraph.slice(winStart, winEnd).trim();
}

/**
 * 扫描正文中的工程元信息泄漏词（零 Token，纯确定性）。
 */
export function scanMetaLeaks(content: string): MetaLeakHit[] {
  if (!content || !content.trim()) return [];
  const rawLines = content.replace(/\r\n/g, "\n").split("\n");
  const hits: MetaLeakHit[] = [];

  let seenFirstNonEmpty = false;
  let paragraphIndex = 0;

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    const isFirst = !seenFirstNonEmpty;
    seenFirstNonEmpty = true;

    if (isChapterHeadingLine(trimmed, isFirst)) {
      continue;
    }

    paragraphIndex += 1;
    const masked = maskQuotedDialogue(trimmed);

    for (const item of META_ENGINEERING_TERMS) {
      // 在遮罩对白后的叙述文本中检索，避免角色台词里说「读者」「大纲」误伤；
      // 但像「上一章」「下一章」「本章」「水字数」「细纲」「爽点」即便在引号里也极可能是 AI 穿帮，因此在原文兜底检查。
      const strictEvenInDialogue =
        item.term === "上一章" ||
        item.term === "上章" ||
        item.term === "前一章" ||
        item.term === "下一章" ||
        item.term === "本章" ||
        item.term === "细纲" ||
        item.term === "爽点" ||
        item.term === "水字数";
      const targetText = strictEvenInDialogue ? trimmed : masked;
      const idx = targetText.indexOf(item.term);
      if (idx === -1) continue;

      // 排除「这一章」实为「这一枚印章/这一章程」中的「章程」误判
      if (item.term === "这一章" && trimmed.slice(idx, idx + 4) === "这一章程") {
        continue;
      }

      const quote = extractContextQuote(trimmed, idx, item.term.length);
      hits.push({
        term: item.term,
        paragraphIndex,
        quote,
        explanation: {
          whatHappened: `第 ${paragraphIndex} 段出现写作工程穿帮词「${item.term}」（原句：「${quote}」）。`,
          whyItMatters: "大纲/提示词或章节元叙事词直接漏进正文，会瞬间打破读者沉浸感并暴露 AI 生成痕迹。",
          suggestedAction: item.suggestion,
        },
      });
    }

    for (const match of masked.matchAll(BARE_CHAPTER_REF_RE)) {
      const term = match[0]!;
      const idx = match.index ?? 0;
      // 若已被「上一章/下一章」之类覆盖则跳过，但正则本身只匹配「第X章」
      // 排除功法/法典「第一重」「第三层」（正则只匹配「章」）；排除书名号《...》内部的法典条款如《刑律第三章》
      const before = trimmed.slice(Math.max(0, idx - 10), idx);
      const after = trimmed.slice(idx + term.length, Math.min(trimmed.length, idx + term.length + 10));
      if (before.includes("《") && !before.includes("》") && after.includes("》")) {
        continue;
      }
      const quote = extractContextQuote(trimmed, idx, term.length);
      hits.push({
        term,
        paragraphIndex,
        quote,
        reviewOnly: true,
        explanation: {
          whatHappened: `第 ${paragraphIndex} 段叙述出现裸章节指代「${term}」（原句：「${quote}」）。`,
          whyItMatters: "对白之外直接提「第几章」通常是总结腔或大纲回指残留，容易造成出戏。",
          suggestedAction: "若非书中功法典籍篇目，请改为故事内具体时间或事件锚点。",
        },
      });
    }
  }

  return hits;
}

/** 网文高频疲劳词与 AI 惯用神态/转折套话词典 */
export const FATIGUE_PHRASES: readonly string[] = [
  "深吸一口气",
  "倒吸一口凉气",
  "嘴角微微上扬",
  "嘴角勾起",
  "微微一笑",
  "瞳孔微缩",
  "瞳孔骤缩",
  "眼中闪过",
  "眸中闪过",
  "心中暗道",
  "心中一凛",
  "就在这时",
  "与此同时",
  "下一秒",
  "下一刻",
  "刹那间",
  "不由自主",
  "下意识地",
  "下意识",
  "毫不犹豫",
  "不可思议",
  "难以置信",
  "嘴角",
  "眼神",
  "目光",
  "眉头",
  "微微",
  "缓缓",
  "淡淡",
  "冷冷",
  "不禁",
  "竟然",
  "居然",
  "仿佛",
  "宛如",
  "顿时",
  "猛地",
  "骤然",
];

/** 常见中文虚词、代词、助词与无实义高频连接碎片，避免污染高频实词榜单 */
const NGRAM_STOPWORDS: ReadonlySet<string> = new Set([
  "的", "了", "着", "过", "地", "得", "在", "是", "有", "和", "与", "及", "或", "但", "而", "却",
  "一个", "一种", "一些", "一下", "一点", "一样", "一直", "一起", "一切", "一般", "一边", "一面",
  "这个", "那个", "这些", "那些", "这里", "那里", "这么", "那么", "这样", "那样", "这种", "那种",
  "什么", "怎么", "怎样", "如何", "为什么", "因为", "所以", "如果", "虽然", "但是", "可是", "不过",
  "而且", "并且", "或者", "还是", "只是", "就是", "不是", "已经", "正在", "开始", "继续", "可以",
  "能够", "应该", "必须", "需要", "可能", "不会", "不能", "不要", "没有", "不知", "知道", "觉得",
  "看到", "看见", "听到", "听见", "看着", "听着", "说着", "说道", "问道", "答道", "开口", "声音",
  "自己", "他们", "她们", "我们", "你们", "它们", "大家", "别人", "对方", "两人", "众人", "有人",
  "现在", "刚才", "之前", "之后", "以后", "时候", "时间", "地方", "东西", "事情", "问题", "情况",
  "出来", "进去", "过来", "过去", "起来", "下来", "上去", "下去", "回来", "回去", "之上", "之下",
  "之中", "之间", "之内", "之外", "面前", "身后", "身边", "身上", "手里", "手中", "心里", "心中",
]);

const BOUNDARY_CHARS_FOR_NGRAM = new Set([
  "的", "了", "着", "过", "地", "得", "是", "在", "有", "把", "被", "让", "给", "向", "往", "从",
  "和", "与", "跟", "同", "但", "却", "而", "又", "也", "都", "就", "才", "还", "只", "很", "太",
  "更", "最", "不", "没", "别", "莫", "我", "你", "他", "她", "它", "这", "那", "哪", "谁", "啥",
  "吗", "呢", "吧", "啊", "呀", "哦", "嗯", "哈",
]);

function countSubstringOccurrences(text: string, sub: string): { count: number; firstIndex: number } {
  let count = 0;
  let firstIndex = -1;
  let pos = 0;
  while (pos <= text.length - sub.length) {
    const idx = text.indexOf(sub, pos);
    if (idx === -1) break;
    if (firstIndex === -1) firstIndex = idx;
    count += 1;
    pos = idx + sub.length;
  }
  return { count, firstIndex };
}

function isValidCjkNgram(gram: string): boolean {
  if (NGRAM_STOPWORDS.has(gram)) return false;
  const first = gram[0]!;
  const last = gram[gram.length - 1]!;
  // 首尾含单字虚词/代词/语气词的切片（如「他的」「在了」「看着他」）一律淘汰
  if (BOUNDARY_CHARS_FOR_NGRAM.has(first) || BOUNDARY_CHARS_FOR_NGRAM.has(last)) {
    return false;
  }
  // 内部含有强粘连虚词「的/了/着/地/得」的二三字碎片淘汰
  if (gram.length <= 3 && /[的了着地得吗呢吧啊呀]/u.test(gram)) {
    return false;
  }
  // 叠字虚化如「哈哈哈」「啊啊」淘汰
  if (/^(.)\1+$/u.test(gram)) {
    return false;
  }
  return true;
}

/**
 * 统计正文中重复出现的疲劳词与高频实词（零外部依赖，0 Token）。
 */
export function analyzeWordFrequency(
  content: string,
  options: AnalyzeWordFrequencyOptions = {},
): WordFrequencyItem[] {
  const minCount = options.minCount ?? 3;
  const limit = options.limit ?? 12;
  if (!content || !content.trim()) return [];

  // 去掉首行 Markdown 章节标题，只分析正文
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const bodyLines: string[] = [];
  let seenFirst = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const isFirst = !seenFirst;
    seenFirst = true;
    if (isChapterHeadingLine(trimmed, isFirst)) continue;
    bodyLines.push(trimmed);
  }
  const body = bodyLines.join("\n");
  if (!body) return [];

  const fatigueResults: WordFrequencyItem[] = [];
  const coveredFatiguePhrases: string[] = [];

  // 先按词长降序匹配疲劳词（避免「深吸一口气」被拆成短词重复计入同位置）
  const sortedFatigue = [...FATIGUE_PHRASES].sort((a, b) => b.length - a.length);
  for (const phrase of sortedFatigue) {
    const { count, firstIndex } = countSubstringOccurrences(body, phrase);
    if (count < minCount || firstIndex < 0) continue;
    // 若某个短疲劳词（如「微微」）几乎全部由已入选长词（如「微微一笑」）贡献，扣除重叠后再看是否达标
    let overlap = 0;
    for (const longer of coveredFatiguePhrases) {
      if (longer.includes(phrase)) {
        overlap += countSubstringOccurrences(body, longer).count;
      }
    }
    const effectiveCount = count - overlap;
    if (effectiveCount < minCount) continue;
    coveredFatiguePhrases.push(phrase);
    fatigueResults.push({
      term: phrase,
      count: effectiveCount,
      category: "fatigue",
      sampleQuote: extractContextQuote(body, firstIndex, phrase.length),
    });
  }

  // 提取连续汉字分句中的 2~4 字高频实词
  const cjkChunks = body.match(/[\u4e00-\u9fff]{2,}/gu) ?? [];
  const gramStats = new Map<string, { count: number; sampleChunk: string }>();

  for (const chunk of cjkChunks) {
    const maxN = Math.min(4, chunk.length);
    for (let n = 2; n <= maxN; n += 1) {
      for (let i = 0; i <= chunk.length - n; i += 1) {
        const gram = chunk.slice(i, i + n);
        if (!isValidCjkNgram(gram)) continue;
        const prev = gramStats.get(gram);
        if (prev) {
          prev.count += 1;
        } else {
          gramStats.set(gram, { count: 1, sampleChunk: chunk });
        }
      }
    }
  }

  const fatigueSet = new Set(fatigueResults.map((item) => item.term));
  // 过滤低于阈值的 n-gram，并做子串去重（若子串频次不超过父串频次的 1.25 倍，则只保留更完整的长词，避免「青铜古剑」「青铜」「古剑」刷屏）
  const rawNgrams = [...gramStats.entries()]
    .filter(([term, stat]) => stat.count >= minCount && !fatigueSet.has(term))
    .sort((a, b) => (b[0].length - a[0].length) || (b[1].count - a[1].count));

  const keptNgrams: Array<{ term: string; count: number }> = [];
  for (const [term, stat] of rawNgrams) {
    const shadowedByLonger = keptNgrams.some(
      (longer) => longer.term.length > term.length && longer.term.includes(term) && stat.count <= Math.ceil(longer.count * 1.25),
    );
    if (shadowedByLonger) continue;
    // 同样跳过被已入选长疲劳词完全包裹的切片
    const shadowedByFatigue = coveredFatiguePhrases.some(
      (longer) => longer.length > term.length && longer.includes(term),
    );
    if (shadowedByFatigue) continue;
    keptNgrams.push({ term, count: stat.count });
  }

  const ngramResults: WordFrequencyItem[] = keptNgrams
    .sort((a, b) => b.count - a.count || b.term.length - a.term.length)
    .map((item) => {
      const idx = body.indexOf(item.term);
      return {
        term: item.term,
        count: item.count,
        category: "ngram" as const,
        sampleQuote: idx >= 0 ? extractContextQuote(body, idx, item.term.length) : item.term,
      };
    });

  // 合并排序：疲劳词优先排在前面（按次数降序），随后是高频实词（按次数降序），总数截断到 limit
  fatigueResults.sort((a, b) => b.count - a.count || b.term.length - a.term.length);
  return [...fatigueResults, ...ngramResults].slice(0, limit);
}
