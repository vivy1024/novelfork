/**
 * 场景与剧情线的存取层。
 *
 * 场景是两棵叙事树共用的叶子：
 *   承载树  卷 → 章 → 场景   （在哪讲）——由 chapterNumber + ordinal 表达
 *   因果树  剧情线 → 场景     （为什么发生）——由 narrative_scene_storyline 表达
 *
 * 两条关系都存而不是推导，因为都推导不出来：一个场景归哪一章、在章内排第几、
 * 服务哪几条剧情线，全是作者/模型的判断，没有任何既有数据能算出它们。
 * （卷 → 章 那层则相反，chapterRange 推得出来，所以那层不在这里存。）
 *
 * 机器抽取的产物一律落 layer=dynamic + status=needs-review，作者确认后才升
 * canon —— 与 fact/event 同一套纪律，不给模型开后门直接写权威态。
 */

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import type { BeatBudgetItem } from "../../handlers/beat-budget.js";
import type { SceneSpecScene } from "../../handlers/scene-spec-handler.js";
import { ensureNarrativeMemorySchema } from "./storage.js";

/** canon 是作者确认过的；机器抽取一律 dynamic。 */
export type NarrativeLayer = "canon" | "dynamic";
/** 审核门：机器产出先待审，作者点头才 confirmed。 */
export type NarrativeReviewStatus = "needs-review" | "confirmed" | "rejected";
export type NarrativeSource = "dissect" | "settlement" | "workflow" | "manual" | "inferred";

export type StorylineKind = "main" | "sub" | "romance" | "faction" | "mystery" | "character-arc" | "other";
export type StorylineLifecycle = "planned" | "active" | "paused" | "resolved" | "abandoned";

/** 场景在故事推进中承担的功能，对应写作方法论里的 Beat 类型。 */
export type SceneFunction =
  | "advance"
  | "reveal"
  | "plant"
  | "payoff"
  | "relationship"
  | "transition"
  | "setup"
  | "climax"
  | "other";

/** primary 决定场景在因果树里默认挂在哪条线下；supporting 是次要服务。 */
export type SceneStorylineRole = "primary" | "supporting";

export type NarrativeStoryline = Readonly<{
  id: string;
  bookId: string;
  name: string;
  kind: StorylineKind;
  lifecycle: StorylineLifecycle;
  goal: string;
  entryId?: string;
  layer: NarrativeLayer;
  status: NarrativeReviewStatus;
  source: NarrativeSource;
  confidence: number;
  createdAt: number;
  updatedAt: number;
}>;

export type NarrativeScene = Readonly<{
  id: string;
  bookId: string;
  chapterNumber: number;
  /** 章内次序，从 1 起。调整叙事顺序就是改这一列，不必动正文。 */
  ordinal: number;
  title: string;
  summary: string;
  function: SceneFunction;
  povEntityId?: string;
  locationEntityId?: string;
  wordCount: number;
  conflict: string;
  mood: string;
  outcome: string;
  characters: readonly string[];
  hooksUsed: readonly string[];
  hooksPlanted: readonly string[];
  beatBudget?: readonly BeatBudgetItem[];
  layer: NarrativeLayer;
  status: NarrativeReviewStatus;
  source: NarrativeSource;
  confidence: number;
  createdAt: number;
  updatedAt: number;
}>;

export type SceneStorylineMount = Readonly<{
  sceneId: string;
  storylineId: string;
  role: SceneStorylineRole;
  createdAt: number;
}>;

export type SceneStoreResult<T> = Readonly<{
  ok: boolean;
  summary: string;
  error?: string;
  data?: T;
}>;

type StorylineRow = {
  id: string;
  book_id: string;
  name: string;
  kind: string;
  lifecycle: string;
  goal: string;
  entry_id: string | null;
  layer: string;
  status: string;
  source: string;
  confidence: number;
  created_at: number;
  updated_at: number;
};

type SceneRow = {
  id: string;
  book_id: string;
  chapter_number: number;
  ordinal: number;
  title: string;
  summary: string;
  function: string;
  pov_entity_id: string | null;
  location_entity_id: string | null;
  word_count: number;
  conflict: string;
  mood: string;
  outcome: string;
  characters_json: string;
  hooks_used_json: string;
  hooks_planted_json: string;
  beat_budget_json: string | null;
  layer: string;
  status: string;
  source: string;
  confidence: number;
  created_at: number;
  updated_at: number;
};

