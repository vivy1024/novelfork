/**
 * ConsolidatorAgent — compress old chapter summaries into volume-level summaries.
 *
 * For long novels (50+ chapters), chapter-by-chapter summaries consume too many
 * tokens when injected into the writer's context. This module:
 * 1. Identifies completed volumes (all chapters written)
 * 2. LLM-compresses each volume's chapter summaries into a narrative paragraph
 * 3. Archives the detailed chapter summaries
 * 4. Keeps only the current volume's detailed summaries + volume-level compressed summaries
 *
 * This reduces context injection from ~50KB to ~5KB while preserving narrative coherence.
 */

export interface ConsolidationResult {
  volumeSummaries: string;
  archivedVolumes: number;
  retainedChapters: number;
}

export interface VolumeBoundary {
  name: string;
  startChapter: number;
  endChapter: number;
}

export interface ChapterSummaryRow {
  chapterNumber: number;
  title: string;
  summary: string;
}

/**
 * Build the consolidation prompt for a completed volume.
 */
export function buildConsolidationPrompt(
  volume: VolumeBoundary,
  summaries: ChapterSummaryRow[],
): { system: string; user: string } {
  const summaryText = summaries
    .map((s) => `第${s.chapterNumber}章 ${s.title}：${s.summary}`)
    .join("\n");

  return {
    system:
      "你是一位叙事摘要编辑。将逐章摘要压缩为一段连贯的叙述性摘要（不超过 500 字），保留关键事件、角色发展和情节推进。保持原语言。",
    user: `卷：${volume.name}（第${volume.startChapter}-${volume.endChapter}章）\n\n章节摘要：\n${summaryText}`,
  };
}

/**
 * Determine which volumes are completed given the current chapter count.
 */
export function identifyCompletedVolumes(
  boundaries: VolumeBoundary[],
  currentChapter: number,
): { completed: VolumeBoundary[]; current: VolumeBoundary | null } {
  const completed: VolumeBoundary[] = [];
  let current: VolumeBoundary | null = null;

  for (const vol of boundaries) {
    if (currentChapter >= vol.endChapter) {
      completed.push(vol);
    } else if (currentChapter >= vol.startChapter) {
      current = vol;
    }
  }

  return { completed, current };
}
