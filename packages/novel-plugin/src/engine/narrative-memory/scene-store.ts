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
import { parseSceneGaps, type SceneGap } from "../../handlers/scene-gaps.js";
import { ensureNarrativeMemorySchema } from "./storage.js";

/** canon 是作者确认过的；机器抽取一律 dynamic。 */
export type NarrativeLayer = "canon" | "dynamic";
/** 审核门：机器产出先待审，作者点头才 confirmed。 */
export type NarrativeReviewStatus = "needs-review" | "confirmed" | "rejected";
export type NarrativeSource = "dissect" | "settlement" | "workflow" | "manual" | "inferred";

/**
 * 合法取值以运行时数组为唯一来源，类型由它派生。接口边界据此校验——
 * 单靠 `as StorylineKind` 强转，任何字符串都会原样落库，之后渲染时查不到标签，
 * 排序与过滤也按错误的值走。
 */
export const STORYLINE_KINDS = ["main", "sub", "romance", "faction", "mystery", "character-arc", "other"] as const;
export type StorylineKind = (typeof STORYLINE_KINDS)[number];
export type StorylineLifecycle = "planned" | "active" | "paused" | "resolved" | "abandoned";

/** 场景在故事推进中承担的功能，对应写作方法论里的 Beat 类型。 */
export const SCENE_FUNCTIONS = [
  "advance",
  "reveal",
  "plant",
  "payoff",
  "relationship",
  "transition",
  "setup",
  "climax",
  "other",
] as const;
export type SceneFunction = (typeof SCENE_FUNCTIONS)[number];

export function isStorylineKind(value: unknown): value is StorylineKind {
  return typeof value === "string" && (STORYLINE_KINDS as readonly string[]).includes(value);
}

export function isSceneFunction(value: unknown): value is SceneFunction {
  return typeof value === "string" && (SCENE_FUNCTIONS as readonly string[]).includes(value);
}

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
  /** 规划留白（T2.6）：蓝图带来或作者手编；旧行为空数组。 */
  gaps: readonly SceneGap[];
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
  gaps_json: string | null;
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
    // 读出时再过一遍判据：旧行没有这一列或存了脏数据，都只得到合法条目。
    gaps: parseSceneGaps(safeParseJsonArray<unknown>(row.gaps_json)),
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

/**
 * 同书同名剧情线（任意状态）：待审优先，其次是仍生效的（已确认等），作者驳回的排最后；
 * 同一档里取最早创建的一条。storyline.propose 用它判定「已有草稿 / 已确认 / 已被作者驳回」。
 * 驳回排最后：同名既有旧的驳回、又有后来确认的线时，应按已确认复用，而不是拒绝起草。
 */
export function findStorylineByName(
  storage: StorageDatabase,
  bookId: string,
  name: string,
): NarrativeStoryline | undefined {
  ensureNarrativeMemorySchema(storage);
  const row = storage.sqlite
    .prepare<StorylineRow>(
      "SELECT * FROM narrative_storyline WHERE book_id = ? AND name = ? ORDER BY CASE status WHEN 'needs-review' THEN 0 WHEN 'rejected' THEN 2 ELSE 1 END, created_at",
    )
    .get(bookId, name.trim());
  return row ? toStoryline(row) : undefined;
}

/**
 * 剧情线草稿审核：只允许从 needs-review 走向 confirmed / rejected，
 * 已确认或已驳回的线不能再被改写状态（作者删了就该删，不是驳回复活）。
 */
