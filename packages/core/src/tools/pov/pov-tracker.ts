import type { PovCharacter, PovDashboard, PovWarning } from "./pov-types.js";

export interface BuildPovDashboardInput {
  readonly characterMatrix: string;
  readonly chapterSummaries: string;
  readonly currentChapter: number;
  readonly gapWarningThreshold?: number;
  readonly nextChapterIntent?: string;
}

interface ChapterPovEntry {
  readonly chapter: number;
  readonly pov: string;
}

export function buildPovDashboard(input: BuildPovDashboardInput): PovDashboard {
  const povNames = extractPovCharacters(input.characterMatrix);
  if (povNames.length <= 1) {
    return { characters: [], currentChapter: input.currentChapter, warnings: [] };
  }

  const entries = extractChapterPovEntries(input.chapterSummaries);
  const characters = povNames.map((name) => buildPovCharacter(name, entries, input.currentChapter));
  const warnings = buildWarnings(characters, input.gapWarningThreshold ?? 10);
  const suggestion = buildSuggestion(characters, input.nextChapterIntent);

  return {
    characters,
    currentChapter: input.currentChapter,
    warnings,
    ...(suggestion ? { suggestion } : {}),
  };
}

function extractPovCharacters(characterMatrix: string): string[] {
  const names = new Set<string>();
  for (const rawLine of characterMatrix.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || isMarkdownTableDivider(line) || /角色\s*\|\s*POV/i.test(line)) continue;

    if (line.includes("|")) {
      const cells = line.split("|").map((cell) => cell.trim()).filter(Boolean);
      const name = cells[0];
      const marker = cells.slice(1).join(" ");
      if (name && isPovMarker(marker)) names.add(name);
      continue;
    }

    const hashMatch = line.match(/[-*]?\s*([^#\s|，,：:]+).*#POV/i);
    if (hashMatch?.[1]) {
      names.add(hashMatch[1].trim());
      continue;
    }

    const labelMatch = line.match(/(?:POV|视角)\s*[：:]\s*([^，,\s]+)/i);
    if (labelMatch?.[1]) names.add(labelMatch[1].trim());
  }
  return [...names];
}

function extractChapterPovEntries(chapterSummaries: string): ChapterPovEntry[] {
  const entries: ChapterPovEntry[] = [];
  for (const rawLine of chapterSummaries.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || isMarkdownTableDivider(line) || /章节\s*\|\s*POV/i.test(line)) continue;

    if (line.includes("|")) {
      const cells = line.split("|").map((cell) => cell.trim()).filter(Boolean);
      const chapter = parseChapterNumber(cells[0] ?? "");
      const pov = cells[1] ?? "";
      if (chapter !== undefined && pov) entries.push({ chapter, pov });
      continue;
    }

    const match = line.match(/第?\s*(\d+)\s*章.*?POV\s*[：:]\s*([^，,\s]+)/i);
    if (match?.[1] && match[2]) {
      entries.push({ chapter: Number.parseInt(match[1], 10), pov: match[2].trim() });
    }
  }
  return entries;
}

function buildPovCharacter(
  name: string,
  entries: ReadonlyArray<ChapterPovEntry>,
  currentChapter: number,
): PovCharacter {
  const chapterNumbers = entries
    .filter((entry) => entry.pov.includes(name) || name.includes(entry.pov))
    .map((entry) => entry.chapter)
    .sort((left, right) => left - right);
  const lastAppearanceChapter = chapterNumbers.at(-1) ?? 0;
  return {
    name,
    totalChapters: chapterNumbers.length,
    lastAppearanceChapter,
    gapSinceLastAppearance: lastAppearanceChapter > 0 ? currentChapter - lastAppearanceChapter : currentChapter,
    chapterNumbers,
  };
}

function buildWarnings(characters: ReadonlyArray<PovCharacter>, threshold: number): PovWarning[] {
  return characters
    .filter((character) => character.gapSinceLastAppearance > threshold)
    .map((character) => ({
      characterName: character.name,
      gapChapters: character.gapSinceLastAppearance,
      message: `${character.name} 已 ${character.gapSinceLastAppearance} 章未出现`,
    }));
}

function buildSuggestion(characters: ReadonlyArray<PovCharacter>, nextChapterIntent?: string): PovDashboard["suggestion"] {
  if (characters.length === 0) return undefined;
  if (nextChapterIntent) {
    const matched = characters.find((character) => nextChapterIntent.includes(character.name));
    if (matched) {
      return { recommendedPov: matched.name, reason: "下一章意图涉及该角色" };
    }
  }
  const recommended = [...characters].sort((left, right) =>
    right.gapSinceLastAppearance - left.gapSinceLastAppearance
    || left.totalChapters - right.totalChapters
    || left.name.localeCompare(right.name, "zh-Hans-CN"),
  )[0];
  return recommended
    ? { recommendedPov: recommended.name, reason: "该 POV 间隔章数最高" }
    : undefined;
}

function isPovMarker(value: string): boolean {
  return /(^|\s)(是|yes|true|pov|主视角|视角)(\s|$)/i.test(value);
}

function parseChapterNumber(value: string): number | undefined {
  const match = value.match(/\d+/);
  if (!match?.[0]) return undefined;
  return Number.parseInt(match[0], 10);
}

function isMarkdownTableDivider(line: string): boolean {
  return /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/.test(line);
}
