/**
 * grams.ts — 经纬检索的 bigram 切分与 FTS5 查询构造。
 *
 * 背景：SQLite FTS5 默认 unicode61 tokenizer 把整段中文当作一个 token，
 * 「韩立」这类 2 字人名与多词查询全部 0 命中（实测 SQLite 3.51.2）。
 * trigram 有 3 字符下限，同样漏掉 2 字人名。
 *
 * 方案：文档侧按字滑窗切成 bigram（「太清门」→ "太清 清门"），
 * 查询侧同规则把每个查询词转成一个 phrase，词间 AND。
 * phrase 连续出现 ⟺ 原文包含该词（标点边界处存在假阳性，由 verifyMatch 兜掉）。
 *
 * 独立于 narrative-memory/fts.ts（该实现同样受中文 tokenizer 问题影响），
 * 后续可让 Narrative Memory 复用同一套 gram 化逻辑。
 */

// CJK 统一表意文字 + 扩展 A + 兼容表意文字 + 假名（日本名常见）
const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff]/u;
const ASCII_WORD_RE = /[A-Za-z0-9_]/u;

/** 单字符是否属于中文连续段（会被滑窗切 bigram） */
export function isCjkChar(ch: string): boolean {
  return CJK_RE.test(ch);
}

/**
 * 将文本转为 bigram token 串（空格分隔）。
 * - 中文连续段：长度 ≥2 时逐字滑窗 bigram；长度为 1 保留原字
 * - ASCII 词：原样小写（数字下划线并入）
 * - 其他字符（标点/空白/emoji）：作为段分隔符
 *
 * 例：'韩立在太清门修炼' → '韩立 立在 在太 太清 清门 门修 修炼'
 */
export function toGrams(text: string): string {
  const tokens: string[] = [];
  let cjkSeg = "";
  let asciiWord = "";

  const flushCjk = () => {
    if (cjkSeg.length === 0) return;
    if (cjkSeg.length === 1) {
      tokens.push(cjkSeg);
    } else {
      for (let i = 0; i + 1 < cjkSeg.length; i += 1) {
        tokens.push(cjkSeg.slice(i, i + 2));
      }
    }
    cjkSeg = "";
  };
  const flushAscii = () => {
    if (asciiWord.length > 0) {
      tokens.push(asciiWord.toLowerCase());
      asciiWord = "";
    }
  };

  for (const ch of text) {
    if (CJK_RE.test(ch)) {
      flushAscii();
      cjkSeg += ch;
    } else if (ASCII_WORD_RE.test(ch)) {
      flushCjk();
      asciiWord += ch;
    } else {
      flushCjk();
      flushAscii();
    }
  }
  flushCjk();
  flushAscii();
  return tokens.join(" ");
}

/** 提取查询串中的中文单字符（无 bigram 可查，需降级 LIKE） */
export function extractShortCjkTerms(query: string): string[] {
  const out = new Set<string>();
  for (const match of query.matchAll(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff]/gu)) {
    const ch = match[0]!;
    // 只收集「两侧都是非中文字符或边界」的孤立单字，避免把「太清」拆成两个单字
    const index = match.index;
    const prev = index > 0 ? query[index - 1]! : "";
    const next = index + ch.length < query.length ? query[index + ch.length]! : "";
    if (!CJK_RE.test(prev) && !CJK_RE.test(next)) out.add(ch);
  }
  return [...out];
}

export interface FtsQueryParts {
  /** 可直接用于 FTS5 MATCH 的表达式；空串表示无有效词条 */
  readonly expr: string;
  /** 需要降级为 LIKE 的中文单字 */
  readonly shortTerms: readonly string[];
  /** 参与 FTS 的查询词原文（供 matchReason 与校验使用） */
  readonly terms: readonly string[];
}

/**
 * 将查询串构造为 FTS5 表达式。
 * 每个查询词（空白分隔）gram 化后作为 phrase，词间 AND；
 * 中文单字收集到 shortTerms 交给调用方走 LIKE 兜底。
 */
export function toFtsQuery(query: string): FtsQueryParts {
  const parts = query.split(/\s+/u).filter((part) => part.length > 0);
  const phrases: string[] = [];
  const shortTerms: string[] = [];
  const terms: string[] = [];

  for (const part of parts) {
    const grams = toGrams(part);
    if (grams.length === 0) continue;
    terms.push(part);
    // 纯中文且 gram 后只剩 1 个 token（即单字）
    const isSingleCjk = /^[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff]$/u.test(part);
    if (isSingleCjk) {
      shortTerms.push(part);
      continue;
    }
    // 防注入：FTS5 MATCH 表达式的双引号转义
    const safe = grams.replace(/"/gu, '""');
    phrases.push(`"${safe}"`);
  }

  return {
    expr: phrases.join(" AND "),
    shortTerms,
    terms,
  };
}

/**
 * 精确校验：候选条目原文是否真的包含查询词。
 * 用于剔除 bigram phrase 在标点边界产生的假阳性
 * （如原文「他登上太清。清门之外」会命中 phrase "太清 清门"）。
 *
 * 两档判定：
 * 1. 强命中：整个查询串作为连续子串出现在任一字段（title / aliases / tags /
 *    keywords / summary / content）中 → 返回该字段。
 * 2. 弱命中（仅多词查询）：每个词至少出现在某个字段（允许跨字段分布）
 *    → 返回所有命中字段的并集（reason 侧区分弱命中）。
 * 单词查询没有弱命中分支，直接由强命中判定，避免放宽假阳性边界。
 */
export function verifyMatch(
  query: string,
  fields: Readonly<{ title: string; aliases: readonly string[]; tags: readonly string[]; summary: string; content: string; keywords: readonly string[] }>,
): readonly string[] {
  const terms = query.split(/\s+/u).filter((part) => part.length > 0);
  if (terms.length === 0) return [];

  const haystacks: ReadonlyArray<readonly [string, string]> = [
    ["title", fields.title],
    ["aliases", fields.aliases.join(" ")],
    ["tags", fields.tags.join(" ")],
    ["keywords", fields.keywords.join(" ")],
    ["summary", fields.summary],
    ["content", fields.content],
  ];

  const lowered = query.toLowerCase();

  // 1) 强命中：整体连续子串
  const wholeHits = haystacks.filter(([, haystack]) => haystack.toLowerCase().includes(lowered)).map(([field]) => field);
  if (wholeHits.length > 0) return wholeHits;

  // 2) 单词查询到此为止（不降级）
  if (terms.length === 1) return [];

  // 3) 弱命中：每个词至少命中一个字段（跨字段允许）
  const termHits: string[][] = terms.map((term) =>
    haystacks.filter(([, haystack]) => haystack.toLowerCase().includes(term.toLowerCase())).map(([field]) => field),
  );
  if (termHits.some((hits) => hits.length === 0)) return [];
  return [...new Set(termHits.flat())];
}
