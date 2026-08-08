import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import {
  ChapterSummariesStateSchema,
  CurrentStateStateSchema,
  HooksStateSchema,
  StateManifestSchema,
  type ChapterSummariesState,
  type CurrentStateState,
  type HookStatus,
  type StateManifest,
} from "../models/runtime-state.js";
import type { Fact, StoredHook } from "./memory-db.js";
import { normalizeHookPayoffTiming } from "../utils/hook-lifecycle.js";
import {
  inferFactSubject,
  isCurrentChapterLabel,
  isStateTableHeaderRow,
  normalizeHookId,
  parseChapterSummariesMarkdown,
  parseInteger,
  parseMarkdownTableRows,
} from "../utils/story-markdown.js";

export {
  normalizeHookId,
  parseChapterSummariesMarkdown,
  parseCurrentStateFacts,
  parsePendingHooksMarkdown,
} from "../utils/story-markdown.js";

export interface BootstrapStructuredStateResult {
  readonly createdFiles: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
  readonly manifest: StateManifest;
}

interface MarkdownBootstrapState {
  readonly summariesState: ChapterSummariesState;
  readonly hooksState: { readonly hooks: ReadonlyArray<StoredHook> };
  readonly currentState: CurrentStateState;
  readonly durableStoryProgress: number;
}

export async function bootstrapStructuredStateFromMarkdown(params: {
  readonly bookDir: string;
  readonly fallbackChapter?: number;
}): Promise<BootstrapStructuredStateResult> {
  const storyDir = join(params.bookDir, "story");
  const stateDir = join(storyDir, "state");
  const manifestPath = join(stateDir, "manifest.json");
  const currentStatePath = join(stateDir, "current_state.json");
  const hooksPath = join(stateDir, "hooks.json");
  const summariesPath = join(stateDir, "chapter_summaries.json");

  await mkdir(stateDir, { recursive: true });

  const createdFiles: string[] = [];
  const warnings: string[] = [];
  const existingManifest = await loadJsonIfValid(manifestPath, StateManifestSchema, warnings, "manifest.json");
  const language = existingManifest?.language ?? await resolveRuntimeLanguage(params.bookDir);
  const markdownState = await loadMarkdownBootstrapState({
    bookDir: params.bookDir,
    storyDir,
    fallbackChapter: params.fallbackChapter ?? 0,
    warnings,
  });

  const summariesState = await loadOrBootstrapSummaries({
    storyDir,
    statePath: summariesPath,
    createdFiles,
    warnings,
    bootstrapState: markdownState.summariesState,
  });
  const hooksState = await loadOrBootstrapHooks({
    storyDir,
    statePath: hooksPath,
    createdFiles,
    warnings,
    bootstrapState: markdownState.hooksState,
  });
  const currentState = await loadOrBootstrapCurrentState({
    storyDir,
    statePath: currentStatePath,
    fallbackChapter: markdownState.durableStoryProgress,
    createdFiles,
    warnings,
    bootstrapState: markdownState.currentState,
    clampChapter: markdownState.durableStoryProgress,
  });
  // Only trust durable artifact progress (chapter files + index).
  // currentState.chapter comes from markdown which can contain
  // hallucinated numbers (e.g. year 1988 parsed as chapter 1988).
  const derivedProgress = markdownState.durableStoryProgress;
  if ((existingManifest?.lastAppliedChapter ?? 0) > derivedProgress) {
    appendWarning(
      warnings,
      `manifest lastAppliedChapter normalized from ${existingManifest?.lastAppliedChapter ?? 0} to ${derivedProgress}`,
    );
  }

  const manifest = StateManifestSchema.parse({
    schemaVersion: 2,
    language,
    lastAppliedChapter: derivedProgress,
    projectionVersion: existingManifest?.projectionVersion ?? 1,
    migrationWarnings: uniqueStrings([
      ...(existingManifest?.migrationWarnings ?? []),
      ...warnings,
    ]),
  });

  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
  if (!existingManifest) {
    createdFiles.push("manifest.json");
  }

  return {
    createdFiles,
    warnings: manifest.migrationWarnings,
    manifest,
  };
}

