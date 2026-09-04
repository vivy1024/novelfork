import {
  FANQIE_BASE,
  FANQIE_RANK_API_UA,
  FANQIE_RANKS,
  FANQIE_USER_AGENT,
  MAX_PAGES_PER_RANK,
  PARSER_VERSION,
  type RankSourceConfig,
} from "./config.js";
import { generateABogus } from "./fanqie-abogus.js";
import { containsPua, decodeFanqiePua } from "./fanqie-pua.js";
import { fetchText, todayUtc } from "./http.js";
import type { BookSnapshot, MarketFetchOptions, RankRecord } from "./types.js";

const INITIAL_STATE_RE = /window\.__INITIAL_STATE__\s*=/;

function emptySnapshot(rankType: string, observedAt: string): BookSnapshot {
  return {
    snapshot_id: `fanqie-${rankType}-${observedAt}`,
    platform: "fanqie",
    rank_type: rankType,
    observed_at: observedAt,
    parser_version: PARSER_VERSION,
    records: [],
  };
}

function statusSnapshot(
  rankType: string,
  observedAt: string,
  status: RankRecord["source_status"],
): BookSnapshot {
  return {
    ...emptySnapshot(rankType, observedAt),
    records: [{
      platform: "fanqie",
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

export function extractInitialState(html: string): Record<string, unknown> | null {
  const match = INITIAL_STATE_RE.exec(html);
  if (!match || match.index === undefined) return null;
  const payload = html.slice(match.index + match[0].length).trim();
  if (!payload.startsWith("{")) return null;
  try {
    return JSON.parse(extractJsonObject(payload)) as Record<string, unknown>;
  } catch {
    try {
      return JSON.parse(extractJsonObject(payload).replace(/,\s*([}\]])/g, "$1").replace(/\bundefined\b/g, "null")) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function extractJsonObject(source: string): string {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(0, i + 1);
    }
  }
  return source;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function textOf(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function intOf(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  const digits = String(value ?? "").replace(/[^\d-]/g, "");
  if (!digits || digits === "-") return undefined;
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function rankRecords(rankState: Record<string, unknown>): unknown[] {
  for (const key of ["book_list", "readRankList", "newRankList"]) {
    const records = rankState[key];
    if (Array.isArray(records)) return records;
  }
  return [];
}

function categoryMap(rankState: Record<string, unknown>): Map<string, string> {
  const result = new Map<string, string>();
  const types = asRecord(rankState.rankCategoryTypeList) ?? {};
  for (const items of Object.values(types)) {
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const rec = asRecord(item);
      if (!rec) continue;
      const id = textOf(rec.id);
      const name = textOf(rec.name);
      if (id && name) result.set(id, name);
    }
  }
  return result;
}

export function parseFanqieRankingHtml(html: string, rankType: string, observedAt: string): RankRecord[] {
  const state = extractInitialState(html);
  const rankState = asRecord(state?.rank);
  if (!rankState) return [];
  const categories = categoryMap(rankState);
  const records: RankRecord[] = [];
  for (const item of rankRecords(rankState)) {
    const rec = asRecord(item);
    if (!rec) continue;
    const bookId = textOf(rec.bookId ?? rec.book_id);
    const rawTitle = textOf(rec.bookName ?? rec.book_name);
    if (!bookId || !rawTitle) continue;
    const rawAuthor = textOf(rec.author ?? rec.author_name);
    const rawIntro = textOf(rec.abstract ?? rec.description);
    const title = decodeFanqiePua(rawTitle) || rawTitle;
    const author = decodeFanqiePua(rawAuthor);
    const intro = decodeFanqiePua(rawIntro);
    records.push({
      platform: "fanqie",
      book_id: bookId,
      rank_type: rankType,
      category: textOf(rec.categoryV2 ?? rec.category)
        || categories.get(textOf(rec.curent_category_id))
        || categories.get(textOf(rec.pos_category_id))
        || "",
      rank: intOf(rec.currentPos) ?? records.length + 1,
      title,
      author,
      observed_at: observedAt,
      source_status: "ok",
      parser_version: PARSER_VERSION,
      font_decoded: containsPua(`${rawTitle}${rawAuthor}${rawIntro}`) || undefined,
      word_count: intOf(rec.wordNumber),
      intro,
    });
  }
  return records;
}

function parseFanqieApiBooks(payload: unknown, rankType: string, observedAt: string): RankRecord[] {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const list = data?.book_list;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item, index) => {
    const rec = asRecord(item);
    if (!rec) return [];
    const bookId = textOf(rec.book_id ?? rec.bookId);
    const rawTitle = textOf(rec.bookName ?? rec.book_name);
    if (!bookId || !rawTitle) return [];
    const rawAuthor = textOf(rec.author ?? rec.author_name);
    const rawIntro = textOf(rec.abstract ?? rec.description);
    return [{
      platform: "fanqie" as const,
      book_id: bookId,
      rank_type: rankType,
      category: textOf(rec.category ?? rec.categoryV2),
      rank: index + 1,
      title: decodeFanqiePua(rawTitle) || rawTitle,
      author: decodeFanqiePua(rawAuthor),
      observed_at: observedAt,
      source_status: "ok" as const,
      parser_version: PARSER_VERSION,
      font_decoded: containsPua(`${rawTitle}${rawAuthor}${rawIntro}`) || undefined,
      word_count: intOf(rec.wordNumber),
      intro: decodeFanqiePua(rawIntro),
    }];
  });
}

function parseGenderMold(rankKey: string): { gender: number; rankMold: number } {
  const [gender, mold] = rankKey.split("_");
  return {
    gender: gender === "female" || gender === "0" ? 0 : 1,
    rankMold: mold === "new" || mold === "1" ? 1 : 2,
  };
}

async function fetchFanqieApiPage(
  rankKey: string,
  page: number,
  observedAt: string,
  options: MarketFetchOptions,
): Promise<RankRecord[]> {
  const { gender, rankMold } = parseGenderMold(rankKey);
  const offset = (page - 1) * 30;
  const query = `app_id=2503&rank_list_type=3&offset=${offset}&limit=30&category_id=&rank_version=&gender=${gender}&rankMold=${rankMold}`;
  const aBogus = generateABogus(query, FANQIE_RANK_API_UA, {
    nowMs: options.now?.().getTime(),
    random: options.random,
  });
  const url = `${FANQIE_BASE}/api/rank/category/list?${query}&a_bogus=${encodeURIComponent(aBogus)}`;
  const response = await fetchText(url, {
    ...options,
    userAgent: FANQIE_RANK_API_UA,
    headers: { Accept: "application/json", Referer: FANQIE_BASE },
  });
  if (!response.ok) return [];
  try {
    return parseFanqieApiBooks(JSON.parse(response.text) as unknown, rankKey, observedAt);
  } catch {
    return [];
  }
}

export async function scrapeFanqieRank(
  rankKey: string,
  options: MarketFetchOptions = {},
  rankConfig?: RankSourceConfig,
): Promise<BookSnapshot> {
  const config = rankConfig ?? FANQIE_RANKS.find((rank) => rank.key === rankKey);
  const observedAt = todayUtc(options.now?.());
  if (!config) return statusSnapshot(rankKey, observedAt, "parse_fail");

  const maxPages = options.maxPages ?? MAX_PAGES_PER_RANK;
  const seen = new Set<string>();
  const records: RankRecord[] = [];
  let lastHtml = "";

  for (let page = 1; page <= maxPages; page += 1) {
    const url = page <= 1 ? config.url : `${config.url}${config.url.includes("?") ? "&" : "?"}page=${page}`;
    const response = await fetchText(url, {
      ...options,
      userAgent: options.userAgent ?? FANQIE_USER_AGENT,
      headers: { Referer: FANQIE_BASE },
    });
    lastHtml = response.text;
    let pageRecords = response.ok ? parseFanqieRankingHtml(response.text, rankKey, observedAt) : [];
    if (pageRecords.length === 0 && options.allowApiFallback !== false) {
      pageRecords = await fetchFanqieApiPage(rankKey, page, observedAt, options);
    }
    const fresh = pageRecords.filter((record) => record.book_id && !seen.has(record.book_id));
    if (fresh.length === 0) break;
    for (const record of fresh) seen.add(record.book_id);
    records.push(...fresh);
  }

  if (records.length === 0) {
    return lastHtml.trim() ? statusSnapshot(rankKey, observedAt, "parse_fail") : statusSnapshot(rankKey, observedAt, "empty");
  }
  return {
    snapshot_id: `fanqie-${rankKey}-${observedAt}`,
    platform: "fanqie",
    rank_type: rankKey,
    observed_at: observedAt,
    parser_version: PARSER_VERSION,
    records,
  };
}

export async function scrapeFanqieRanks(
  rankKeys: readonly string[] = FANQIE_RANKS.map((rank) => rank.key),
  options: MarketFetchOptions = {},
): Promise<BookSnapshot[]> {
  const snapshots: BookSnapshot[] = [];
  for (const key of rankKeys) snapshots.push(await scrapeFanqieRank(key, options));
  return snapshots;
}
