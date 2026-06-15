import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ChapterSummariesStateSchema,
  CurrentStateStateSchema,
  HooksStateSchema,
  KnowledgeStateSchema,
  ResourceLedgerStateSchema,
  StateManifestSchema,
  TimelineStateSchema,
  type RuntimeStateDelta,
} from "../models/runtime-state.js";
import type { Fact, StoredHook, StoredSummary } from "./memory-db.js";
import { bootstrapStructuredStateFromMarkdown, parseCurrentStateFacts } from "./state-bootstrap.js";
import { renderChapterSummariesProjection, renderCurrentStateProjection, renderHooksProjection } from "./state-projections.js";
import { applyRuntimeStateDelta, type RuntimeStateSnapshot } from "./state-reducer.js";
import { validateRuntimeState } from "./state-validator.js";
import { arbitrateRuntimeStateDeltaHooks } from "../utils/hook-arbiter.js";

export interface RuntimeStateArtifacts {
  readonly snapshot: RuntimeStateSnapshot;
  readonly resolvedDelta: RuntimeStateDelta;
  readonly currentStateMarkdown: string;
  readonly hooksMarkdown: string;
  readonly chapterSummariesMarkdown: string;
}

export interface NarrativeMemorySeed {
  readonly summaries: ReadonlyArray<StoredSummary>;
  readonly hooks: ReadonlyArray<StoredHook>;
}

export async function loadRuntimeStateSnapshot(bookDir: string): Promise<RuntimeStateSnapshot> {
  await bootstrapStructuredStateFromMarkdown({ bookDir });
  const stateDir = join(bookDir, "story", "state");

  const [manifest, currentState, hooks, chapterSummaries] = await Promise.all([
    readJson(join(stateDir, "manifest.json"), StateManifestSchema),
    readJson(join(stateDir, "current_state.json"), CurrentStateStateSchema),
    readJson(join(stateDir, "hooks.json"), HooksStateSchema),
    readJson(join(stateDir, "chapter_summaries.json"), ChapterSummariesStateSchema),
  ]);
  // 资源账本（P2-1）：旧书无此文件 → 默认空账本（向后兼容）
  const resourceLedger = (await readJsonOrNull(join(stateDir, "resource_ledger.json"), ResourceLedgerStateSchema))
    ?? ResourceLedgerStateSchema.parse({ resources: [] });
  // 知识边界事件（P2-2）：旧书无此文件 → 默认空（向后兼容）
  const knowledge = (await readJsonOrNull(join(stateDir, "knowledge.json"), KnowledgeStateSchema))
    ?? KnowledgeStateSchema.parse({ events: [] });
  // 全书时间线（P3-1）：旧书无此文件 → 默认空（向后兼容）
  const timeline = (await readJsonOrNull(join(stateDir, "timeline.json"), TimelineStateSchema))
    ?? TimelineStateSchema.parse({ entries: [] });

  const snapshot = {
    manifest,
    currentState,
    hooks,
    chapterSummaries,
    resourceLedger,
    knowledge,
    timeline,
  };

  const issues = validateRuntimeState(snapshot);
  if (issues.length > 0) {
    const summary = issues
      .map((issue) => `${issue.code}${issue.path ? `@${issue.path}` : ""}`)
      .join(", ");
    throw new Error(`Invalid persisted runtime state: ${summary}`);
  }

  return snapshot;
}