export async function rewriteStructuredStateFromMarkdown(params: {
  readonly bookDir: string;
  readonly fallbackChapter?: number;
}): Promise<BootstrapStructuredStateResult> {
  const storyDir = join(params.bookDir, "story");
  const stateDir = join(storyDir, "state");
  const manifestPath = join(stateDir, "manifest.json");
  const currentStatePath = join(stateDir, "current_state.json");
  const hooksPath = join(stateDir, "hooks.json");
  const summariesPath = join(stateDir, "chapter_summaries.json");

  await mkdir(stateDir, { recursive: true });

  const warnings: string[] = [];
  const existingManifest = await loadJsonIfValid(manifestPath, StateManifestSchema, warnings, "manifest.json");
  const language = existingManifest?.language ?? await resolveRuntimeLanguage(params.bookDir);
  const markdownState = await loadMarkdownBootstrapState({
    bookDir: params.bookDir,
    storyDir,
    fallbackChapter: params.fallbackChapter ?? 0,
    warnings,
  });
  const summariesState = markdownState.summariesState;
  const hooksState = markdownState.hooksState;
  // 与 manifest.lastAppliedChapter 保持同一 durable 上限，避免重建后仍然超前。
  const currentState = markdownState.currentState.chapter > markdownState.durableStoryProgress
    ? clampChapterValue(markdownState.currentState, markdownState.durableStoryProgress, warnings)
    : markdownState.currentState;

  const manifest = StateManifestSchema.parse({
    schemaVersion: 2,
    language,
    lastAppliedChapter: markdownState.durableStoryProgress,
    projectionVersion: existingManifest?.projectionVersion ?? 1,
    migrationWarnings: uniqueStrings([
      ...(existingManifest?.migrationWarnings ?? []),
      ...warnings,
    ]),
  });

  await Promise.all([
    writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf-8"),
    writeFile(currentStatePath, JSON.stringify(currentState, null, 2), "utf-8"),
    writeFile(hooksPath, JSON.stringify(hooksState, null, 2), "utf-8"),
    writeFile(summariesPath, JSON.stringify(summariesState, null, 2), "utf-8"),
  ]);

  return {
    createdFiles: [],
    warnings: manifest.migrationWarnings,
    manifest,
  };
}

async function loadOrBootstrapCurrentState(params: {
  readonly storyDir: string;
  readonly statePath: string;
  readonly fallbackChapter: number;
  readonly createdFiles: string[];
  readonly warnings: string[];
  readonly bootstrapState?: CurrentStateState;
  readonly forceBootstrapFromMarkdown?: boolean;
  /**
   * durable 章节进度上限。已落盘的 current_state.chapter 只能来自 markdown，
   * 可能是幻觉数字或上一次写入中断后的残留；超过 durable 进度时向下钳制，
   * 否则 validateRuntimeState 会以 current_state_ahead_of_manifest 直接抛错，
   * 让整本书无法加载（写章链路会连带丢弃已生成正文）。
   */
  readonly clampChapter?: number;
}): Promise<CurrentStateState> {
  if (!params.forceBootstrapFromMarkdown) {
    const existing = await loadJsonIfValid(
      params.statePath,
      CurrentStateStateSchema,
      params.warnings,
      "current_state.json",
    );
    if (existing) {
      return clampCurrentStateChapter({
        currentState: existing,
        statePath: params.statePath,
        clampChapter: params.clampChapter,
        warnings: params.warnings,
      });
    }
  }

  const bootstrapped = params.bootstrapState ?? await loadMarkdownCurrentState({
    storyDir: params.storyDir,
    fallbackChapter: params.fallbackChapter,
    warnings: params.warnings,
  });
  // markdown 解析出的章号同样可能超前（幻觉数字/中断残留），落盘前先钳制。
  const currentState = params.clampChapter !== undefined && bootstrapped.chapter > params.clampChapter
    ? clampChapterValue(bootstrapped, params.clampChapter, params.warnings)
    : bootstrapped;
  const existed = await pathExists(params.statePath);
  await writeFile(params.statePath, JSON.stringify(currentState, null, 2), "utf-8");
  if (!existed) {
    params.createdFiles.push("current_state.json");
  }
  return currentState;
}

/** 生成钳制后的 current state 并记录归一化 warning（不落盘）。 */
function clampChapterValue(
  currentState: CurrentStateState,
  limit: number,
  warnings: string[],
): CurrentStateState {
  appendWarning(
    warnings,
    `current_state chapter normalized from ${currentState.chapter} to ${limit}`,
  );
  return CurrentStateStateSchema.parse({ ...currentState, chapter: limit });
}

/**
 * 把已落盘的 current_state.chapter 钳制到 durable 章节进度。
 * 返回值保证满足 currentState.chapter <= manifest.lastAppliedChapter 不变式。
 */