export function reviewStoryline(
  storage: StorageDatabase,
  id: string,
  decision: "confirmed" | "rejected",
): SceneStoreResult<NarrativeStoryline> {
  ensureNarrativeMemorySchema(storage);
  const existing = getStoryline(storage, id);
  if (!existing) return fail("storyline-not-found", "这本书里没有这条剧情线，可能已被删除。");
  if (existing.status !== "needs-review") {
    return fail("storyline-not-pending", `剧情线「${existing.name}」当前状态是 ${existing.status}，不在待审中。`);
  }
  storage.sqlite
    .prepare("UPDATE narrative_storyline SET status = ?, updated_at = ? WHERE id = ?")
    .run(decision, Date.now(), id);
  const updated = getStoryline(storage, id);
  return {
    ok: true,
    summary: decision === "confirmed"
      ? `剧情线「${existing.name}」已确认，进入故事推进。`
      : `剧情线草稿「${existing.name}」已驳回。`,
    ...(updated ? { data: updated } : {}),
  };
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
  gaps?: readonly SceneGap[];
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
    gaps: parseSceneGaps(input.gaps ?? []),
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
         hooks_used_json, hooks_planted_json, beat_budget_json, gaps_json,
         layer, status, source, confidence, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      row.id, row.bookId, row.chapterNumber, row.ordinal, row.title, row.summary, row.function,
      row.povEntityId ?? null, row.locationEntityId ?? null, row.wordCount,
      row.conflict, row.mood, row.outcome,
      JSON.stringify(row.characters),
      JSON.stringify(row.hooksUsed),
      JSON.stringify(row.hooksPlanted),
      row.beatBudget ? JSON.stringify(row.beatBudget) : null,
      JSON.stringify(row.gaps),
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

/**
 * 挂载两端是否都属于这本书。挂载表不带 book_id，接口层必须先核对：
 * 否则能访问 A 书的人拿着 B 书的场景 id 就能改 B 书的挂载，或把两本书的数据连在一起。
 */
export function checkMountBelongsToBook(
  storage: StorageDatabase,
  bookId: string,
  sceneIdValue: string,
  storylineIdValue: string | null,
): SceneStoreResult<null> {
  ensureNarrativeMemorySchema(storage);
  const scene = storage.sqlite
    .prepare<{ id: string }>("SELECT id FROM narrative_scene WHERE id = ? AND book_id = ?")
    .get(sceneIdValue, bookId);
  if (!scene) return { ok: false, error: "scene-not-found", summary: "这本书里没有这个场景，可能已被删除。" };
  if (storylineIdValue === null) return { ok: true, summary: "" };
  const line = storage.sqlite
    .prepare<{ id: string }>("SELECT id FROM narrative_storyline WHERE id = ? AND book_id = ?")
    .get(storylineIdValue, bookId);
  if (!line) return { ok: false, error: "storyline-not-found", summary: "这本书里没有这条剧情线，可能已被删除。" };
  return { ok: true, summary: "" };
}

/**
 * 改场景的主剧情线（因果画布上把场景拖到另一条泳道）。
 *
 * 一个事务里完成：摘掉原来的主挂载，把目标线设为主挂载（原本是辅助挂载的就升为主）；
 * 其余辅助挂载保持不动。storylineId 为 null 表示拖进「未挂线」：摘下全部挂载，
 * 否则场景会因为还剩辅助挂载而留在别的泳道里，与作者的操作对不上。
 * 调用方须先用 checkMountBelongsToBook 核对归属。
 */
export function setScenePrimaryStoryline(
  storage: StorageDatabase,
  sceneIdValue: string,
  storylineIdValue: string | null,
): SceneStoreResult<SceneStorylineMount[]> {
  ensureNarrativeMemorySchema(storage);
  const now = Date.now();
  storage.sqlite.transaction(() => {
    if (storylineIdValue === null) {
      storage.sqlite.prepare("DELETE FROM narrative_scene_storyline WHERE scene_id = ?").run(sceneIdValue);
      return;
    }
    storage.sqlite
      .prepare("DELETE FROM narrative_scene_storyline WHERE scene_id = ? AND role = 'primary' AND storyline_id <> ?")
      .run(sceneIdValue, storylineIdValue);
    storage.sqlite
      .prepare(`
        INSERT INTO narrative_scene_storyline (scene_id, storyline_id, role, created_at)
        VALUES (?, ?, 'primary', ?)
        ON CONFLICT(scene_id, storyline_id) DO UPDATE SET role = 'primary'
      `)
      .run(sceneIdValue, storylineIdValue, now);
  })();
  return {
    ok: true,
    summary: storylineIdValue === null ? "场景已从所有剧情线上摘下。" : "场景的主剧情线已更新。",
    data: listSceneMounts(storage, sceneIdValue),
  };
}

/** 读单个场景，并核对它属于这本书；不属于时与不存在一样返回 undefined，不泄露存在性。 */
export function getSceneInBook(storage: StorageDatabase, bookId: string, sceneIdValue: string): NarrativeScene | undefined {
  ensureNarrativeMemorySchema(storage);
  const row = storage.sqlite
    .prepare<SceneRow>("SELECT * FROM narrative_scene WHERE id = ? AND book_id = ?")
    .get(sceneIdValue, bookId);
  return row ? toScene(row) : undefined;
}

/**
 * 作者手编某个场景的规划留白（T2.6）：整组替换，非法条目按 parseSceneGaps 剔除。
 *
 * - 冲突保护：调用方带上读取时的 updatedAt；场景此后被别处改过（叙述者重写、另一个窗口保存）
 *   就拒绝写入并返回 scene-conflict，不覆盖别人的修改。
 * - 作者动手改过即视为认领：needs-review 的机器场景升为 confirmed，之后重写本章时
 *   replaceChapterScenes 会保留它，作者写的留白不会被新蓝图静默抹掉。
 */
export function updateSceneGaps(
  storage: StorageDatabase,
  input: Readonly<{ bookId: string; sceneId: string; gaps: unknown; expectedUpdatedAt: number }>,
): SceneStoreResult<NarrativeScene> {
  ensureNarrativeMemorySchema(storage);
  const existing = getSceneInBook(storage, input.bookId, input.sceneId);
  if (!existing) return fail("scene-not-found", "这本书里没有这个场景，可能已被删除或本章已重写。");
  if (existing.updatedAt !== input.expectedUpdatedAt) {
    return fail("scene-conflict", "这个场景在你打开之后被改过（可能是叙述者重写了本章或另一个窗口保存过），为避免覆盖，这次没有保存。请重新载入后再改。");
  }
  const gaps = parseSceneGaps(input.gaps);
  // 毫秒时间戳作版本号：保证严格递增，同一毫秒内连续保存也能区分版本。
  const updatedAt = Math.max(Date.now(), existing.updatedAt + 1);
  const status: NarrativeReviewStatus = existing.status === "needs-review" ? "confirmed" : existing.status;
  const changed = storage.sqlite
    .prepare("UPDATE narrative_scene SET gaps_json = ?, status = ?, updated_at = ? WHERE id = ? AND book_id = ? AND updated_at = ?")
    .run(JSON.stringify(gaps), status, updatedAt, input.sceneId, input.bookId, input.expectedUpdatedAt);
  if (Number(changed.changes) !== 1) {
    return fail("scene-conflict", "这个场景刚刚被别处改过，为避免覆盖，这次没有保存。请重新载入后再改。");
  }
  const saved = getSceneInBook(storage, input.bookId, input.sceneId)!;
  return {
    ok: true,
    summary: gaps.length > 0
      ? `第 ${saved.chapterNumber} 章第 ${saved.ordinal} 场的留白已保存（${gaps.length} 条）。`
      : `第 ${saved.chapterNumber} 章第 ${saved.ordinal} 场的留白已清空。`,
    data: saved,
  };
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
): BlueprintSceneInput {
  // 蓝图可选带 sceneId（叙述者对着已有场景写蓝图时），落盘时据此对上作者场景。
  const rawSceneId = (spec as { sceneId?: unknown }).sceneId;
  const targetSceneId = typeof rawSceneId === "string" && rawSceneId.trim() ? rawSceneId.trim() : undefined;
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
    ...(spec.gaps && spec.gaps.length > 0 ? { gaps: spec.gaps } : {}),
    ...(options?.beatBudget ? { beatBudget: options.beatBudget } : {}),
    layer: options?.layer ?? "dynamic",
    status: options?.status ?? "needs-review",
    source: options?.source ?? "workflow",
    confidence: options?.confidence ?? 1.0,
    ...(targetSceneId ? { targetSceneId } : {}),
  };
}