export async function buildRuntimeStateArtifacts(params: {
  readonly bookDir: string;
  readonly delta: RuntimeStateDelta;
  readonly language: "zh" | "en";
  readonly allowReapply?: boolean;
  readonly onResourceWarning?: (warning: import("./state-reducer.js").ResourceLedgerWarning) => void;
}): Promise<RuntimeStateArtifacts> {
  const snapshot = await loadRuntimeStateSnapshot(params.bookDir);
  const { resolvedDelta } = arbitrateRuntimeStateDeltaHooks({
    hooks: snapshot.hooks.hooks,
    delta: params.delta,
  });
  const next = applyRuntimeStateDelta({
    snapshot,
    delta: resolvedDelta,
    allowReapply: params.allowReapply,
    ...(params.onResourceWarning ? { onResourceWarning: params.onResourceWarning } : {}),
  });

  return {
    snapshot: next,
    resolvedDelta,
    currentStateMarkdown: renderCurrentStateProjection(next.currentState, params.language),
    hooksMarkdown: renderHooksProjection(next.hooks, params.language),
    chapterSummariesMarkdown: renderChapterSummariesProjection(next.chapterSummaries, params.language),
  };
}

export async function saveRuntimeStateSnapshot(
  bookDir: string,
  snapshot: RuntimeStateSnapshot,
): Promise<void> {
  const stateDir = join(bookDir, "story", "state");
  await mkdir(stateDir, { recursive: true });

  await Promise.all([
    atomicWriteJson(join(stateDir, "manifest.json"), snapshot.manifest),
    atomicWriteJson(join(stateDir, "current_state.json"), snapshot.currentState),
    atomicWriteJson(join(stateDir, "hooks.json"), snapshot.hooks),
    atomicWriteJson(join(stateDir, "chapter_summaries.json"), snapshot.chapterSummaries),
    atomicWriteJson(join(stateDir, "resource_ledger.json"), snapshot.resourceLedger ?? { resources: [] }),
    atomicWriteJson(join(stateDir, "knowledge.json"), snapshot.knowledge ?? { events: [] }),
    atomicWriteJson(join(stateDir, "timeline.json"), snapshot.timeline ?? { entries: [] }),
  ]);
}

/**
 * 原子写入 JSON 文件：先写 .tmp 再 rename，避免进程崩溃时产生半截文件。
 */
async function atomicWriteJson(path: string, data: unknown): Promise<void> {
  const tmpPath = path + ".tmp";
  await writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8");
  await rename(tmpPath, path);
}

export async function loadNarrativeMemorySeed(bookDir: string): Promise<NarrativeMemorySeed> {
  const snapshot = await loadRuntimeStateSnapshot(bookDir);

  return {
    summaries: snapshot.chapterSummaries.rows.map((row) => ({
      chapter: row.chapter,
      title: row.title,
      characters: row.characters,
      events: row.events,
      stateChanges: row.stateChanges,
      hookActivity: row.hookActivity,
      mood: row.mood,
      chapterType: row.chapterType,
    })),
      hooks: snapshot.hooks.hooks.map((hook) => ({
        hookId: hook.hookId,
        startChapter: hook.startChapter,
        type: hook.type,
        status: hook.status,
        lastAdvancedChapter: hook.lastAdvancedChapter,
        expectedPayoff: hook.expectedPayoff,
        payoffTiming: hook.payoffTiming,
        notes: hook.notes,
      })),
  };
}

export async function loadSnapshotCurrentStateFacts(
  bookDir: string,
  chapterNumber: number,
): Promise<ReadonlyArray<Fact>> {
  const snapshotDir = join(bookDir, "story", "snapshots", String(chapterNumber));
  const structuredState = await readJsonOrNull(
    join(snapshotDir, "state", "current_state.json"),
    CurrentStateStateSchema,
  );
  if (structuredState) {
    return structuredState.facts;
  }

  const markdown = await readFile(join(snapshotDir, "current_state.md"), "utf-8").catch(() => "");
  return parseCurrentStateFacts(markdown, chapterNumber);
}

async function readJson<T>(
  path: string,
  schema: { parse(value: unknown): T },
): Promise<T> {
  const raw = await readFile(path, "utf-8");
  return schema.parse(JSON.parse(raw));
}

async function readJsonOrNull<T>(
  path: string,
  schema: { parse(value: unknown): T },
): Promise<T | null> {
  try {
    return await readJson(path, schema);
  } catch {
    return null;
  }
}