async function clampCurrentStateChapter(params: {
  readonly currentState: CurrentStateState;
  readonly statePath: string;
  readonly clampChapter?: number;
  readonly warnings: string[];
}): Promise<CurrentStateState> {
  const limit = params.clampChapter;
  if (limit === undefined || params.currentState.chapter <= limit) {
    return params.currentState;
  }
  const clamped = clampChapterValue(params.currentState, limit, params.warnings);
  await writeFile(params.statePath, JSON.stringify(clamped, null, 2), "utf-8");
  return clamped;
}

async function loadOrBootstrapHooks(params: {
  readonly storyDir: string;
  readonly statePath: string;
  readonly createdFiles: string[];
  readonly warnings: string[];
  readonly bootstrapState?: { readonly hooks: ReadonlyArray<StoredHook> };
  readonly forceBootstrapFromMarkdown?: boolean;
}) {
  if (!params.forceBootstrapFromMarkdown) {
    const existing = await loadJsonIfValid(
      params.statePath,
      HooksStateSchema,
      params.warnings,
      "hooks.json",
    );
    if (existing) {
      return existing;
    }
  }

  const hooksState = params.bootstrapState ?? await loadMarkdownHooksState({
    storyDir: params.storyDir,
    warnings: params.warnings,
  });
  const existed = await pathExists(params.statePath);
  await writeFile(params.statePath, JSON.stringify(hooksState, null, 2), "utf-8");
  if (!existed) {
    params.createdFiles.push("hooks.json");
  }
  return hooksState;
}

async function loadOrBootstrapSummaries(params: {
  readonly storyDir: string;
  readonly statePath: string;
  readonly createdFiles: string[];
  readonly warnings: string[];
  readonly bootstrapState?: ChapterSummariesState;
  readonly forceBootstrapFromMarkdown?: boolean;
}): Promise<ChapterSummariesState> {
  if (!params.forceBootstrapFromMarkdown) {
    const existing = await loadJsonIfValid(
      params.statePath,
      ChapterSummariesStateSchema,
      params.warnings,
      "chapter_summaries.json",
    );
    if (existing) {
      // Always deduplicate even when loading from JSON (stale data may have duplicates)
      const dedupedExisting = deduplicateSummaryRows(existing.rows);
      if (dedupedExisting.length < existing.rows.length) {
        const repaired = ChapterSummariesStateSchema.parse({ rows: dedupedExisting });
        await writeFile(params.statePath, JSON.stringify(repaired, null, 2), "utf-8");
        return repaired;
      }
      return existing;
    }
  }

  const summariesState = params.bootstrapState ?? await loadMarkdownSummariesState(params.storyDir);
  const existed = await pathExists(params.statePath);
  await writeFile(params.statePath, JSON.stringify(summariesState, null, 2), "utf-8");
  if (!existed) {
    params.createdFiles.push("chapter_summaries.json");
  }
  return summariesState;
}

function parsePendingHooksStateMarkdown(markdown: string, warnings: string[]) {
  const tableRows = parseMarkdownTableRows(markdown)
    .filter((row) => (row[0] ?? "").toLowerCase() !== "hook_id");

  if (tableRows.length > 0) {
    return HooksStateSchema.parse({
      hooks: tableRows
        .filter((row) => normalizeHookId(row[0]).length > 0)
        .map((row) => {
          const hookId = normalizeHookId(row[0]);
          const legacyShape = row.length < 8;
          return {
            hookId,
            startChapter: parseStrictIntegerWithWarning(row[1], warnings, `${hookId}:startChapter`),
            type: row[2] ?? "unspecified",
            status: normalizeHookStatus(row[3], warnings, hookId),
            lastAdvancedChapter: parseStrictIntegerWithWarning(row[4], warnings, `${hookId}:lastAdvancedChapter`),
            expectedPayoff: row[5] ?? "",
            payoffTiming: legacyShape ? undefined : normalizeHookPayoffTiming(row[6]),
            notes: legacyShape ? (row[6] ?? "") : (row[7] ?? ""),
          };
        }),
    });
  }

  return HooksStateSchema.parse({
    hooks: markdown
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("-"))
      .map((line) => line.replace(/^-\s*/, ""))
      .filter(Boolean)
      .map((line, index) => ({
        hookId: `hook-${index + 1}`,
        startChapter: 0,
        type: "unspecified",
        status: "open" as HookStatus,
        lastAdvancedChapter: 0,
        expectedPayoff: "",
        payoffTiming: undefined,
        notes: line,
      })),
  });
}

