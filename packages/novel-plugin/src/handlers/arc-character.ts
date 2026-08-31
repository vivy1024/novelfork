/**
 * arc.character — 角色弧线只读状态 / 从正文同步 / LLM 精修。
 *
 * 只读状态从 ChapterStateDelta 归约；sync/refine 仍可跑正文抽取，
 * 但不再把抽取结果写成经纬 canon。手工备注留在 annotation 层。
 */

import type { RuntimeTextGenerator } from "@vivy1024/novelfork-core/plugins";
import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";
import {
  getStorageDatabase,
  loadChapterStateProjection,
  type DerivedCharacterState,
} from "@vivy1024/novelfork-core";

import type { ArcBeat, CharacterArc } from "../engine/tools/arcs/arc-types.js";
import { detectArcInconsistency, detectStagnantArc } from "../engine/tools/arcs/character-arc-tracker.js";
import { syncCharacterArcs, type ArcTrackingMode } from "../engine/tools/arcs/arc-sync.js";
import { handleChapterRead } from "./chapter-read.js";

export type ArcCharacterAction = "status" | "sync" | "refine";

export interface ArcCharacterInput {
  readonly bookId: string;
  readonly bookRoot: string;
  readonly action?: string;
  /** sync/refine：目标章号（默认最新已写章） */
  readonly chapterNumber?: number;
  /** status：只看某个角色 */
  readonly characterName?: string;
  /** refine 用 llm；sync 默认 rule */
  readonly mode?: string;
  readonly stagnantThreshold?: number;
  readonly storage?: StorageDatabase;
  readonly generateText?: RuntimeTextGenerator;
}

export interface ArcCharacterStatusItem {
  readonly id: string;
  readonly characterId: string;
  readonly characterName: string;
  readonly arcType: string;
  readonly currentPhase: string;
  readonly startingState: string;
  readonly endingState: string;
  readonly keyTurningPointsJson: string;
  readonly beatCount: number;
  readonly lastBeatChapter: number | null;
  readonly warnings: readonly string[];
  readonly layer: "derived";
}

export interface ArcCharacterResult {
  readonly ok: boolean;
  readonly bookId: string;
  readonly action: ArcCharacterAction;
  readonly chapterNumber?: number;
  readonly arcs: readonly ArcCharacterStatusItem[];
  readonly newBeats: readonly ArcBeat[];
  readonly warnings: readonly string[];
  readonly summary: string;
  readonly error?: string;
}

function trimText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseAction(value: unknown): ArcCharacterAction {
  const action = trimText(value).toLowerCase();
  return action === "sync" || action === "refine" ? action : "status";
}

function parseBeats(json: string): ArcBeat[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is ArcBeat =>
        Boolean(item) && typeof item === "object" && typeof (item as ArcBeat).chapter === "number")
      : [];
  } catch {
    return [];
  }
}

