/**
 * memory.search_text — 按关键词搜章节原文，返回命中段落的章号、带高亮的短片段与章内偏移。
 *
 * 与 memory.search 的区别：memory.search 查的是记忆库里的事实 / 事件 / 日志；这里查的是正文本身，
 * 摘要和设定没记下的细节（某章出现过的一件物品、一句誓言）也能找到。要看上下文时按返回的
 * offset / limit 调 chapter.read 分段读原文。
 */

import { getStorageDatabase } from "@vivy1024/novelfork-core";
import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import {
  buildPassageSnippet,
  ensureBookPassageIndexFresh,
  passageContains,
  passageQueryTerms,
  readPassageTexts,
  searchPassageCandidates,
} from "../engine/narrative-memory/chapter-passage-index.js";

export interface MemorySearchTextInput {
  readonly bookId: string;
  readonly bookRoot?: string;
  readonly query: string;
  readonly fromChapter?: number;
  readonly toChapter?: number;
  readonly limit?: number;
  /** any=任一关键词命中即可；all（默认）=全部关键词都要出现在同一段。 */
  readonly match?: "all" | "any";
}

export interface MemorySearchTextHit {
  readonly chapterNumber: number;
  readonly fileName: string;
  /** 命中词用【】标出的短片段。 */
  readonly snippet: string;
  /** 片段在章内的起点与长度（按字计），可直接作为 chapter.read 的 offset / limit。 */
  readonly offset: number;
  readonly length: number;
  /** 整个命中段落的范围，需要更多上下文时用它读。 */
  readonly passage: { readonly offset: number; readonly limit: number };
  readonly matchedTerms: readonly string[];
  readonly score: number;
}

export interface MemorySearchTextResult {
  readonly ok: boolean;
  readonly summary: string;
  readonly error?: string;
  readonly data?: {
    readonly query: string;
    readonly terms: readonly string[];
    readonly ignoredTerms: readonly string[];
    readonly hits: readonly MemorySearchTextHit[];
    readonly hint: string;
    readonly index: {
      readonly totalChapters: number;
      readonly reindexed: number;
      readonly removed: number;
      /** 时间预算内没来得及建索引的章数；>0 时结果可能不全，再搜一次会接着补。 */
      readonly pending: number;
    };
  };
}

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;
const SNIPPET_CHARS = 120;

function positiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

export async function handleMemorySearchText(input: MemorySearchTextInput, storageOverride?: StorageDatabase): Promise<MemorySearchTextResult> {
  const bookId = String(input.bookId ?? "").trim();
  if (!bookId) return { ok: false, error: "invalid-input", summary: "bookId 必填。" };
  const bookRoot = input.bookRoot?.trim();
  if (!bookRoot) return { ok: false, error: "missing-book-root", summary: "缺少书籍目录，无法搜索正文。" };
  const query = typeof input.query === "string" ? input.query.trim() : "";
  if (!query) return { ok: false, error: "invalid-input", summary: "query 必填：写要找的词，多个词用空格隔开。" };

  const { terms, ignored } = passageQueryTerms(query.split(/\s+/u));
  if (terms.length === 0) {
    return {
      ok: false,
      error: "query-too-short",
      summary: `没有可搜索的词：${ignored.length > 0 ? `单个汉字（${ignored.join("、")}）太短，` : ""}请换成两个字以上的词。`,
    };
  }
  const limit = Math.min(MAX_LIMIT, positiveInt(input.limit) ?? DEFAULT_LIMIT);
  const fromChapter = positiveInt(input.fromChapter);
  const toChapter = positiveInt(input.toChapter);
  const mode = input.match === "any" ? "any" : "all";

  const storage = storageOverride ?? getStorageDatabase();
  const index = await ensureBookPassageIndexFresh(storage, bookId, bookRoot, { budgetMs: 3000 });
  const candidates = searchPassageCandidates(storage, {
    bookId,
    phrases: terms.map((term) => term.phrase),
    mode,
    ...(fromChapter ? { fromChapter } : {}),
    ...(toChapter ? { toChapter } : {}),
    limit: limit * 4,
  });
  const { passages } = await readPassageTexts(storage, bookId, bookRoot, candidates, index.files);
  const termTexts = terms.map((term) => term.term);
  const hits: MemorySearchTextHit[] = [];
  const seen = new Set<string>();
  for (const passage of passages) {
    // bigram phrase 在标点边界会有假阳性：回读原文后按字面再核一遍。
    const matched = termTexts.filter((term) => passageContains(passage.text, term));
    if (matched.length === 0 || (mode === "all" && matched.length < termTexts.length)) continue;
    const snippet = buildPassageSnippet(passage.text, passage.startOffset, matched, SNIPPET_CHARS);
    // 相邻窗口有重叠：同一处命中只报一次。
    const key = `${passage.chapterNumber}:${snippet.snippet.replace(/^…|…$/gu, "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push({
      chapterNumber: passage.chapterNumber,
      fileName: passage.fileName,
      snippet: snippet.snippet,
      offset: snippet.offset,
      length: snippet.length,
      passage: { offset: passage.startOffset, limit: passage.endOffset - passage.startOffset },
      matchedTerms: matched,
      score: Math.round(passage.score * 1000) / 1000,
    });
    if (hits.length >= limit) break;
  }

  const pendingNote = index.pending.length > 0 ? `还有 ${index.pending.length} 章正文没来得及建索引，结果可能不全，稍后再搜一次。` : "";
  const ignoredNote = ignored.length > 0 ? `单字「${ignored.join("、")}」太短，没参与搜索。` : "";
  const chapters = [...new Set(hits.map((hit) => hit.chapterNumber))];
  return {
    ok: true,
    summary: hits.length > 0
      ? `正文里找到 ${hits.length} 处「${termTexts.join(" ")}」，分布在第 ${chapters.join("、")} 章。${ignoredNote}${pendingNote}`
      : `正文里没有找到「${termTexts.join(" ")}」${mode === "all" && termTexts.length > 1 ? "同时出现的段落，可改用 match=any" : ""}。${ignoredNote}${pendingNote}`,
    data: {
      query,
      terms: termTexts,
      ignoredTerms: ignored,
      hits,
      hint: "要看上下文，用 chapter.read 传 chapterNumber 和命中的 offset / limit 分段读；passage 是整段的范围。",
      index: {
        totalChapters: index.totalChapters,
        reindexed: index.reindexed.length,
        removed: index.removed.length,
        pending: index.pending.length,
      },
    },
  };
}