function parseCurrentStateStateMarkdown(
  markdown: string,
  fallbackChapter: number,
  warnings: string[],
): CurrentStateState {
  const tableRows = parseMarkdownTableRows(markdown);
  const fieldValueRows = tableRows
    .filter((row) => row.length >= 2)
    .filter((row) => !isStateTableHeaderRow(row));

  if (fieldValueRows.length > 0) {
    const chapterFromTable = fieldValueRows.find((row) => isCurrentChapterLabel(row[0] ?? ""));
    const stateChapter = parseIntegerWithFallback(
      chapterFromTable?.[1],
      fallbackChapter,
      warnings,
      "current_state:chapter",
    );

    return CurrentStateStateSchema.parse({
      chapter: stateChapter,
      facts: fieldValueRows
        .filter((row) => !isCurrentChapterLabel(row[0] ?? ""))
        .flatMap((row): Fact[] => {
          const label = (row[0] ?? "").trim();
          const value = (row[1] ?? "").trim();
          if (!label || !value) return [];

          return [{
            subject: inferFactSubject(label),
            predicate: label,
            object: value,
            validFromChapter: stateChapter,
            validUntilChapter: null,
            sourceChapter: stateChapter,
          }];
        }),
    });
  }

  const bulletFacts = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-"))
    .map((line) => line.replace(/^-\s*/, ""))
    .filter(Boolean);

  return CurrentStateStateSchema.parse({
    chapter: Math.max(0, fallbackChapter),
    facts: bulletFacts.map((line, index) => ({
      subject: "current_state",
      predicate: `note_${index + 1}`,
      object: line,
      validFromChapter: Math.max(0, fallbackChapter),
      validUntilChapter: null,
      sourceChapter: Math.max(0, fallbackChapter),
    })),
  });
}

async function resolveRuntimeLanguage(bookDir: string): Promise<"zh" | "en"> {
  try {
    const raw = await readFile(join(bookDir, "book.json"), "utf-8");
    const parsed = JSON.parse(raw) as { language?: unknown };
    return parsed.language === "zh" ? "zh" : "en";
  } catch {
    return "en";
  }
}

export interface ChapterFileEntry {
  readonly chapterNumber: number;
  readonly path: string;
  /** Relative to the chapters directory, using `/` separators. */
  readonly relativePath: string;
}

/**
 * Recursively lists persisted chapter markdown files under `chapters/`.
 * The chapter number comes from the filename, while an index fileName is
 * preferred by resolveChapterFilePath/resolveChapterFilePaths when available.
 */
export async function listChapterFiles(chaptersDir: string): Promise<ReadonlyArray<ChapterFileEntry>> {
  const files: ChapterFileEntry[] = [];

  const walk = async (directory: string, relativeDirectory: string): Promise<void> => {
    let entries: Awaited<ReturnType<typeof readdir>>;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"))) {
      if (entry.name === "index.json" || entry.name === "_discarded") continue;
      const nextRelativePath = relativeDirectory
        ? join(relativeDirectory, entry.name)
        : entry.name;
      const nextPath = join(directory, entry.name);

      if (entry.isDirectory()) {
        await walk(nextPath, nextRelativePath);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;

      const chapterNumber = parseChapterNumberFromFileName(entry.name);
      if (chapterNumber === null) continue;
      files.push({
        chapterNumber,
        path: nextPath,
        relativePath: nextRelativePath.replaceAll("\\", "/"),
      });
    }
  };

  await walk(chaptersDir, "");
  return files.sort(
    (left, right) => left.chapterNumber - right.chapterNumber
      || left.relativePath.localeCompare(right.relativePath, "zh-CN"),
  );
}

/**
 * Resolves every file belonging to a chapter. The index fileName is returned
 * first when it points to an existing file; recursive filename parsing fills
 * in legacy or duplicate files that the index does not describe.
 */
export async function resolveChapterFilePaths(
  chaptersDir: string,
  chapterNumber: number,
): Promise<ReadonlyArray<string>> {
  const paths = new Set<string>();
  const indexedPath = await resolveIndexedChapterFilePath(chaptersDir, chapterNumber);
  if (indexedPath) paths.add(indexedPath);

  const scannedFiles = await listChapterFiles(chaptersDir);
  for (const file of scannedFiles) {
    if (file.chapterNumber === chapterNumber) paths.add(file.path);
  }
  return [...paths];
}

