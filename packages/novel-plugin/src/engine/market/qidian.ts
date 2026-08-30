import {
  MAX_PAGES_PER_RANK,
  MOBILE_USER_AGENT,
  PARSER_VERSION,
  QIDIAN_BASE,
  QIDIAN_RANKS,
} from "./config.js";
import { fetchText, stripTags, todayUtc } from "./http.js";
import type { BookSnapshot, MarketFetchOptions, RankRecord } from "./types.js";

const BLOCK_MARKERS = ["WAF拦截页面", "您的请求已中断", "Web应用防护服务检测", "probe.js"];
const MOBILE_FALLBACK_KEYS: Record<string, string> = {
  newbook: "newbRank",
  hotsales: "hotRank",
  strong: "fyRank",
};

function statusSnapshot(
  rankType: string,
  observedAt: string,
  status: RankRecord["source_status"],
): BookSnapshot {
  return {
    snapshot_id: `qidian-${rankType}-${observedAt}`,
    platform: "qidian",
    rank_type: rankType,
    observed_at: observedAt,
    parser_version: PARSER_VERSION,
    records: [{
      platform: "qidian",
      book_id: "",
      rank_type: rankType,
      category: "",
      rank: 0,
      title: "",
      author: "",
      observed_at: observedAt,
      source_status: status,
      parser_version: PARSER_VERSION,
    }],
  };
}

export function looksLikeBlockPage(html: string): boolean {
  return BLOCK_MARKERS.some((marker) => html.includes(marker));
}

function parseWordCount(text: string): number | undefined {
  const wan = text.match(/([\d.]+)\s*万字/);
  if (wan) return Math.round(Number.parseFloat(wan[1]!) * 10_000);
  const wanBare = text.match(/([\d.]+)\s*万/);
  if (wanBare) return Math.round(Number.parseFloat(wanBare[1]!) * 10_000);
  const raw = text.match(/([\d,]+)\s*字/);
  if (raw) return Number.parseInt(raw[1]!.replace(/,/g, ""), 10);
  return undefined;
}

function extractListItems(html: string): string[] {
  const preferred = html.match(/<ul[^>]*class="[^"]*all-img-list[^"]*"[^>]*>[\s\S]*?<\/ul>/i)
    ?? html.match(/<div[^>]*class="[^"]*book-img-text[^"]*"[^>]*>[\s\S]*?<\/div>/i)
    ?? html.match(/<(?:div|ul)[^>]*class="[^"]*rank-list[^"]*"[^>]*>[\s\S]*?<\/(?:div|ul)>/i);
  const source = preferred?.[0] ?? html;
  return [...source.matchAll(/<li\b[^>]*>[\s\S]*?<\/li>/gi)].map((match) => match[0]);
}

function firstMatch(html: string, patterns: readonly RegExp[]): string {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return stripTags(match[1]);
  }
  return "";
}