/**
 * 用写作管线的新蓝图刷新一章里「机器产出、尚未被作者动过」的场景。
 *
 * 只替换同时满足三个条件的场景：source = workflow、status = needs-review、没有挂到任何剧情线。
 * 其余一律保留——作者手建的场景（看板「+」建的就是 manual/confirmed）、作者已确认的场景、
 * 作者已挂到剧情线上的场景，都是作者投入过的劳动。若按「整章删光再建」处理，作者
 * 一重写本章，这些场景与挂载就会被静默抹掉，而界面上看不出发生过什么。
 *
 * 蓝图里与保留场景是同一场的（同 sceneId / 同序号 / 地点相同且人物重合，见 matchBlueprintToPreserved），
 * 只就地更新那个保留场景、不另建一份——否则作者手建的场景和蓝图场景会并存，留白被复制。
 * 其余新场景追加在保留场景之后（ordinal 取当前最大值 + 1），不复用蓝图里的序号，
 * 避免与保留场景撞号。整个过程在一个事务里：任何一条写入失败则整体回滚，
 * 不会留下「旧的删了、新的只写了一半」的状态。
 */
export function replaceChapterScenes(
  storage: StorageDatabase,
  bookId: string,
  chapterNumber: number,
  inputs: readonly BlueprintSceneInput[],
): SceneStoreResult<NarrativeScene[]> {
  ensureNarrativeMemorySchema(storage);
  if (!Number.isInteger(chapterNumber) || chapterNumber < 1) {
    return fail("invalid-input", "场景必须落在某一章上，章号需为正整数。");
  }

  const resultScenes: NarrativeScene[] = [];
  let createdCount = 0;
  let mergedCount = 0;
  let replacedCount = 0;
  let preservedCount = 0;

  try {
    storage.sqlite.transaction(() => {
      const removed = storage.sqlite
        .prepare(`
          DELETE FROM narrative_scene
          WHERE book_id = ? AND chapter_number = ?
            AND source = 'workflow' AND status = 'needs-review'
            AND id NOT IN (SELECT scene_id FROM narrative_scene_storyline)
        `)
        .run(bookId, chapterNumber);
      replacedCount = Number(removed.changes);

      const preserved = listScenesByChapter(storage, bookId, chapterNumber);
      preservedCount = preserved.length;
      const matches = matchBlueprintToPreserved(storage, bookId, inputs, preserved);

      for (const [index, input] of inputs.entries()) {
        const target = matches.get(index);
        if (target) {
          // 同一场：只更新作者版，不重复建。
          resultScenes.push(mergeBlueprintIntoScene(storage, target, input));
          mergedCount += 1;
          continue;
        }
        // 丢弃蓝图自带的序号，由 createScene 追加到当前末尾。
        const { ordinal: _ignoredOrdinal, targetSceneId: _ignoredTarget, ...rest } = input;
        const created = createScene(storage, {
          ...rest,
          bookId,
          chapterNumber,
          layer: input.layer ?? "dynamic",
          status: input.status ?? "needs-review",
          source: input.source ?? "workflow",
        });
        if (!created.ok || !created.data) {
          throw new Error(created.summary);
        }
        resultScenes.push(created.data);
        createdCount += 1;
      }
    })();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail("transaction-failed", `第 ${chapterNumber} 章场景刷新失败，已整体回滚：${message}`);
  }

  const preservedNote = preservedCount > 0
    ? `保留了 ${preservedCount} 个作者建过、确认过或已挂线的场景${mergedCount > 0 ? `（其中 ${mergedCount} 个与蓝图是同一场，已就地更新）` : ""}，`
    : "";
  return {
    ok: true,
    summary: `第 ${chapterNumber} 章场景已刷新：替换 ${replacedCount} 个机器场景，${preservedNote}新写入 ${createdCount} 个。`,
    data: resultScenes,
  };
}

