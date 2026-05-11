import type { StorageDatabase } from "../../storage/db.js";
import { createJingweiConflictRepository } from "../repositories/conflict-repo.js";
import { createJingweiCharacterArcRepository } from "../repositories/character-arc-repo.js";

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
  /** 大纲计划总章数（用于偏离检测） */
  targetChapters?: number;
  /** 当前已写章数 */
  currentChapterCount?: number;
}

export interface GeneratePGIQuestionsResult {
  questions: PGIQuestion[];
  heuristicsTriggered: string[];
}

interface JingweiEventRow {
  id: string;
  name: string;
  chapter_start: number | null;
  chapter_end: number | null;
  foreshadow_state: string | null;
}

export async function generatePGIQuestions(storage: StorageDatabase, input: GeneratePGIQuestionsInput): Promise<GeneratePGIQuestionsResult> {
  const questions: PGIQuestion[] = [];
  const heuristics = new Set<string>();

  // 规则 1：矛盾 escalating
  const activeConflicts = await createJingweiConflictRepository(storage).getActiveConflictsAtChapter(input.bookId, input.chapter);
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

  // 规则 2：伏笔到期
  if (questions.length < 5) {
    const events = storage.sqlite.prepare(`
      SELECT "id", "name", "chapter_start", "chapter_end", "foreshadow_state"
      FROM "bible_event"
      WHERE "book_id" = ? AND "deleted_at" IS NULL AND "foreshadow_state" = 'buried'
      ORDER BY COALESCE("chapter_end", "chapter_start", 0) ASC
    `).all(input.bookId) as JingweiEventRow[];
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

  // 规则 3：角色弧线停滞（连续 5+ 章无推进）
  if (questions.length < 5) {
    const arcRepo = createJingweiCharacterArcRepository(storage);
    const arcs = await arcRepo.listByBook(input.bookId);
    for (const arc of arcs) {
      const lastProgressChapter = (arc as { lastProgressChapter?: number }).lastProgressChapter ?? 0;
      if (input.chapter - lastProgressChapter >= 5) {
        heuristics.add("character-arc-stalled");
        questions.push({
          id: `arc-stalled:${arc.id}`,
          prompt: `角色弧线「${arc.characterId}」已 ${input.chapter - lastProgressChapter} 章未推进。本章要推动角色成长吗？`,
          type: "single",
          options: ["推进弧线", "保持现状（有意为之）", "跳过"],
          context: { arcId: arc.id, stalledChapters: input.chapter - lastProgressChapter },
        });
        if (questions.length >= 5) break;
      }
    }
  }

  // 规则 4：大纲偏离（进度超出计划 20%+）
  if (questions.length < 5 && input.targetChapters && input.currentChapterCount) {
    const expectedProgress = input.chapter / input.targetChapters;
    const actualProgress = input.currentChapterCount / input.targetChapters;
    if (actualProgress > 1.2 || (expectedProgress > 0.8 && actualProgress < 0.5)) {
      heuristics.add("outline-deviation");
      const deviation = actualProgress > 1.2
        ? `已写 ${input.currentChapterCount} 章，超出计划 ${input.targetChapters} 章的 ${Math.round((actualProgress - 1) * 100)}%`
        : `进度落后：计划已到 ${Math.round(expectedProgress * 100)}%，实际只完成 ${Math.round(actualProgress * 100)}%`;
      questions.push({
        id: "outline-deviation",
        prompt: `大纲偏离警告：${deviation}。是否需要调整大纲？`,
        type: "single",
        options: ["调整大纲（扩展/缩减）", "保持当前节奏", "跳过"],
        context: { targetChapters: input.targetChapters, currentChapterCount: input.currentChapterCount },
      });
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
