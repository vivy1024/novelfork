import type { DialogueAnalysis, DialogueChapterType } from "./dialogue-types.js";

const DIALOGUE_REGEX = /(?:(.{1,6}?)(?:低声道|大声道|喝骂道|冷笑道|冷声道|沉声道|说道|喝道|笑道|怒道|喊道|叫道|问道|答道|道)\s*[：:]\s*["“”「]([^"“”」]+)["“”」])|["“”「]([^"“”」]{2,})["“”」]|"([^"]{2,})"/g;

const REFERENCE_RANGES: ReadonlyArray<{
  readonly keywords: ReadonlyArray<string>;
  readonly range: { readonly min: number; readonly max: number };
}> = [
  { keywords: ["battle", "combat", "fight", "战斗", "动作"], range: { min: 0.1, max: 0.25 } },
  { keywords: ["daily", "social", "slice", "日常", "社交"], range: { min: 0.3, max: 0.5 } },
  { keywords: ["transition", "description", "过渡", "描写"], range: { min: 0.15, max: 0.35 } },
  { keywords: ["mystery", "detective", "悬疑", "推理"], range: { min: 0.25, max: 0.4 } },
];

export function analyzeDialogue(text: string, chapterType?: DialogueChapterType): DialogueAnalysis {
  const matches = extractDialogueMatches(text);
  const totalWords = countContentChars(removeNonDialogueWhenPureDialogue(text, matches));
  const dialogueWords = matches.reduce((sum, match) => sum + countContentChars(match.line), 0);
  const dialogueRatio = totalWords > 0 ? round3(Math.min(1, dialogueWords / totalWords)) : 0;
  const referenceRange = resolveReferenceRange(chapterType);
  const isHealthy = dialogueRatio >= referenceRange.min && dialogueRatio <= referenceRange.max;
  const characterDialogue = buildCharacterDialogue(matches, dialogueWords);
  const issues = buildIssues(dialogueRatio, referenceRange);

  return {
    totalWords,
    dialogueWords,
    dialogueRatio,
    ...(chapterType ? { chapterType } : {}),
    referenceRange,
    isHealthy,
    characterDialogue,
    issues,
  };
}

function extractDialogueMatches(text: string): Array<{ readonly speaker?: string; readonly line: string }> {
  const matches: Array<{ readonly speaker?: string; readonly line: string }> = [];
  let match: RegExpExecArray | null;
  DIALOGUE_REGEX.lastIndex = 0;
  while ((match = DIALOGUE_REGEX.exec(text)) !== null) {
    const speaker = match[1]?.trim();
    const line = (match[2] ?? match[3] ?? match[4] ?? "").trim();
    if (!line) continue;
    matches.push(speaker ? { speaker, line } : { line });
  }
  return matches;
}

function buildCharacterDialogue(
  matches: ReadonlyArray<{ readonly speaker?: string; readonly line: string }>,
  dialogueWords: number,
): DialogueAnalysis["characterDialogue"] {
  const bySpeaker = new Map<string, { wordCount: number; lineCount: number }>();
  for (const match of matches) {
    if (!match.speaker) continue;
    const existing = bySpeaker.get(match.speaker) ?? { wordCount: 0, lineCount: 0 };
    bySpeaker.set(match.speaker, {
      wordCount: existing.wordCount + countContentChars(match.line),
      lineCount: existing.lineCount + 1,
    });
  }
  return [...bySpeaker.entries()]
    .map(([name, stats]) => ({
      name,
      wordCount: stats.wordCount,
      lineCount: stats.lineCount,
      ratio: dialogueWords > 0 ? round4(stats.wordCount / dialogueWords) : 0,
    }))
    .sort((left, right) => right.wordCount - left.wordCount || left.name.localeCompare(right.name, "zh-Hans-CN"));
}

function resolveReferenceRange(chapterType?: DialogueChapterType): { readonly min: number; readonly max: number } {
  const normalized = String(chapterType ?? "").toLowerCase();
  const matched = REFERENCE_RANGES.find((entry) => entry.keywords.some((keyword) => normalized.includes(keyword)));
  return matched?.range ?? { min: 0.15, max: 0.35 };
}

function buildIssues(
  ratio: number,
  range: { readonly min: number; readonly max: number },
): string[] {
  if (ratio === 0) return [];
  if (ratio < range.min) return [`对话比例 ${(ratio * 100).toFixed(1)}% 低于参考范围。`];
  if (ratio > range.max) return [`对话比例 ${(ratio * 100).toFixed(1)}% 高于参考范围。`];
  return [];
}

function removeNonDialogueWhenPureDialogue(
  text: string,
  matches: ReadonlyArray<{ readonly line: string }>,
): string {
  const content = text.trim();
  if (!content) return "";
  const withoutDialoguePunctuation = content.replace(/[\s"“”「」]/g, "");
  const dialogueOnly = matches.map((match) => match.line).join("").replace(/\s/g, "");
  return withoutDialoguePunctuation === dialogueOnly ? dialogueOnly : text;
}

function countContentChars(text: string): number {
  return text.replace(/[\s\n\r"“”「」『』，,。！？!?；;：:、]/g, "").length;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