/** 蓝图场景：可带要对上的已有场景 id（蓝图里写了 sceneId 时）。 */
export type BlueprintSceneInput = CreateSceneInput & Readonly<{ targetSceneId?: string }>;

const LOCATION_PREFIX = /^\[地点:\s*([^\]]+)\]\s*/u;

function sceneLocationLabel(storage: StorageDatabase, scene: Pick<NarrativeScene, "summary" | "locationEntityId">): string | null {
  const fromSummary = scene.summary.match(LOCATION_PREFIX)?.[1]?.trim();
  if (fromSummary) return fromSummary;
  if (!scene.locationEntityId) return null;
  const row = storage.sqlite
    .prepare<{ canonical_name: string }>("SELECT canonical_name FROM narrative_entity WHERE id = ?")
    .get(scene.locationEntityId);
  return row?.canonical_name ?? null;
}

/** 地点名归并键：命中实体（规范名 / 别名）时用实体 id，否则用去空白的原文。 */
function locationKey(storage: StorageDatabase, bookId: string, label: string | null): string | null {
  const name = label?.replace(/\s+/gu, "");
  if (!name) return null;
  const hasEntities = storage.sqlite
    .prepare<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'narrative_entity_alias'")
    .get();
  if (hasEntities) {
    const hit = storage.sqlite.prepare<{ id: string }>(`
      SELECT id FROM narrative_entity WHERE book_id = ? AND canonical_name = ?
      UNION SELECT entity_id AS id FROM narrative_entity_alias WHERE book_id = ? AND alias = ?
      LIMIT 1
    `).get(bookId, name, bookId, name);
    if (hit) return hit.id;
  }
  return `text:${name}`;
}