async function latestChapterNumber(bookRoot: string): Promise<number | undefined> {
  try {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const raw = await readFile(join(bookRoot, "chapters", "index.json"), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const numbers = Array.isArray(parsed)
      ? parsed.map((entry) => Number((entry as { number?: unknown }).number)).filter((n) => Number.isFinite(n) && n > 0)
      : [];
    return numbers.length > 0 ? Math.max(...numbers) : undefined;
  } catch {
    return undefined;
  }
}

function beatDirection(beat: DerivedCharacterState["beats"][number], previous?: DerivedCharacterState["beats"][number]): ArcBeat["direction"] {
  if (!previous) return "advance";
  const previousText = previous.state ?? previous.arcProgress ?? "";
  const currentText = beat.state ?? beat.arcProgress ?? "";
  if (!previousText || !currentText || previousText === currentText) return "neutral";
  if ((beat.arcProgress ?? "").includes("回退") || (beat.state ?? "").includes("失去")) return "regression";
  return "advance";
}

export function derivedCharacterToArcRecord(character: DerivedCharacterState): {
  readonly characterId: string;
  readonly arcType: string;
  readonly startingState: string;
  readonly endingState: string;
  readonly currentPosition: string;
  readonly keyTurningPointsJson: string;
} {
  const beats: ArcBeat[] = character.beats.map((beat, index) => ({
    chapter: beat.chapter,
    event: beat.state ?? beat.arcProgress ?? beat.goal ?? `第${beat.chapter}章状态`,
    change: beat.goal ?? beat.emotionalState ?? beat.arcProgress ?? beat.state ?? "",
    direction: beatDirection(beat, character.beats[index - 1]),
    source: "auto-rule",
  }));
  const first = character.beats[0];
  return {
    characterId: character.characterId,
    arcType: "positive-growth",
    startingState: first?.state ?? character.currentState ?? "",
    endingState: character.currentState ?? character.arcProgress ?? "",
    currentPosition: character.arcProgress ?? character.currentState ?? "",
    keyTurningPointsJson: JSON.stringify(beats),
  };
}

/** 汇总角色弧状态并跑一致性/停滞检测。 */
export function summarizeArcs(input: {
  readonly arcs: readonly {
    readonly characterId: string;
    readonly arcType: string;
    readonly startingState: string;
    readonly endingState: string;
    readonly currentPosition: string;
    readonly keyTurningPointsJson: string;
  }[];
  readonly names: ReadonlyMap<string, string>;
  readonly currentChapter: number;
  readonly stagnantThreshold?: number;
}): { items: ArcCharacterStatusItem[]; warnings: string[] } {
  const items: ArcCharacterStatusItem[] = [];
  const warnings: string[] = [];

  for (const record of input.arcs) {
    const beats = parseBeats(record.keyTurningPointsJson);
    const arc: CharacterArc = {
      characterId: record.characterId,
      arcType: record.arcType as CharacterArc["arcType"],
      startPoint: record.startingState,
      endPoint: record.endingState,
      currentPhase: record.currentPosition,
      beats,
    };
    const itemWarnings: string[] = [];
    const inconsistency = detectArcInconsistency(arc);
    if (inconsistency) itemWarnings.push(inconsistency.message);
    if (input.currentChapter > 0) {
      const stagnant = detectStagnantArc(arc, input.currentChapter, input.stagnantThreshold ?? 5);
      if (stagnant) itemWarnings.push(stagnant.message);
    }
    warnings.push(...itemWarnings);
    const characterName = input.names.get(record.characterId) ?? record.characterId;
    items.push({
      id: `character-arc:${record.characterId}`,
      characterId: record.characterId,
      characterName,
      arcType: record.arcType,
      currentPhase: record.currentPosition,
      startingState: record.startingState,
      endingState: record.endingState,
      keyTurningPointsJson: record.keyTurningPointsJson,
      beatCount: beats.length,
      lastBeatChapter: beats.length > 0 ? Math.max(...beats.map((beat) => beat.chapter)) : null,
      warnings: itemWarnings,
      layer: "derived",
    });
  }

  return { items, warnings };
}

export async function handleArcCharacter(input: ArcCharacterInput): Promise<ArcCharacterResult> {
  const bookId = trimText(input.bookId);
  const action = parseAction(input.action);
  const base = {
    bookId,
    action,
    arcs: [] as ArcCharacterStatusItem[],
    newBeats: [] as ArcBeat[],
    warnings: [] as string[],
  };

  if (!bookId) return { ...base, ok: false, summary: "缺少 bookId。", error: "missing-book-id" };
  if (!trimText(input.bookRoot)) {
    return { ...base, ok: false, summary: "缺少可信 bookRoot。", error: "missing-book-root" };
  }

  const storage = input.storage ?? getStorageDatabase();
  const projection = loadChapterStateProjection(storage, bookId);
  const names = new Map(projection.characters.map((item) => [item.characterId, item.name ?? item.characterId] as const));

  const latest = await latestChapterNumber(input.bookRoot);
  const chapterNumber = typeof input.chapterNumber === "number" && input.chapterNumber > 0
    ? Math.trunc(input.chapterNumber)
    : latest;

  const newBeats: ArcBeat[] = [];
  const syncWarnings: string[] = [];
  let llmRefined = false;

  if (action === "sync" || action === "refine") {
    if (!chapterNumber) {
      return { ...base, ok: false, summary: "没有可用章节，无法同步弧线。", error: "no-chapters" };
    }
    const chapter = await handleChapterRead(
      { bookId, chapterNumber },
      undefined,
      { bookRoot: input.bookRoot, storage },
    );
    if (!chapter.ok || !chapter.data?.content?.trim()) {
      return {
        ...base,
        ok: false,
        chapterNumber,
        summary: chapter.summary || `第 ${chapterNumber} 章正文不可读。`,
        error: chapter.error ?? "chapter-not-found",
      };
    }
    const requestedMode = trimText(input.mode).toLowerCase();
    const mode: ArcTrackingMode = action === "refine"
      ? "llm"
      : (requestedMode === "llm" ? "llm" : "rule");
    try {
      const synced = await syncCharacterArcs({
        bookId,
        chapterNumber,
        chapterContent: chapter.data.content,
        mode,
        storage,
        generateText: input.generateText,
      });
      newBeats.push(...synced.beats);
      syncWarnings.push(...synced.warnings);
      llmRefined = synced.refinedByLlm;
    } catch (error) {
      syncWarnings.push(`弧线同步失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const targetName = trimText(input.characterName);
  const filtered = (targetName
    ? projection.characters.filter((character) => (character.name ?? character.characterId).includes(targetName))
    : projection.characters
  ).map(derivedCharacterToArcRecord);

  const { items, warnings } = summarizeArcs({
    arcs: filtered,
    names,
    currentChapter: chapterNumber ?? 0,
    ...(typeof input.stagnantThreshold === "number" ? { stagnantThreshold: input.stagnantThreshold } : {}),
  });

  const allWarnings = [...syncWarnings, ...warnings];
  const summaryParts = [
    action === "status"
      ? "角色弧状态"
      : action === "sync"
        ? "弧线已按规则同步"
        : llmRefined
          ? "弧线已 LLM 精修"
          : "弧线已按规则同步（LLM 精修未完成）",
    `角色弧 ${items.length} 条`,
    action !== "status" ? `新增 beats ${newBeats.length} 条` : "",
    allWarnings.length > 0 ? `告警 ${allWarnings.length} 条` : "无告警",
  ].filter(Boolean);

  return {
    ok: true,
    bookId,
    action,
    ...(chapterNumber ? { chapterNumber } : {}),
    arcs: items,
    newBeats,
    warnings: allWarnings,
    summary: summaryParts.join("；"),
  };
}