export function parseQidianDesktopHtml(html: string, rankType: string, observedAt: string): RankRecord[] {
  if (looksLikeBlockPage(html)) return [];
  const records: RankRecord[] = [];
  for (const item of extractListItems(html)) {
    const href = item.match(/href="[^"]*\/info\/(\d+)[^"]*"/i)?.[1];
    const title = firstMatch(item, [
      /<h2[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i,
      /<h4[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i,
      /<a[^>]*href="[^"]*\/info\/\d+[^"]*"[^>]*>([\s\S]*?)<\/a>/i,
    ]);
    if (!href || !title) continue;
    const author = firstMatch(item, [
      /<p[^>]*class="[^"]*author[^"]*"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i,
      /<a[^>]*class="[^"]*name[^"]*"[^>]*>([\s\S]*?)<\/a>/i,
    ]);
    const category = firstMatch(item, [
      /<a[^>]*href="[^"]*\/all\/[^"]*"[^>]*>([\s\S]*?)<\/a>/i,
      /<(?:span|a)[^>]*class="[^"]*tag[^"]*"[^>]*>([\s\S]*?)<\/(?:span|a)>/i,
    ]);
    const intro = firstMatch(item, [
      /<p[^>]*class="[^"]*(?:intro|desc)[^"]*"[^>]*>([\s\S]*?)<\/p>/i,
    ]);
    const updateText = firstMatch(item, [
      /<p[^>]*class="[^"]*(?:update|book-info)[^"]*"[^>]*>([\s\S]*?)<\/p>/i,
    ]);
    records.push({
      platform: "qidian",
      book_id: href,
      rank_type: rankType,
      category,
      rank: records.length + 1,
      title,
      author,
      observed_at: observedAt,
      source_status: "ok",
      parser_version: PARSER_VERSION,
      word_count: parseWordCount(`${updateText} ${stripTags(item)}`),
      intro,
    });
  }
  return records;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function textOf(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

export function parseQidianMobileHtml(html: string, rankType: string, observedAt: string): RankRecord[] {
  if (looksLikeBlockPage(html)) return [];
  const script = html.match(/<script[^>]*id="vite-plugin-ssr_pageContext"[^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (!script) return [];
  let context: unknown;
  try {
    context = JSON.parse(script.trim());
  } catch {
    return [];
  }
  const pageData = asRecord(asRecord(asRecord(asRecord(context)?.pageContext)?.pageProps)?.pageData);
  if (!pageData) return [];
  const fallbackKey = MOBILE_FALLBACK_KEYS[rankType];
  const fallback = fallbackKey ? pageData[fallbackKey] : undefined;
  const rawRecords = pageData.records;
  const records: unknown[] = Array.isArray(rawRecords)
    ? rawRecords
    : Array.isArray(fallback)
      ? fallback
      : [];
  return records.flatMap((item: unknown, index: number) => {
    const rec = asRecord(item);
    if (!rec || rec.isTime) return [];
    const bookId = textOf(rec.bid ?? rec.bookId ?? rec.bId);
    const title = textOf(rec.bName ?? rec.bookName ?? rec.title);
    if (!bookId || !title) return [];
    return [{
      platform: "qidian" as const,
      book_id: bookId,
      rank_type: rankType,
      category: textOf(rec.cat ?? rec.catName ?? rec.category),
      rank: Number.parseInt(textOf(rec.rankNum), 10) || index + 1,
      title,
      author: textOf(rec.bAuth ?? rec.authorName ?? rec.author),
      observed_at: observedAt,
      source_status: "ok" as const,
      parser_version: PARSER_VERSION,
      word_count: parseWordCount(textOf(rec.cnt ?? rec.wordCount)),
      intro: textOf(rec.desc ?? rec.rec ?? rec.description),
    }];
  });
}

function desktopUrl(base: string, page: number): string {
  if (page <= 1) return base;
  return `${base.replace(/\/$/, "")}/page${page}/`;
}

function mobileUrl(base: string, page: number): string {
  if (page <= 1) return base;
  return `${base}${base.includes("?") ? "&" : "?"}pageNum=${page}`;
}

export async function scrapeQidianRank(
  rankKey: string,
  options: MarketFetchOptions = {},
): Promise<BookSnapshot> {
  const config = QIDIAN_RANKS.find((rank) => rank.key === rankKey);
  const observedAt = todayUtc(options.now?.());
  if (!config) return statusSnapshot(rankKey, observedAt, "parse_fail");

  const maxPages = options.maxPages ?? MAX_PAGES_PER_RANK;
  const seen = new Set<string>();
  const records: RankRecord[] = [];
  let useMobile = false;
  let sawHtml = false;

  for (let page = 1; page <= maxPages; page += 1) {
    let pageRecords: RankRecord[] = [];
    if (!useMobile) {
      const desktop = await fetchText(desktopUrl(config.url, page), {
        ...options,
        headers: { Referer: QIDIAN_BASE },
      });
      sawHtml = sawHtml || Boolean(desktop.text.trim());
      pageRecords = desktop.ok ? parseQidianDesktopHtml(desktop.text, rankKey, observedAt) : [];
      if (pageRecords.length === 0) useMobile = true;
    }
    if (useMobile) {
      const mobile = await fetchText(mobileUrl(config.mobileUrl, page), {
        ...options,
        userAgent: MOBILE_USER_AGENT,
        headers: { Referer: "https://m.qidian.com/" },
      });
      sawHtml = sawHtml || Boolean(mobile.text.trim());
      pageRecords = mobile.ok ? parseQidianMobileHtml(mobile.text, rankKey, observedAt) : [];
    }
    const fresh = pageRecords.filter((record) => record.book_id && !seen.has(record.book_id));
    if (fresh.length === 0) break;
    for (const record of fresh) seen.add(record.book_id);
    records.push(...fresh);
  }

  if (records.length === 0) {
    return statusSnapshot(rankKey, observedAt, sawHtml ? "parse_fail" : "empty");
  }
  return {
    snapshot_id: `qidian-${rankKey}-${observedAt}`,
    platform: "qidian",
    rank_type: rankKey,
    observed_at: observedAt,
    parser_version: PARSER_VERSION,
    records,
  };
}

export async function scrapeQidianRanks(
  rankKeys: readonly string[] = QIDIAN_RANKS.map((rank) => rank.key),
  options: MarketFetchOptions = {},
): Promise<BookSnapshot[]> {
  const snapshots: BookSnapshot[] = [];
  for (const key of rankKeys) snapshots.push(await scrapeQidianRank(key, options));
  return snapshots;
}