/** Resolves the preferred readable file for a chapter, or null if absent. */
export async function resolveChapterFilePath(
  chaptersDir: string,
  chapterNumber: number,
): Promise<string | null> {
  const paths = await resolveChapterFilePaths(chaptersDir, chapterNumber);
  return paths[0] ?? null;
}

function parseChapterNumberFromFileName(fileName: string): number | null {
  const match = /^(\d{1,9})[_-].+\.md$/iu.exec(fileName);
  if (!match) return null;
  const chapterNumber = Number(match[1]);
  return Number.isSafeInteger(chapterNumber) && chapterNumber > 0
    ? chapterNumber
    : null;
}

async function resolveIndexedChapterFilePath(
  chaptersDir: string,
  chapterNumber: number,
): Promise<string | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(join(chaptersDir, "index.json"), "utf-8"));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const entry = parsed.find((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
    return (candidate as Record<string, unknown>).number === chapterNumber;
  });
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;

  const fileName = (entry as Record<string, unknown>).fileName;
  if (typeof fileName !== "string" || !fileName.trim()) return null;
  const candidatePath = resolveChapterIndexFilePath(chaptersDir, fileName);
  if (!candidatePath) return null;

  try {
    const fileStat = await stat(candidatePath);
    return fileStat.isFile() ? candidatePath : null;
  } catch {
    return null;
  }
}

function resolveChapterIndexFilePath(chaptersDir: string, fileName: string): string | null {
  let normalized = fileName.trim().replaceAll("\\", "/");
  if (normalized.startsWith("chapters/")) normalized = normalized.slice("chapters/".length);
  normalized = normalized.replace(/^\/+|\/+$/gu, "");
  if (!normalized || normalized.includes("\0") || normalized.split("/").includes("..")) {
    return null;
  }
  if (!normalized.toLowerCase().endsWith(".md")) return null;

  const candidatePath = join(chaptersDir, ...normalized.split("/"));
  const candidateRelativePath = relative(chaptersDir, candidatePath);
  if (
    !candidateRelativePath
    || candidateRelativePath === ".."
    || candidateRelativePath.startsWith(`..${sep}`)
    || isAbsolute(candidateRelativePath)
  ) {
    return null;
  }
  return candidatePath;
}

export async function resolveDurableStoryProgress(params: {
  readonly bookDir: string;
  readonly fallbackChapter?: number;
}): Promise<number> {
  const explicitFallback = normalizeExplicitChapter(params.fallbackChapter);
  const durableArtifactProgress = await resolveContiguousArtifactChapterProgress(params.bookDir);
  return Math.max(durableArtifactProgress, explicitFallback);
}

async function loadJsonIfValid<T>(
  path: string,
  schema: { parse(value: unknown): T },
  warnings: string[],
  fileLabel: string,
): Promise<T | null> {
  try {
    const raw = await readFile(path, "utf-8");
    return schema.parse(JSON.parse(raw));
  } catch (error) {
    const message = String(error);
    if (!/ENOENT/.test(message)) {
      appendWarning(warnings, `${fileLabel} invalid, rebuilt from markdown`);
    }
    return null;
  }
}

async function loadMarkdownBootstrapState(params: {
  readonly bookDir: string;
  readonly storyDir: string;
  readonly fallbackChapter: number;
  readonly warnings: string[];
}): Promise<MarkdownBootstrapState> {
  const summariesState = await loadMarkdownSummariesState(params.storyDir);
  const hooksState = await loadMarkdownHooksState({
    storyDir: params.storyDir,
    warnings: params.warnings,
  });
  const explicitFallback = normalizeExplicitChapter(params.fallbackChapter);
  const durableArtifactProgress = await resolveContiguousArtifactChapterProgress(params.bookDir);
  const authoritativeProgress = Math.max(explicitFallback, durableArtifactProgress);
  const currentState = await loadMarkdownCurrentState({
    storyDir: params.storyDir,
    fallbackChapter: authoritativeProgress,
    warnings: params.warnings,
  });

  return {
    summariesState,
    hooksState,
    currentState,
    durableStoryProgress: authoritativeProgress,
  };
}

async function loadMarkdownSummariesState(storyDir: string): Promise<ChapterSummariesState> {
  const markdown = await readFile(join(storyDir, "chapter_summaries.md"), "utf-8").catch(() => "");
  const rawRows = parseChapterSummariesMarkdown(markdown);
  return ChapterSummariesStateSchema.parse({
    rows: deduplicateSummaryRows(rawRows),
  });
}

