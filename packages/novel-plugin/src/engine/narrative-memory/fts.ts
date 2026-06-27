import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import type { NarrativeContextCard } from "./types.js";

export interface SearchContextCardsExactInput {
  readonly cards: readonly NarrativeContextCard[];
  readonly query: string;
  readonly storage?: StorageDatabase;
  readonly forceLike?: boolean;
  readonly limit?: number;
}

export interface ExactContextCardMatch {
  readonly card: NarrativeContextCard;
  readonly matchReason: string;
  readonly score: number;
}

interface SearchableCardText {
  readonly id: string;
  readonly title: string;
  readonly tags: string;
  readonly entities: string;
  readonly brief: string;
  readonly summary: string;
  readonly content: string;
}

interface FtsRow {
  id: string;
  score: number;
}

const WORD_PATTERN = /[\p{L}\p{N}_]+/gu;

function queryTerms(query: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const match of query.matchAll(WORD_PATTERN)) {
    const term = match[0]?.trim();
    if (!term || seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
  }
  return terms;
}

export function sanitizeFtsQuery(query: string): string {
  return queryTerms(query).map((term) => `"${term.replace(/"/gu, "")}"`).join(" ");
}

function toSearchableText(card: NarrativeContextCard): SearchableCardText {
  return {
    id: card.id,
    title: card.title,
    tags: card.tags.join(" "),
    entities: card.entities.join(" "),
    brief: card.brief,
    summary: card.summary ?? "",
    content: card.content,
  };
}

function fieldMatches(text: SearchableCardText, terms: readonly string[]): string[] {
  const fields: Array<readonly [keyof SearchableCardText, string]> = [
    ["title", text.title],
    ["entities", text.entities],
    ["tags", text.tags],
    ["brief", text.brief],
    ["summary", text.summary],
    ["content", text.content],
  ];
  return fields
    .filter(([, value]) => terms.some((term) => value.includes(term)))
    .map(([field]) => field);
}

function rankMatch(card: NarrativeContextCard, text: SearchableCardText, terms: readonly string[], ftsScore = 0): ExactContextCardMatch | null {
  const matchedFields = fieldMatches(text, terms);
  if (matchedFields.length === 0) return null;
  const fieldBoost = matchedFields.reduce((sum, field) => {
    if (field === "title") return sum + 8;
    if (field === "entities") return sum + 7;
    if (field === "tags") return sum + 6;
    if (field === "brief" || field === "summary") return sum + 4;
    return sum + 2;
  }, 0);
  return {
    card,
    matchReason: `精确召回命中 ${matchedFields.join("/")}：${terms.join("、")}${ftsScore !== 0 ? "（FTS）" : "（LIKE）"}`,
    score: fieldBoost + card.priority / 100 + card.importance / 200 + Math.max(0, ftsScore),
  };
}

function searchByLike(cards: readonly NarrativeContextCard[], terms: readonly string[], limit: number): ExactContextCardMatch[] {
  return cards
    .map((card) => rankMatch(card, toSearchableText(card), terms))
    .filter((match): match is ExactContextCardMatch => Boolean(match))
    .sort((a, b) => b.score - a.score || a.card.id.localeCompare(b.card.id))
    .slice(0, limit);
}

function searchByFts(storage: StorageDatabase, cards: readonly NarrativeContextCard[], ftsQuery: string, terms: readonly string[], limit: number): ExactContextCardMatch[] {
  const tableName = `temp_narrative_context_card_fts_${crypto.randomUUID().replace(/-/gu, "_")}`;
  const byId = new Map(cards.map((card) => [card.id, card]));
  storage.sqlite.exec(`CREATE VIRTUAL TABLE ${tableName} USING fts5(id UNINDEXED, title, tags, entities, brief, summary, content)`);
  try {
    const insert = storage.sqlite.prepare(`INSERT INTO ${tableName} (id, title, tags, entities, brief, summary, content) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    try {
      for (const card of cards) {
        const text = toSearchableText(card);
        insert.run(text.id, text.title, text.tags, text.entities, text.brief, text.summary, text.content);
      }
    } finally {
      (insert as { finalize?: () => void }).finalize?.();
    }

    const query = storage.sqlite.prepare<FtsRow>(`
      SELECT id, bm25(${tableName}) * -1 AS score
      FROM ${tableName}
      WHERE ${tableName} MATCH ?
      ORDER BY score DESC
      LIMIT ?
    `);
    let rows: FtsRow[];
    try {
      rows = query.all(ftsQuery, limit * 2);
    } finally {
      (query as { finalize?: () => void }).finalize?.();
    }

    const matches = rows
      .map((row) => {
        const card = byId.get(row.id);
        if (!card) return null;
        return rankMatch(card, toSearchableText(card), terms, row.score);
      })
      .filter((match): match is ExactContextCardMatch => Boolean(match))
      .sort((a, b) => b.score - a.score || a.card.id.localeCompare(b.card.id))
      .slice(0, limit);
    return matches.length > 0 ? matches : searchByLike(cards, terms, limit);
  } finally {
    storage.sqlite.exec(`DROP TABLE IF EXISTS ${tableName}`);
  }
}

export function searchContextCardsExact(input: SearchContextCardsExactInput): ExactContextCardMatch[] {
  const terms = queryTerms(input.query);
  if (terms.length === 0 || input.cards.length === 0) return [];
  const limit = Math.max(1, input.limit ?? 20);
  const ftsQuery = sanitizeFtsQuery(input.query);

  if (!input.forceLike && input.storage && ftsQuery) {
    try {
      return searchByFts(input.storage, input.cards, ftsQuery, terms, limit);
    } catch {
      // SQLite builds without FTS5 or malformed MATCH expressions fall back to plain LIKE-style matching.
    }
  }

  return searchByLike(input.cards, terms, limit);
}