function safeParseJsonArray<T>(raw: string | null | undefined): T[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function safeParseJsonNullable<T>(raw: string | null | undefined): T | undefined {
  if (!raw?.trim()) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function fail<T>(error: string, summary: string): SceneStoreResult<T> {
  return { ok: false, error, summary };
}

function storylineId(bookId: string): string {
  return `storyline:${bookId}:${crypto.randomUUID()}`;
}

function sceneId(bookId: string): string {
  return `scene:${bookId}:${crypto.randomUUID()}`;
}

function toStoryline(row: StorylineRow): NarrativeStoryline {
  return {
    id: row.id,
    bookId: row.book_id,
    name: row.name,
    kind: row.kind as StorylineKind,
    lifecycle: row.lifecycle as StorylineLifecycle,
    goal: row.goal,
    ...(row.entry_id ? { entryId: row.entry_id } : {}),
    layer: row.layer as NarrativeLayer,
    status: row.status as NarrativeReviewStatus,
    source: row.source as NarrativeSource,
    confidence: row.confidence,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toScene(row: SceneRow): NarrativeScene {
  const beatBudget = safeParseJsonNullable<BeatBudgetItem[]>(row.beat_budget_json);
  return {
    id: row.id,
    bookId: row.book_id,
    chapterNumber: row.chapter_number,
    ordinal: row.ordinal,
    title: row.title,
    summary: row.summary,
    function: row.function as SceneFunction,
    ...(row.pov_entity_id ? { povEntityId: row.pov_entity_id } : {}),
    ...(row.location_entity_id ? { locationEntityId: row.location_entity_id } : {}),
    wordCount: row.word_count,
    conflict: row.conflict ?? "",
    mood: row.mood ?? "",
    outcome: row.outcome ?? "",
    characters: safeParseJsonArray<string>(row.characters_json),
    hooksUsed: safeParseJsonArray<string>(row.hooks_used_json),
    hooksPlanted: safeParseJsonArray<string>(row.hooks_planted_json),
    ...(beatBudget ? { beatBudget } : {}),
    layer: row.layer as NarrativeLayer,
    status: row.status as NarrativeReviewStatus,
    source: row.source as NarrativeSource,
    confidence: row.confidence,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// 剧情线
// ---------------------------------------------------------------------------

export type CreateStorylineInput = Readonly<{
  bookId: string;
  name: string;
  kind?: StorylineKind;
  lifecycle?: StorylineLifecycle;
  goal?: string;
  entryId?: string;
  layer?: NarrativeLayer;
  status?: NarrativeReviewStatus;
  source?: NarrativeSource;
  confidence?: number;
}>;

export function createStoryline(
  storage: StorageDatabase,
  input: CreateStorylineInput,
): SceneStoreResult<NarrativeStoryline> {
  ensureNarrativeMemorySchema(storage);
  const name = input.name.trim();
  if (!name) return fail("invalid-input", "剧情线需要一个名字，空名无法在树上区分。");

  const now = Date.now();
  const row: NarrativeStoryline = {
    id: storylineId(input.bookId),
    bookId: input.bookId,
    name,
    kind: input.kind ?? "other",
    lifecycle: input.lifecycle ?? "active",
    goal: input.goal?.trim() ?? "",
    ...(input.entryId ? { entryId: input.entryId } : {}),
    layer: input.layer ?? "dynamic",
    status: input.status ?? "needs-review",
    source: input.source ?? "inferred",
    confidence: input.confidence ?? 1,
    createdAt: now,
    updatedAt: now,
  };

  storage.sqlite
    .prepare(`
      INSERT INTO narrative_storyline
        (id, book_id, name, kind, lifecycle, goal, entry_id, layer, status, source, confidence, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      row.id, row.bookId, row.name, row.kind, row.lifecycle, row.goal,
      row.entryId ?? null, row.layer, row.status, row.source, row.confidence,
      row.createdAt, row.updatedAt,
    );

  return { ok: true, summary: `已建立剧情线「${row.name}」。`, data: row };
}

export function listStorylines(storage: StorageDatabase, bookId: string): NarrativeStoryline[] {
  ensureNarrativeMemorySchema(storage);
  return storage.sqlite
    .prepare<StorylineRow>(`
      SELECT * FROM narrative_storyline WHERE book_id = ?
      ORDER BY CASE kind WHEN 'main' THEN 0 ELSE 1 END, created_at
    `)
    .all(bookId)
    .map(toStoryline);
}

export function getStoryline(storage: StorageDatabase, id: string): NarrativeStoryline | undefined {
  ensureNarrativeMemorySchema(storage);
  const row = storage.sqlite
    .prepare<StorylineRow>("SELECT * FROM narrative_storyline WHERE id = ?")
    .get(id);
  return row ? toStoryline(row) : undefined;
}

// ---------------------------------------------------------------------------
// 场景
// ---------------------------------------------------------------------------

export type CreateSceneInput = Readonly<{
  bookId: string;
  chapterNumber: number;
  /** 省略时追加到该章末尾。 */
  ordinal?: number;
  title?: string;
  summary?: string;
  function?: SceneFunction;
  povEntityId?: string;
  locationEntityId?: string;
  wordCount?: number;
  conflict?: string;
  mood?: string;
  outcome?: string;
  characters?: readonly string[];
  hooksUsed?: readonly string[];
  hooksPlanted?: readonly string[];
  beatBudget?: readonly BeatBudgetItem[];
  layer?: NarrativeLayer;
  status?: NarrativeReviewStatus;
  source?: NarrativeSource;
  confidence?: number;
}>;

/** 该章现有场景的最大 ordinal；用于默认追加到末尾。 */
function maxOrdinal(storage: StorageDatabase, bookId: string, chapterNumber: number): number {
  const row = storage.sqlite
    .prepare<{ maxOrdinal: number | null }>(
      "SELECT MAX(ordinal) AS maxOrdinal FROM narrative_scene WHERE book_id = ? AND chapter_number = ?",
    )
    .get(bookId, chapterNumber);
  return row?.maxOrdinal ?? 0;
}

export function createScene(storage: StorageDatabase, input: CreateSceneInput): SceneStoreResult<NarrativeScene> {
  ensureNarrativeMemorySchema(storage);
  if (!Number.isInteger(input.chapterNumber) || input.chapterNumber < 1) {
    return fail("invalid-input", "场景必须落在某一章上，章号需为正整数。");
  }

  const now = Date.now();
  const row: NarrativeScene = {
    id: sceneId(input.bookId),
    bookId: input.bookId,
    chapterNumber: input.chapterNumber,
    ordinal: input.ordinal ?? maxOrdinal(storage, input.bookId, input.chapterNumber) + 1,
    title: input.title?.trim() ?? "",
    summary: input.summary?.trim() ?? "",
    function: input.function ?? "advance",
    ...(input.povEntityId ? { povEntityId: input.povEntityId } : {}),
    ...(input.locationEntityId ? { locationEntityId: input.locationEntityId } : {}),
    wordCount: input.wordCount ?? 0,
    conflict: input.conflict?.trim() ?? "",
    mood: input.mood?.trim() ?? "",
    outcome: input.outcome?.trim() ?? "",
    characters: input.characters ? [...input.characters] : [],
    hooksUsed: input.hooksUsed ? [...input.hooksUsed] : [],
    hooksPlanted: input.hooksPlanted ? [...input.hooksPlanted] : [],
    ...(input.beatBudget ? { beatBudget: [...input.beatBudget] } : {}),
    layer: input.layer ?? "dynamic",
    status: input.status ?? "needs-review",
    source: input.source ?? "inferred",
    confidence: input.confidence ?? 1,
    createdAt: now,
    updatedAt: now,
  };

  storage.sqlite
    .prepare(`
      INSERT INTO narrative_scene
        (id, book_id, chapter_number, ordinal, title, summary, function, pov_entity_id,
         location_entity_id, word_count, conflict, mood, outcome, characters_json,
         hooks_used_json, hooks_planted_json, beat_budget_json,
         layer, status, source, confidence, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      row.id, row.bookId, row.chapterNumber, row.ordinal, row.title, row.summary, row.function,
      row.povEntityId ?? null, row.locationEntityId ?? null, row.wordCount,
      row.conflict, row.mood, row.outcome,
      JSON.stringify(row.characters),
      JSON.stringify(row.hooksUsed),
      JSON.stringify(row.hooksPlanted),
      row.beatBudget ? JSON.stringify(row.beatBudget) : null,
      row.layer, row.status, row.source, row.confidence, row.createdAt, row.updatedAt,
    );

  return { ok: true, summary: `第 ${row.chapterNumber} 章新增场景（第 ${row.ordinal} 个）。`, data: row };
}

/**
 * 全书场景，按章号与章内次序。两棵树一次取全用这个——
 * 按章逐次拉会让承载树的渲染变成 N 次往返。
 */
export function listScenes(storage: StorageDatabase, bookId: string): NarrativeScene[] {
  ensureNarrativeMemorySchema(storage);
  return storage.sqlite
    .prepare<SceneRow>(
      "SELECT * FROM narrative_scene WHERE book_id = ? ORDER BY chapter_number, ordinal, id",
    )
    .all(bookId)
    .map(toScene);
}

/**
 * 全书挂载关系。按 book 过滤要经由 scene 表——挂载表本身不带 book_id
 * （它只是两个 id 的连线，book 归属由两端决定，重复存会出现两处说法不一致）。
 */
export function listMounts(storage: StorageDatabase, bookId: string): SceneStorylineMount[] {
  ensureNarrativeMemorySchema(storage);
  return storage.sqlite
    .prepare<{ scene_id: string; storyline_id: string; role: string; created_at: number }>(`
      SELECT m.* FROM narrative_scene_storyline m
      JOIN narrative_scene s ON s.id = m.scene_id
      WHERE s.book_id = ?
      ORDER BY m.storyline_id, m.role, m.scene_id
    `)
    .all(bookId)
    .map((row) => ({
      sceneId: row.scene_id,
      storylineId: row.storyline_id,
      role: row.role as SceneStorylineRole,
      createdAt: row.created_at,
    }));
}

/** 承载树的一层：某章的场景，按章内次序。 */
export function listScenesByChapter(
  storage: StorageDatabase,
  bookId: string,
  chapterNumber: number,
): NarrativeScene[] {
  ensureNarrativeMemorySchema(storage);
  return storage.sqlite
    .prepare<SceneRow>(
      // 以 id 兜底排序：ordinal 没有唯一约束（加了会让抽取管线批量插入时中途
      // 失败），重号时靠 id 保证渲染顺序仍然确定，不会两次刷新给出不同结果。
      "SELECT * FROM narrative_scene WHERE book_id = ? AND chapter_number = ? ORDER BY ordinal, id",
    )
    .all(bookId, chapterNumber)
    .map(toScene);
}

/**
 * 因果树的一层：某条剧情线上的场景，按章号与章内次序排 —— 这正是
 * 「这条线上次推进是哪章」在数据层第一次能被回答。
 */
export function listScenesByStoryline(
  storage: StorageDatabase,
  storylineIdValue: string,
  options: Readonly<{ role?: SceneStorylineRole }> = {},
): NarrativeScene[] {
  ensureNarrativeMemorySchema(storage);
  const roleClause = options.role ? " AND m.role = ?" : "";
  const params: unknown[] = options.role ? [storylineIdValue, options.role] : [storylineIdValue];
  return storage.sqlite
    .prepare<SceneRow>(`
      SELECT s.* FROM narrative_scene s
      JOIN narrative_scene_storyline m ON m.scene_id = s.id
      WHERE m.storyline_id = ?${roleClause}
      ORDER BY s.chapter_number, s.ordinal, s.id
    `)
    .all(...params)
    .map(toScene);
}

/**
 * 重排某章的场景次序。
 *
 * 传入该章场景 id 的目标顺序，整体重写 ordinal（1..n）。做成「给全序」而不是
 * 「把 A 移到第 k 位」，是因为后者在并发或部分失败时会留下重号/空号，
 * 而树的渲染依赖 ordinal 唯一且连续。
 */
export function reorderChapterScenes(
  storage: StorageDatabase,
  bookId: string,
  chapterNumber: number,
  orderedSceneIds: readonly string[],
): SceneStoreResult<NarrativeScene[]> {
  ensureNarrativeMemorySchema(storage);
  const existing = listScenesByChapter(storage, bookId, chapterNumber);
  const existingIds = new Set(existing.map((scene) => scene.id));

  if (orderedSceneIds.length !== existing.length) {
    return fail(
      "incomplete-order",
      `重排需要给出该章全部 ${existing.length} 个场景，收到 ${orderedSceneIds.length} 个。少给会留下空号。`,
    );
  }
  const seen = new Set<string>();
  for (const id of orderedSceneIds) {
    if (!existingIds.has(id)) return fail("unknown-scene", `场景 ${id} 不属于第 ${chapterNumber} 章。`);
    if (seen.has(id)) return fail("duplicate-scene", `场景 ${id} 在给定顺序里出现了两次。`);
    seen.add(id);
  }

  const now = Date.now();
  const update = storage.sqlite.prepare(
    "UPDATE narrative_scene SET ordinal = ?, updated_at = ? WHERE id = ?",
  );
  // 整批写在一个事务里：中途失败会让这一章一半新序一半旧序，
  // 树渲染出来的先后就是错的，而作者看不出哪里错了。
  storage.sqlite.transaction(() => {
    orderedSceneIds.forEach((id, index) => update.run(index + 1, now, id));
  })();

  return {
    ok: true,
    summary: `第 ${chapterNumber} 章的 ${orderedSceneIds.length} 个场景已重排。`,
    data: listScenesByChapter(storage, bookId, chapterNumber),
  };
}

// ---------------------------------------------------------------------------
// 正交挂载
// ---------------------------------------------------------------------------

/**
 * 把场景挂到剧情线上。重复挂载视为改 role（幂等），不报错——
 * 抽取管线会反复跑同一章，报错只会制造噪声。
 */
export function mountSceneToStoryline(
  storage: StorageDatabase,
  sceneIdValue: string,
  storylineIdValue: string,
  role: SceneStorylineRole = "primary",
): SceneStoreResult<SceneStorylineMount> {
  ensureNarrativeMemorySchema(storage);
  const now = Date.now();
  storage.sqlite
    .prepare(`
      INSERT INTO narrative_scene_storyline (scene_id, storyline_id, role, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(scene_id, storyline_id) DO UPDATE SET role = excluded.role
    `)
    .run(sceneIdValue, storylineIdValue, role, now);

  return {
    ok: true,
    summary: "场景已挂到剧情线上。",
    data: { sceneId: sceneIdValue, storylineId: storylineIdValue, role, createdAt: now },
  };
}

export function unmountSceneFromStoryline(
  storage: StorageDatabase,
  sceneIdValue: string,
  storylineIdValue: string,
): SceneStoreResult<null> {
  ensureNarrativeMemorySchema(storage);
  const result = storage.sqlite
    .prepare("DELETE FROM narrative_scene_storyline WHERE scene_id = ? AND storyline_id = ?")
    .run(sceneIdValue, storylineIdValue);
  return result.changes > 0
    ? { ok: true, summary: "场景已从该剧情线上摘下。" }
    : { ok: false, error: "not-mounted", summary: "这个场景本来就不在该剧情线上。" };
}

/** 某个场景挂在哪几条线上——正交性的另一半，给承载树侧展示用。 */
export function listSceneMounts(storage: StorageDatabase, sceneIdValue: string): SceneStorylineMount[] {
  ensureNarrativeMemorySchema(storage);
  return storage.sqlite
    .prepare<{ scene_id: string; storyline_id: string; role: string; created_at: number }>(
      "SELECT * FROM narrative_scene_storyline WHERE scene_id = ? ORDER BY role, storyline_id",
    )
    .all(sceneIdValue)
    .map((row) => ({
      sceneId: row.scene_id,
      storylineId: row.storyline_id,
      role: row.role as SceneStorylineRole,
      createdAt: row.created_at,
    }));
}

// ---------------------------------------------------------------------------
// SceneSpec 对齐与转换
// ---------------------------------------------------------------------------

export interface SceneFromSpecOptions {
  readonly beatBudget?: readonly BeatBudgetItem[];
  readonly layer?: NarrativeLayer;
  readonly status?: NarrativeReviewStatus;
  readonly source?: NarrativeSource;
  readonly confidence?: number;
  readonly function?: SceneFunction;
}

/**
 * 将写前蓝图（SceneSpecScene）无损转换为 CreateSceneInput。
 *
 * 铁律：
 * 1. location 是自由文本，存入 summary（如 "[地点: ...] 描述"），
 *    严禁存入 locationEntityId —— 后者指向 narrative_entity，未归并时会造假外键；
 * 2. characters / conflict / mood / outcome / hooks_used / hooks_planted 完整落入对应列；
 * 3. 机器抽取或工作流产物默认 layer=dynamic, status=needs-review, source=workflow。
 */
export function sceneFromSpec(
  bookId: string,
  chapterNumber: number,
  ordinal: number,
  spec: SceneSpecScene,
  options?: SceneFromSpecOptions,
): CreateSceneInput {
  const locationPrefix = spec.location?.trim() ? `[地点: ${spec.location.trim()}] ` : "";
  const baseSummary = spec.outcome?.trim() || spec.conflict?.trim() || `第 ${chapterNumber} 章第 ${ordinal} 场`;
  const summary = `${locationPrefix}${baseSummary}`.trim();

  return {
    bookId,
    chapterNumber,
    ordinal,
    title: spec.conflict?.trim() ? spec.conflict.trim().slice(0, 40) : `第 ${ordinal} 场`,
    summary,
    function: options?.function ?? "advance",
    conflict: spec.conflict ?? "",
    mood: spec.mood ?? "",
    outcome: spec.outcome ?? "",
    characters: spec.characters ?? [],
    hooksUsed: spec.hooks_used ?? [],
    hooksPlanted: spec.hooks_planted ?? [],
    ...(options?.beatBudget ? { beatBudget: options.beatBudget } : {}),
    layer: options?.layer ?? "dynamic",
    status: options?.status ?? "needs-review",
    source: options?.source ?? "workflow",
    confidence: options?.confidence ?? 1.0,
  };
}