/**
 * 蓝图场景对上保留场景（同章内）。优先级：
 *   1. 蓝图写了 sceneId，且是本章保留场景；
 *   2. 同序号——除非两边地点都写了且不同、人物又毫无重合（明显是另一场）；
 *   3. 地点相同且出场人物有重合。
 * 每个保留场景至多对上一个蓝图场景；按优先级分轮配对，避免前面的蓝图抢走后面更准的配对。
 */
function matchBlueprintToPreserved(
  storage: StorageDatabase,
  bookId: string,
  inputs: readonly BlueprintSceneInput[],
  preserved: readonly NarrativeScene[],
): Map<number, NarrativeScene> {
  const matches = new Map<number, NarrativeScene>();
  if (preserved.length === 0) return matches;
  const claimed = new Set<string>();
  const facts = preserved.map((scene) => ({
    scene,
    location: locationKey(storage, bookId, sceneLocationLabel(storage, scene)),
    characters: new Set(scene.characters.map((name) => name.trim()).filter(Boolean)),
  }));
  const inputFacts = inputs.map((input) => ({
    location: locationKey(storage, bookId, (input.summary ?? "").match(LOCATION_PREFIX)?.[1]?.trim() ?? null),
    characters: (input.characters ?? []).map((name) => name.trim()).filter(Boolean),
  }));
  const overlap = (a: Set<string>, b: readonly string[]) => b.some((name) => a.has(name));
  const claim = (index: number, scene: NarrativeScene) => {
    matches.set(index, scene);
    claimed.add(scene.id);
  };

  inputs.forEach((input, index) => {
    if (!input.targetSceneId) return;
    const hit = preserved.find((scene) => scene.id === input.targetSceneId && !claimed.has(scene.id));
    if (hit) claim(index, hit);
  });
  inputs.forEach((input, index) => {
    if (matches.has(index) || input.ordinal === undefined) return;
    const own = inputFacts[index]!;
    const hit = facts.find((fact) => {
      if (claimed.has(fact.scene.id) || fact.scene.ordinal !== input.ordinal) return false;
      const contradicts = fact.location !== null && own.location !== null && fact.location !== own.location
        && !overlap(fact.characters, own.characters);
      return !contradicts;
    });
    if (hit) claim(index, hit.scene);
  });
  inputs.forEach((_input, index) => {
    if (matches.has(index)) return;
    const own = inputFacts[index]!;
    if (own.location === null || own.characters.length === 0) return;
    const hit = facts.find((fact) => !claimed.has(fact.scene.id) && fact.location === own.location && overlap(fact.characters, own.characters));
    if (hit) claim(index, hit.scene);
  });
  return matches;
}

