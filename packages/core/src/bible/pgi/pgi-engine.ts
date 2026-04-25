import type { StorageDatabase } from "../../storage/db.js";
import { createBibleConflictRepository } from "../repositories/conflict-repo.js";

export interface PGIQuestion {
  id: string;
  prompt: string;
  type: "single";
  options: string[];
  context?: Record<string, unknown>;
}

export interface GeneratePGIQuestionsInput {
  bookId: string;
  chapter: number;
}

export interface GeneratePGIQuestionsResult {
  questions: PGIQuestion[];
  heuristicsTriggered: string[];
}

interface BibleEventRow {
  id: string;
  name: string;
  chapter_start: number | null;
  chapter_end: number | null;
  foreshadow_state: string | null;
}

export async function generatePGIQuestions(storage: StorageDatabase, input: GeneratePGIQuestionsInput): Promise<GeneratePGIQuestionsResult> {
  const questions: PGIQuestion[] = [];
  const heuristics = new Set<string>();

  const activeConflicts = await createBibleConflictRepository(storage).getActiveConflictsAtChapter(input.bookId, input.chapter);
  for (const conflict of activeConflicts.filter((entry) => entry.resolutionState === "escalating").slice(0, 5)) {
    heuristics.add("conflict-escalating");
    questions.push({
      id: `conflict-escalate:${conflict.id}`,
      prompt: `矛盾「${conflict.name}」当前处于 escalating。本章要推到 climax 吗？`,
      type: "single",
      options: ["推到 climax", "保持 escalating", "稍缓（brewing 回退）", "跳过"],
      context: { conflictId: conflict.id },
    });
  }

  if (questions.length < 5) {
    const events = storage.sqlite.prepare(`
      SELECT "id", "name", "chapter_start", "chapter_end", "foreshadow_state"
      FROM "bible_event"
      WHERE "book_id" = ? AND "deleted_at" IS NULL AND "foreshadow_state" = 'buried'
      ORDER BY COALESCE("chapter_end", "chapter_start", 0) ASC
    `).all(input.bookId) as BibleEventRow[];
    for (const event of events) {
      const plannedAt = event.chapter_end ?? event.chapter_start;
      if (!plannedAt || Math.abs(input.chapter - plannedAt) > 3) continue;
      heuristics.add("foreshadow-due");
      questions.push({
        id: `foreshadow-payoff:${event.id}`,
        prompt: `伏笔「${event.name}」预计在第 ${plannedAt} 章回收。本章要兑现吗？`,
        type: "single",
        options: ["本章兑现", "再埋 2 章", "改线（改成其他伏笔）", "跳过"],
        context: { eventId: event.id, plannedAt },
      });
      if (questions.length >= 5) break;
    }
  }

  return { questions: questions.slice(0, 5), heuristicsTriggered: [...heuristics] };
}

export function formatPGIAnswersForPrompt(answers: Record<string, unknown>): string {
  const lines = Object.entries(answers)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([id, value]) => `- ${id}：${String(value)}`);
  return lines.length === 0 ? "" : `【本章作者指示（PGI）】\n${lines.join("\n")}`;
}
