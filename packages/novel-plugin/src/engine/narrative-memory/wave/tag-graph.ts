import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import type { NarrativeContextCard } from "../types.js";

export type NarrativeTagType = "character" | "location" | "faction" | "item" | "event" | "hook" | "theme" | "style" | "rule";

export type NarrativeTag = Readonly<{
  id: string;
  bookId: string;
  label: string;
  type: NarrativeTagType;
}>;

export type NarrativeTagEdge = Readonly<{
  id: string;
  bookId: string;
  sourceTagId: string;
  targetTagId: string;
  weight: number;
  ordinalPotential: number;
  chapterProximity: number;
}>;

export type NarrativeTagGraph = Readonly<{
  tags: readonly NarrativeTag[];
  edges: readonly NarrativeTagEdge[];
  cardTags: readonly Readonly<{ cardId: string; tagId: string }>[];
}>;

export type RebuildNarrativeTagGraphResult = Readonly<{
  tagCount: number;
  edgeCount: number;
  cardTagCount: number;
}>;

const TAG_TYPES = new Set<NarrativeTagType>(["character", "location", "faction", "item", "event", "hook", "theme", "style", "rule"]);

function normalizeLabel(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function normalizeIdPart(value: string): string {
  return normalizeLabel(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/gu, "") || "tag";
}

function tagId(bookId: string, type: NarrativeTagType, label: string): string {
  return `${bookId}:${type}:${normalizeIdPart(label)}`;
}

function inferTagTypeFromRawTag(tag: string): NarrativeTagType | undefined {
  const normalized = tag.trim().toLowerCase();
  if (TAG_TYPES.has(normalized as NarrativeTagType)) return normalized as NarrativeTagType;
  if (["book_rule", "hard", "canon", "constraint"].includes(normalized)) return "rule";
  if (["foreshadow", "foreshadowing", "伏笔"].includes(normalized)) return "hook";
  if (["地点", "place"].includes(normalized)) return "location";
  return undefined;
}

function proximity(card: NarrativeContextCard, currentChapter?: number): number {
  if (currentChapter === undefined || card.validFromChapter === undefined) return 1;
  const distance = Math.max(0, Math.abs(currentChapter - card.validFromChapter));
  return 1 / (1 + distance / 10);
}

function uniqueById(tags: readonly NarrativeTag[]): NarrativeTag[] {
  const map = new Map<string, NarrativeTag>();
  for (const tag of tags) map.set(tag.id, tag);
  return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function extractNarrativeTags(card: NarrativeContextCard): NarrativeTag[] {
  const tags: NarrativeTag[] = [];
  for (const entity of card.entities) {
    const label = normalizeLabel(entity);
    if (!label) continue;
    tags.push({ id: tagId(card.bookId, "character", label), bookId: card.bookId, label, type: "character" });
  }
  for (const rawTag of card.tags) {
    const label = normalizeLabel(rawTag);
    if (!label) continue;
    const type = inferTagTypeFromRawTag(label) ?? "theme";
    tags.push({ id: tagId(card.bookId, type, label), bookId: card.bookId, label, type });
  }
  if (card.channel === "hooks") tags.push({ id: tagId(card.bookId, "hook", card.title), bookId: card.bookId, label: card.title, type: "hook" });
  if (card.channel === "style") tags.push({ id: tagId(card.bookId, "style", card.title), bookId: card.bookId, label: card.title, type: "style" });
  if (card.channel === "hard") tags.push({ id: tagId(card.bookId, "rule", card.title), bookId: card.bookId, label: card.title, type: "rule" });
  return uniqueById(tags);
}

export function buildNarrativeTagGraph(cards: readonly NarrativeContextCard[], options: Readonly<{ currentChapter?: number }> = {}): NarrativeTagGraph {
  const tagMap = new Map<string, NarrativeTag>();
  const cardTags: Array<{ cardId: string; tagId: string }> = [];
  const edgeMap = new Map<string, NarrativeTagEdge>();

  for (const card of [...cards].sort((a, b) => a.id.localeCompare(b.id))) {
    const tags = extractNarrativeTags(card);
    for (const tag of tags) {
      tagMap.set(tag.id, tag);
      cardTags.push({ cardId: card.id, tagId: tag.id });
    }
    for (let sourceIndex = 0; sourceIndex < tags.length; sourceIndex += 1) {
      for (let targetIndex = 0; targetIndex < tags.length; targetIndex += 1) {
        if (sourceIndex === targetIndex) continue;
        const source = tags[sourceIndex]!;
        const target = tags[targetIndex]!;
        const ordinalPotential = 1 / (1 + Math.abs(targetIndex - sourceIndex));
        const chapterProximity = proximity(card, options.currentChapter);
        const weight = Math.max(0, Math.min(1, ordinalPotential * chapterProximity));
        const id = `${source.id}->${target.id}`;
        const existing = edgeMap.get(id);
        if (!existing || weight > existing.weight) {
          edgeMap.set(id, { id, bookId: card.bookId, sourceTagId: source.id, targetTagId: target.id, weight, ordinalPotential, chapterProximity });
        }
      }
    }
  }

  return {
    tags: [...tagMap.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...edgeMap.values()].sort((a, b) => a.id.localeCompare(b.id)),
    cardTags: [...new Map(cardTags.map((item) => [`${item.cardId}:${item.tagId}`, item])).values()].sort((a, b) => `${a.cardId}:${a.tagId}`.localeCompare(`${b.cardId}:${b.tagId}`)),
  };
}

export function ensureNarrativeWaveSchema(storage: StorageDatabase): void {
  storage.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS narrative_tag (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      label TEXT NOT NULL,
      type TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS narrative_card_tag (
      book_id TEXT NOT NULL,
      card_id TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      PRIMARY KEY (book_id, card_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS narrative_tag_edge (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      source_tag_id TEXT NOT NULL,
      target_tag_id TEXT NOT NULL,
      weight REAL NOT NULL,
      ordinal_potential REAL NOT NULL,
      chapter_proximity REAL NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_narrative_tag_book_type ON narrative_tag(book_id, type);
    CREATE INDEX IF NOT EXISTS idx_narrative_card_tag_book_card ON narrative_card_tag(book_id, card_id);
    CREATE INDEX IF NOT EXISTS idx_narrative_tag_edge_book_source ON narrative_tag_edge(book_id, source_tag_id);
  `);
}

export function rebuildNarrativeTagGraph(
  storage: StorageDatabase,
  bookId: string,
  cards: readonly NarrativeContextCard[],
  options: Readonly<{ currentChapter?: number }> = {},
): RebuildNarrativeTagGraphResult {
  ensureNarrativeWaveSchema(storage);
  const graph = buildNarrativeTagGraph(cards.filter((card) => card.bookId === bookId), options);
  const tx = storage.sqlite.transaction(() => {
    storage.sqlite.prepare(`DELETE FROM narrative_card_tag WHERE book_id = ?`).run(bookId);
    storage.sqlite.prepare(`DELETE FROM narrative_tag_edge WHERE book_id = ?`).run(bookId);
    storage.sqlite.prepare(`DELETE FROM narrative_tag WHERE book_id = ?`).run(bookId);
    const insertTag = storage.sqlite.prepare(`INSERT INTO narrative_tag (id, book_id, label, type) VALUES (?, ?, ?, ?)`);
    const insertCardTag = storage.sqlite.prepare(`INSERT INTO narrative_card_tag (book_id, card_id, tag_id) VALUES (?, ?, ?)`);
    const insertEdge = storage.sqlite.prepare(`INSERT INTO narrative_tag_edge (id, book_id, source_tag_id, target_tag_id, weight, ordinal_potential, chapter_proximity) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const tag of graph.tags) insertTag.run(tag.id, tag.bookId, tag.label, tag.type);
    for (const item of graph.cardTags) insertCardTag.run(bookId, item.cardId, item.tagId);
    for (const edge of graph.edges) insertEdge.run(edge.id, edge.bookId, edge.sourceTagId, edge.targetTagId, edge.weight, edge.ordinalPotential, edge.chapterProximity);
  });
  tx();
  return { tagCount: graph.tags.length, edgeCount: graph.edges.length, cardTagCount: graph.cardTags.length };
}

export function calculateBellSemanticGain(similarity: number, center = 0.62, width = 0.22): number {
  if (!Number.isFinite(similarity) || width <= 0) return 0;
  const exponent = -((similarity - center) ** 2) / (2 * width ** 2);
  return Math.max(0, Math.min(1, Math.exp(exponent)));
}

function dot(a: readonly number[], b: readonly number[]): number {
  return a.reduce((sum, value, index) => sum + value * (b[index] ?? 0), 0);
}

function energy(vector: readonly number[]): number {
  return vector.reduce((sum, value) => sum + value * value, 0);
}

export function calculateResidualAnchor(queryVector: readonly number[], anchorVector?: readonly number[]): Readonly<{ residualVector: readonly number[]; energyRatio: number; fallback?: "missing_vector" }> {
  if (queryVector.length === 0 || !anchorVector || anchorVector.length !== queryVector.length || energy(anchorVector) <= 0) {
    return { residualVector: queryVector, energyRatio: 1, fallback: "missing_vector" };
  }
  const coefficient = dot(queryVector, anchorVector) / energy(anchorVector);
  const residualVector = queryVector.map((value, index) => value - coefficient * (anchorVector[index] ?? 0));
  const baseEnergy = energy(queryVector);
  return { residualVector, energyRatio: baseEnergy <= 0 ? 0 : energy(residualVector) / baseEnergy };
}
