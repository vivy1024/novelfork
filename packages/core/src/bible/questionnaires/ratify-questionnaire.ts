import type { StorageDatabase } from "../../storage/db.js";
import type { QuestionnaireQuestion } from "../types.js";

export type RatifyCandidateType = "character" | "setting" | "conflict";

export interface RatifyCandidate {
  type: RatifyCandidateType;
  name: string;
}

export interface RatifyQuestionnaire {
  id: string;
  version: string;
  tier: 2;
  targetObject: "ratify";
  candidates: RatifyCandidate[];
  questions: QuestionnaireQuestion[];
}

const markerPattern = /\[\[(人物|角色|设定|矛盾):([^\]]+)\]\]/gu;

function normalizeType(raw: string): RatifyCandidateType {
  if (raw === "人物" || raw === "角色") return "character";
  if (raw === "设定") return "setting";
  return "conflict";
}

function uniqCandidates(candidates: RatifyCandidate[]): RatifyCandidate[] {
  const seen = new Set<string>();
  const result: RatifyCandidate[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.type}:${candidate.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }
  return result;
}

function scanCandidates(chapterText: string): RatifyCandidate[] {
  const candidates: RatifyCandidate[] = [];
  for (const match of chapterText.matchAll(markerPattern)) {
    const rawType = match[1];
    const name = match[2]?.trim();
    if (!rawType || !name) continue;
    candidates.push({ type: normalizeType(rawType), name });
  }
  return uniqCandidates(candidates);
}

function existingNames(storage: StorageDatabase, bookId: string, type: RatifyCandidateType): Set<string> {
  const table = type === "character" ? "bible_character" : type === "setting" ? "bible_setting" : "bible_conflict";
  const rows = storage.sqlite.prepare(`
    SELECT "name" FROM "${table}"
    WHERE "book_id" = ? AND "deleted_at" IS NULL
  `).all(bookId) as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

export async function createRatifyQuestionnaireForChapter(input: {
  storage: StorageDatabase;
  bookId: string;
  chapterNumber: number;
  chapterText: string;
}): Promise<RatifyQuestionnaire> {
  const existingByType = {
    character: existingNames(input.storage, input.bookId, "character"),
    setting: existingNames(input.storage, input.bookId, "setting"),
    conflict: existingNames(input.storage, input.bookId, "conflict"),
  } satisfies Record<RatifyCandidateType, Set<string>>;

  const candidates = scanCandidates(input.chapterText).filter((candidate) => !existingByType[candidate.type].has(candidate.name));
  return {
    id: `ratify-questionnaire:${input.bookId}:${input.chapterNumber}`,
    version: "1.0.0",
    tier: 2,
    targetObject: "ratify",
    candidates,
    questions: candidates.map((candidate, index) => ({
      id: `ratify-${candidate.type}-${index + 1}`,
      prompt: `本章出现了「${candidate.name}」，要固化为 ${candidate.type} 吗？`,
      type: "single",
      options: ["固化", "忽略"],
      mapping: { fieldPath: `${candidate.type}.${candidate.name}` },
      defaultSkippable: true,
    })),
  };
}
