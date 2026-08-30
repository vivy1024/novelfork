import { FANQIE_BASE, FANQIE_USER_AGENT, MAX_PUBLIC_CHAPTER_SAMPLES } from "./config.js";
import { decodeFanqiePua } from "./fanqie-pua.js";
import { extractInitialState } from "./fanqie.js";
import { fetchText, stripTags } from "./http.js";
import type { MarketFetchOptions, PublicChapterSample } from "./types.js";

const SYSTEM_WORDS = ["系统", "任务", "面板", "积分", "商城"];
const CONFLICT_WORDS = ["杀", "战", "仇", "对峙", "冲突", "反杀"];
const GOLDEN_FINGER_WORDS = ["金手指", "外挂", "穿越", "重生", "空间", "天赋"];

export interface ChapterSampleInput {
  readonly book_id: string;
  readonly maxChapters?: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function textOf(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function countHits(text: string, words: readonly string[]): number {
  return words.reduce((sum, word) => sum + (text.split(word).length - 1), 0);
}

function cleanChapterHtml(raw: string): string {
  return raw
    .replace(/<\/p>/gi, "\n")
    .replace(/<p[^>]*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/&nbsp;/gi, " ");
}

function analyzeChapter(bookId: string, chapterId: string, title: string, content: string): PublicChapterSample {
  const paragraphs = content
    .split(/\n+/)
    .map((line) => stripTags(line))
    .filter(Boolean);
  const dialogueChars = paragraphs
    .filter((line) => /[“"「『]/.test(line) || /说道?|问道|喝道/.test(line))
    .reduce((sum, line) => sum + line.length, 0);
  const totalChars = paragraphs.reduce((sum, line) => sum + line.length, 0);
  const questionMarks = (content.match(/[？?]/g) ?? []).length;
  const exclamationMarks = (content.match(/[！!]/g) ?? []).length;
  const systemHits = countHits(content, SYSTEM_WORDS);
  const conflictHits = countHits(content, CONFLICT_WORDS);
  const goldenHits = countHits(content, GOLDEN_FINGER_WORDS);
  return {
    book_id: bookId,
    chapter_id: chapterId,
    title,
    chapter_word_count: totalChars,
    paragraph_count: paragraphs.length,
    dialogue_ratio: totalChars === 0 ? 0 : Number((dialogueChars / totalChars).toFixed(3)),
    question_mark_count: questionMarks,
    exclamation_mark_count: exclamationMarks,
    system_word_hits: systemHits,
    conflict_word_hits: conflictHits,
    golden_finger_hits: goldenHits,
    structural_summary: [
      `字数${totalChars}`,
      `段落${paragraphs.length}`,
      `对话占比${totalChars === 0 ? 0 : Math.round((dialogueChars / totalChars) * 100)}%`,
      `问句${questionMarks}`,
      `叹号${exclamationMarks}`,
      systemHits > 0 ? `系统词${systemHits}` : "",
      conflictHits > 0 ? `冲突词${conflictHits}` : "",
      goldenHits > 0 ? `金手指词${goldenHits}` : "",
    ].filter(Boolean).join("，"),
  };
}

function chaptersFromDirectory(payload: unknown): Array<{ id: string; title: string; isFree: boolean }> {
  const data = asRecord(asRecord(payload)?.data) ?? asRecord(payload) ?? {};
  const items = data.chapterListWithVolume ?? data.list ?? data.item_list ?? [];
  const flat = Array.isArray(items)
    ? items.flatMap((item) => (Array.isArray(item) ? item : [item]))
    : [];
  return flat.flatMap((item) => {
    const rec = asRecord(item);
    if (!rec) return [];
    const id = textOf(rec.itemId ?? rec.item_id ?? rec.id);
    const title = decodeFanqiePua(textOf(rec.title ?? rec.chapterName));
    if (!id) return [];
    const needPay = rec.needPay ?? rec.need_pay ?? 0;
    const isPaidStory = rec.isPaidStory === true;
    return [{ id, title, isFree: needPay === 0 && !isPaidStory }];
  });
}

function chaptersFromPageHtml(html: string): Array<{ id: string; title: string; isFree: boolean }> {
  const matches = [...html.matchAll(/<a[^>]*href="\/reader\/(\d+)"[^>]*>([\s\S]*?)<\/a>/gi)];
  return matches.map((match) => ({
    id: match[1]!,
    title: decodeFanqiePua(stripTags(match[2] ?? "")),
    isFree: true,
  }));
}

async function fetchChapterContent(
  chapterId: string,
  options: MarketFetchOptions,
): Promise<{ title: string; content: string }> {
  const response = await fetchText(`${FANQIE_BASE}/reader/${chapterId}`, {
    ...options,
    userAgent: FANQIE_USER_AGENT,
    headers: { Referer: FANQIE_BASE },
  });
  if (!response.ok) return { title: "", content: "" };
  const state = extractInitialState(response.text);
  const chapter = asRecord(asRecord(state?.reader)?.chapterData) ?? {};
  const title = decodeFanqiePua(textOf(chapter.title));
  const raw = textOf(chapter.content);
  const content = decodeFanqiePua(cleanChapterHtml(raw));
  return { title, content };
}

export async function samplePublicChapters(
  input: ChapterSampleInput,
  options: MarketFetchOptions = {},
): Promise<PublicChapterSample[]> {
  const maxChapters = Math.min(Math.max(input.maxChapters ?? MAX_PUBLIC_CHAPTER_SAMPLES, 1), MAX_PUBLIC_CHAPTER_SAMPLES);
  const directory = await fetchText(`${FANQIE_BASE}/api/reader/directory/detail?bookId=${encodeURIComponent(input.book_id)}`, {
    ...options,
    userAgent: FANQIE_USER_AGENT,
    headers: { Accept: "application/json", Referer: `${FANQIE_BASE}/page/${input.book_id}` },
  });
  let chapters = directory.ok ? chaptersFromDirectory(safeJson(directory.text)) : [];
  if (chapters.length === 0) {
    const page = await fetchText(`${FANQIE_BASE}/page/${input.book_id}`, {
      ...options,
      userAgent: FANQIE_USER_AGENT,
      headers: { Referer: FANQIE_BASE },
    });
    chapters = page.ok ? chaptersFromPageHtml(page.text) : [];
  }
  const freeChapters = chapters.filter((chapter) => chapter.isFree).slice(0, maxChapters);
  const samples: PublicChapterSample[] = [];
  for (const chapter of freeChapters) {
    const { title, content } = await fetchChapterContent(chapter.id, options);
    if (!content) continue;
    samples.push(analyzeChapter(input.book_id, chapter.id, title || chapter.title, content));
  }
  return samples;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