/**
 * 把蓝图并进作者场景：作者写过的一律保留（标题、摘要、冲突等非空字段、留白、状态与来源），
 * 只补作者没写的——空字段取蓝图值，人物与伏笔取并集，作者摘要没有地点时补上蓝图地点前缀，
 * 作者没有留白 / 节拍预算时才取蓝图的。
 */
function mergeBlueprintIntoScene(storage: StorageDatabase, scene: NarrativeScene, input: BlueprintSceneInput): NarrativeScene {
  const union = (own: readonly string[], extra: readonly string[] | undefined) => {
    const result = [...own];
    for (const item of extra ?? []) if (item.trim() && !result.includes(item)) result.push(item);
    return result;
  };
  const blueprintSummary = input.summary?.trim() ?? "";
  const blueprintPrefix = blueprintSummary.match(LOCATION_PREFIX)?.[0] ?? "";
  let summary = scene.summary;
  if (!summary.trim()) summary = blueprintSummary;
  else if (blueprintPrefix && !LOCATION_PREFIX.test(summary) && !scene.locationEntityId) summary = `${blueprintPrefix}${summary}`;
  const merged: NarrativeScene = {
    ...scene,
    title: scene.title.trim() ? scene.title : (input.title?.trim() ?? ""),
    summary,
    conflict: scene.conflict.trim() ? scene.conflict : (input.conflict?.trim() ?? ""),
    mood: scene.mood.trim() ? scene.mood : (input.mood?.trim() ?? ""),
    outcome: scene.outcome.trim() ? scene.outcome : (input.outcome?.trim() ?? ""),
    characters: union(scene.characters, input.characters),
    hooksUsed: union(scene.hooksUsed, input.hooksUsed),
    hooksPlanted: union(scene.hooksPlanted, input.hooksPlanted),
    ...(scene.beatBudget ? {} : input.beatBudget ? { beatBudget: [...input.beatBudget] } : {}),
    gaps: scene.gaps.length > 0 ? scene.gaps : parseSceneGaps(input.gaps ?? []),
    updatedAt: Math.max(Date.now(), scene.updatedAt + 1),
  };
  storage.sqlite.prepare(`
    UPDATE narrative_scene
    SET title = ?, summary = ?, conflict = ?, mood = ?, outcome = ?, characters_json = ?,
        hooks_used_json = ?, hooks_planted_json = ?, beat_budget_json = ?, gaps_json = ?, updated_at = ?
    WHERE id = ? AND book_id = ?
  `).run(
    merged.title, merged.summary, merged.conflict, merged.mood, merged.outcome,
    JSON.stringify(merged.characters), JSON.stringify(merged.hooksUsed), JSON.stringify(merged.hooksPlanted),
    merged.beatBudget ? JSON.stringify(merged.beatBudget) : null, JSON.stringify(merged.gaps), merged.updatedAt,
    merged.id, merged.bookId,
  );
  return merged;
}
