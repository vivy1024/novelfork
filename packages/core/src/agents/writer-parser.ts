import type { GenreProfile } from "../models/genre-profile.js";
import type { WriteChapterOutput } from "./writer.js";

export type ParsedWriterOutput = Omit<WriteChapterOutput, "postWriteErrors" | "postWriteWarnings">;

/**
 * Parse LLM output that uses === TAG === delimiters into structured chapter data.
 * Shared by WriterAgent (writing new chapters) and ChapterAnalyzerAgent (analyzing existing chapters).
 */
export function parseWriterOutput(
  chapterNumber: number,
  content: string,
  genreProfile: GenreProfile,
): ParsedWriterOutput {
  const extract = (tag: string): string => {
    const regex = new RegExp(
      `=== ${tag} ===\\s*([\\s\\S]*?)(?==== [A-Z_]+ ===|$)`,
    );
    const match = content.match(regex);
    return match?.[1]?.trim() ?? "";
  };

  const chapterContent = extract("CHAPTER_CONTENT");

  return {
    chapterNumber,
    title: extract("CHAPTER_TITLE") || `第${chapterNumber}章`,
    content: chapterContent,
    wordCount: chapterContent.length,
    preWriteCheck: extract("PRE_WRITE_CHECK"),
    postSettlement: extract("POST_SETTLEMENT"),
    updatedState: extract("UPDATED_STATE") || "(状态卡未更新)",
    updatedLedger: genreProfile.numericalSystem
      ? (extract("UPDATED_LEDGER") || "(账本未更新)")
      : "",
    updatedHooks: extract("UPDATED_HOOKS") || "(伏笔池未更新)",
    chapterSummary: extract("CHAPTER_SUMMARY"),
    updatedSubplots: extract("UPDATED_SUBPLOTS"),
    updatedEmotionalArcs: extract("UPDATED_EMOTIONAL_ARCS"),
    updatedCharacterMatrix: extract("UPDATED_CHARACTER_MATRIX"),
  };
}