async function loadMarkdownHooksState(params: {
  readonly storyDir: string;
  readonly warnings: string[];
}) {
  const markdown = await readFile(join(params.storyDir, "pending_hooks.md"), "utf-8").catch(() => "");
  return parsePendingHooksStateMarkdown(markdown, params.warnings);
}

async function loadMarkdownCurrentState(params: {
  readonly storyDir: string;
  readonly fallbackChapter: number;
  readonly warnings: string[];
}): Promise<CurrentStateState> {
  const markdown = await readFile(join(params.storyDir, "current_state.md"), "utf-8").catch(() => "");
  return parseCurrentStateStateMarkdown(markdown, params.fallbackChapter, params.warnings);
}

async function resolveContiguousArtifactChapterProgress(bookDir: string): Promise<number> {
  const chapterNumbers = await loadDurableArtifactChapterNumbers(bookDir);
  return resolveContiguousChapterPrefix(chapterNumbers);
}

async function loadDurableArtifactChapterNumbers(bookDir: string): Promise<number[]> {
  const chaptersDir = join(bookDir, "chapters");
  const indexPath = join(chaptersDir, "index.json");
  const [indexChapters, fileChapters] = await Promise.all([
    readFile(indexPath, "utf-8")
      .then((raw) => {
        const parsed = JSON.parse(raw) as Array<{ number?: unknown }>;
        return parsed
          .map((entry) => entry?.number)
          .filter((entry): entry is number => typeof entry === "number" && Number.isInteger(entry) && entry > 0);
      })
      .catch(() => [] as number[]),
    listChapterFiles(chaptersDir).then((entries) => entries.map((entry) => entry.chapterNumber)),
  ]);
  return [...indexChapters, ...fileChapters];
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function deduplicateSummaryRows<T extends { chapter: number }>(rows: ReadonlyArray<T>): T[] {
  const byChapter = new Map<number, T>();
  for (const row of rows) {
    byChapter.set(row.chapter, row);
  }
  return [...byChapter.values()].sort((a, b) => a.chapter - b.chapter);
}

export function resolveContiguousChapterPrefix(chapterNumbers: ReadonlyArray<number>): number {
  const chapters = new Set(
    chapterNumbers.filter((chapter): chapter is number => Number.isInteger(chapter) && chapter > 0),
  );
  let contiguousChapter = 0;
  while (chapters.has(contiguousChapter + 1)) {
    contiguousChapter += 1;
  }
  return contiguousChapter;
}

function normalizeHookStatus(value: string | undefined, warnings: string[], hookId: string): HookStatus {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) return "open";
  if (/(resolved|closed|done|已回收|回收|完成)/i.test(normalized)) return "resolved";
  if (/(deferred|paused|hold|搁置|延后|延期)/i.test(normalized)) return "deferred";
  if (/(progress|active|推进|进行中)/i.test(normalized)) return "progressing";
  if (/(open|pending|待定|未回收)/i.test(normalized)) return "open";
  appendWarning(warnings, `${hookId}:status normalized from "${value ?? ""}" to "open"`);
  return "open";
}

function parseStrictIntegerWithWarning(value: string | undefined, warnings: string[], fieldLabel: string): number {
  if (!value) return 0;
  const parsed = parseStrictIntegerCell(value);
  if (parsed !== null) {
    return parsed;
  }
  appendWarning(warnings, `${fieldLabel} normalized from "${value}" to 0`);
  return 0;
}

function parseIntegerWithFallback(
  value: string | undefined,
  fallback: number,
  warnings: string[],
  fieldLabel: string,
): number {
  if (!value) return Math.max(0, fallback);
  const match = value.match(/\d+/);
  if (!match) {
    appendWarning(warnings, `${fieldLabel} normalized from "${value}" to ${Math.max(0, fallback)}`);
    return Math.max(0, fallback);
  }
  return parseInt(match[0], 10);
}

function parseStrictIntegerCell(value: string | undefined): number | null {
  if (!value) return null;
  const normalized = normalizeHookId(value);
  if (!/^\d+$/.test(normalized)) {
    return null;
  }
  return parseInt(normalized, 10);
}

function normalizeExplicitChapter(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return 0;
  }
  return value;
}


function appendWarning(warnings: string[], warning: string): void {
  if (!warnings.includes(warning)) {
    warnings.push(warning);
  }
}

function uniqueStrings(values: ReadonlyArray<string>): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
