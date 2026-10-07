/**
 * 故事推进 · 章节网格数据层（纯函数，零副作用）。
 *
 * 视觉范式来自 Plottr：列 = 章，行 = 剧情线，格子 = 该线在该章的节拍。
 * 与旧 `story-map-board` 的关键区别是**权威源**：
 *  - 旧版读 `/narrative-line`，其规划节点派生自 `chapter_state_delta`（实测该表为空 → 必然空态）
 *  - 本模块直接读 经纬条目 + Narrative Memory 事件，数据实测存在（伏笔 52 / 冲突 4 / 事件 340）
 *
 * 所有解析都必须容错：实测数据里存在
 *  - `fields.status` 被写成整句话（脏值）
 *  - 21 条伏笔完全没有 status
 *  - `relatedChapterNumbers` 全为空，章号只能靠 `fields.plantedChapter` 或标题「第N章」
 * 解析不出来就记 `unknown`，绝不猜。
 */

// ─── 输入类型（对齐 /jingwei/entries 与 /narrative-memory/graph 的实际返回） ───

import type {
  NarrativeScene,
  NarrativeStoryline,
  SceneStorylineMount,
} from "../../engine/narrative-memory/scene-store.js";

export interface ProgressJingweiEntry {
  readonly id: string;
  readonly category?: string;
  readonly title?: string;
  readonly summaryMd?: string | null;
  readonly contentMd?: string;
  readonly fields?: Record<string, unknown>;
  readonly lifecycle?: string;
  readonly status?: string;
  readonly relatedChapterNumbers?: readonly unknown[];
}

export interface ProgressMemoryEvent {
  readonly id?: string;
  readonly chapterNumber?: number;
  readonly eventType?: string;
  readonly subject?: string;
  readonly predicate?: string;
  readonly object?: string;
  readonly evidenceText?: string;
  readonly riskLevel?: string;
  readonly subjectEntryId?: string;
}

export interface BuildStoryProgressBoardInput {
  // 原有派生数据（向下兼容老书）
  readonly chapterSummaries?: readonly ProgressJingweiEntry[];
  readonly foreshadowEntries?: readonly ProgressJingweiEntry[];
  readonly conflictEntries?: readonly ProgressJingweiEntry[];
  readonly events?: readonly ProgressMemoryEvent[];
  /** 作者当前所在章；缺省时取数据中的最大章号。 */
  readonly currentChapter?: number;
  /** 本书的伏笔阈值；缺省用默认值。 */
  readonly foreshadowThresholds?: ForeshadowDebtThresholds;
  /** 角色泳道上限，超出折叠。默认 4。 */
  readonly maxCharacterLanes?: number;

  // 任务 3 核心：真剧情线、场景与正交挂载数据
  readonly storylines?: readonly NarrativeStoryline[];
  readonly scenes?: readonly NarrativeScene[];
  readonly mounts?: readonly SceneStorylineMount[];

  // 叙事结构快照已算好的两样：给了就直接用，不再从散装条目推。
  /** 已写章节（章号 + 作者起的章名 + 张力分），章节轴的标题以它为准。 */
  readonly chapters?: readonly { readonly number: number; readonly title?: string; readonly tensionScore?: number }[];
  /** 服务端按作者阈值算好的伏笔债务；给了就不再用 foreshadowEntries 重算。 */
  readonly foreshadowDebts?: readonly ForeshadowDebt[];
}

// ─── 输出类型 ───

export type StoryProgressLaneKind =
  | "main"
  | "sub"
  | "romance"
  | "faction"
  | "mystery"
  | "character-arc"
  | "conflict"
  | "character"
  | "foreshadow"
  | "other";

export interface StoryProgressCell {
  readonly id: string;
  readonly title: string;
  readonly summary?: string;
  readonly status?: string;
  readonly entryId?: string;
  readonly chapterNumber: number;
}

export interface StoryProgressLane {
  readonly id: string;
  readonly kind: StoryProgressLaneKind;
  readonly title: string;
  readonly color: string;
  readonly cellsByChapter: Readonly<Record<number, readonly StoryProgressCell[]>>;
  /** 距今多少章没有节拍；无任何节拍时为 undefined。 */
  readonly chaptersSinceLastBeat?: number;
  /** 断档（连续 >= STALLED_LANE_GAP 章没推进）。 */
  readonly stalled: boolean;
  /** 泳道来源：真实剧情线为 storyline，自动推导派生为 derived。 */
  readonly source?: "storyline" | "derived";
  /** 若为真剧情线，对应的 narrative_storyline.id */
  readonly storylineId?: string;
  /** 剧情线生命周期（仅 storyline 时有）：planned / active / paused / resolved / abandoned */
  readonly lifecycle?: string;
}

export {
  type ForeshadowDebtStatus,
  type ForeshadowDebtUrgency,
  type ForeshadowDebt,
  DEBT_WATCH_CHAPTERS,
  DEBT_OVERDUE_CHAPTERS,
  trimTitle,
  resolveDebtStatus,
  debtUrgency,
  debtReason,
  buildForeshadowDebts,
} from "../../engine/narrative-taxonomy/foreshadow-debts.js";

import {
  type ForeshadowDebt,
  type ForeshadowDebtThresholds,
  buildForeshadowDebts,
  trimTitle,
} from "../../engine/narrative-taxonomy/foreshadow-debts.js";

export interface NextChapterFocus {
  readonly chapterNumber: number;
  readonly dueDebts: readonly ForeshadowDebt[];
  readonly stalledLanes: readonly StoryProgressLane[];
  readonly involvedCharacters: readonly string[];
}

export interface StoryProgressChapterColumn {
  readonly chapterNumber: number;
  readonly title: string;
  /** 未来章（> currentChapter）：网格里画虚线占位。 */
  readonly future: boolean;
  readonly tensionScore?: number;
}

export interface StoryProgressBoardExplanation {
  readonly title: string;
  readonly what: string;
  readonly why: string;
  readonly action: string;
}

/** 数据层模型；组件名 StoryProgressBoard 已被 tsx 占用，故此处带 Model 后缀。 */
export interface StoryProgressBoardModel {
  readonly chapters: readonly StoryProgressChapterColumn[];
  readonly lanes: readonly StoryProgressLane[];
  readonly debts: readonly ForeshadowDebt[];
  readonly focus: NextChapterFocus | null;
  readonly currentChapter: number;
  /** 被折叠的角色泳道数（超出 maxCharacterLanes 的部分）。 */
  readonly collapsedCharacterLanes: number;
  /** 是否存在真实剧情线（用于在真线与老书派生行之间提供渐进分流）。 */
  readonly hasRealStorylines: boolean;
  /** 当无真实剧情线时，提供任务书规范的三段式可操作提示说明。 */
  readonly explanation?: StoryProgressBoardExplanation;
}

// ─── 常量 ───

/** 剧情线断档判定：连续这么多章没有节拍就算停滞。 */
export const STALLED_LANE_GAP = 3;
/** 未来章预留列数。 */
export const FUTURE_CHAPTER_COLUMNS = 2;

const DEFAULT_MAX_CHARACTER_LANES = 4;

/** 低饱和分类色（暗底/亮底都可读，避免饱和亮色刺眼）。 */
export const LANE_COLORS: Record<StoryProgressLaneKind, string> = {
  main: "#7aa2f7",
  sub: "#2ac3de",
  romance: "#f7768e",
  faction: "#9ece6a",
  mystery: "#bb9af7",
  "character-arc": "#e0af68",
  conflict: "#f7768e",
  character: "#bb9af7",
  foreshadow: "#e0af68",
  other: "#a9b1d6",
};

export const LANE_KIND_LABEL: Record<StoryProgressLaneKind, string> = {
  main: "主线",
  sub: "支线",
  romance: "感情线",
  faction: "势力线",
  mystery: "悬疑线",
  "character-arc": "角色弧",
  conflict: "冲突",
  character: "角色",
  foreshadow: "伏笔",
  other: "其他",
};

const ARC_EVENT_TYPES = new Set(["character_state_changed", "relationship_changed"]);

// ─── 基础解析 ───

function text(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function toChapter(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
  return parsed;
}

/** 标题里的「第N章」回退（与 chronicle-helix-data 同口径）。 */
function chapterFromTitle(title: string | undefined): number | undefined {
  if (!title) return undefined;
  const match = /第\s*(\d+)\s*章/u.exec(title);
  return match ? toChapter(match[1]) : undefined;
}

function fields(entry: ProgressJingweiEntry): Record<string, unknown> {
  return entry.fields && typeof entry.fields === "object" ? entry.fields : {};
}

/**
 * 条目章号：fields 多键 → relatedChapterNumbers → 标题回退。
 * 实测该书 relatedChapterNumbers 全空，所以 fields 与标题回退是主力。
 */
function resolveEntryChapter(entry: ProgressJingweiEntry, ...keys: readonly string[]): number | undefined {
  const f = fields(entry);
  for (const key of keys) {
    const chapter = toChapter(f[key]);
    if (chapter !== undefined) return chapter;
  }
  for (const candidate of entry.relatedChapterNumbers ?? []) {
    const chapter = toChapter(candidate);
    if (chapter !== undefined) return chapter;
  }
  return chapterFromTitle(entry.title);
}

function entrySummary(entry: ProgressJingweiEntry): string | undefined {
  const candidate = text(entry.summaryMd ?? "") || text(entry.contentMd ?? "");
  return candidate ? candidate.slice(0, 120) : undefined;
}

// ─── 泳道 ───

function laneFromCells(
  id: string,
  kind: StoryProgressLaneKind,
  title: string,
  cells: readonly StoryProgressCell[],
  currentChapter: number,
  options?: {
    source?: "storyline" | "derived";
    storylineId?: string;
    lifecycle?: string;
  },
): StoryProgressLane {
  const cellsByChapter: Record<number, StoryProgressCell[]> = {};
  for (const cell of cells) {
    (cellsByChapter[cell.chapterNumber] ??= []).push(cell);
  }
  const chapters = cells.map((cell) => cell.chapterNumber);
  const lastBeat = chapters.length > 0 ? Math.max(...chapters) : undefined;
  const chaptersSinceLastBeat = lastBeat !== undefined ? Math.max(0, currentChapter - lastBeat) : undefined;
  return {
    id,
    kind,
    title: trimTitle(title, 22),
    color: LANE_COLORS[kind] ?? LANE_COLORS.other,
    cellsByChapter,
    ...(chaptersSinceLastBeat !== undefined ? { chaptersSinceLastBeat } : {}),
    // 完全没有节拍不算「断档」（那是还没开始），只有推进过又停下才算。
    // 「未收伏笔」行的格子是埋设章，不是推进节拍；它的催收归「该收的债」，不能算一条断档的线。
    stalled: kind !== "foreshadow" && chaptersSinceLastBeat !== undefined && chaptersSinceLastBeat >= STALLED_LANE_GAP,
    source: options?.source ?? "derived",
    ...(options?.storylineId ? { storylineId: options.storylineId } : {}),
    ...(options?.lifecycle ? { lifecycle: options.lifecycle } : {}),
  };
}

/** 角色泳道：从记忆事件聚合，按出场频次取 Top-N。 */
export function buildCharacterLanes(
  events: readonly ProgressMemoryEvent[],
  currentChapter: number,
  maxLanes: number,
): { lanes: StoryProgressLane[]; collapsed: number } {
  const byCharacter = new Map<string, StoryProgressCell[]>();
  for (const event of events) {
    if (!event.eventType || !ARC_EVENT_TYPES.has(event.eventType)) continue;
    const subject = text(event.subject);
    const chapterNumber = toChapter(event.chapterNumber);
    if (!subject || chapterNumber === undefined) continue;
    const description = text(event.evidenceText)
      || [text(event.predicate), text(event.object)].filter(Boolean).join("：")
      || "状态变化";
    const bucket = byCharacter.get(subject) ?? [];
    bucket.push({
      id: `character:${subject}:${chapterNumber}:${bucket.length}`,
      title: trimTitle(description, 24),
      summary: description.slice(0, 120),
      chapterNumber,
      ...(event.subjectEntryId ? { entryId: event.subjectEntryId } : {}),
    });
    byCharacter.set(subject, bucket);
  }
  const ranked = [...byCharacter.entries()]
    .sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]));
  const visible = ranked.slice(0, Math.max(0, maxLanes));
  return {
    lanes: visible.map(([name, cells]) => laneFromCells(`lane:character:${name}`, "character", name, cells, currentChapter)),
    collapsed: Math.max(0, ranked.length - visible.length),
  };
}

// ─── 章节轴 ───

function buildChapterColumns(
  summaries: readonly ProgressJingweiEntry[],
  events: readonly ProgressMemoryEvent[],
  currentChapter: number,
  written: BuildStoryProgressBoardInput["chapters"] = [],
): StoryProgressChapterColumn[] {
  const titleByChapter = new Map<number, string>();
  const tensionByChapter = new Map<number, number>();
  // 作者起的章名优先；摘要条目的标题多是「第N章」，此前列头因此成了「第 1 章 / 第 1 章」。
  for (const chapter of written ?? []) {
    const number = toChapter(chapter.number);
    if (number === undefined) continue;
    const title = typeof chapter.title === "string" ? chapter.title.trim() : "";
    if (title) titleByChapter.set(number, trimTitle(title, 18));
    if (typeof chapter.tensionScore === "number" && Number.isFinite(chapter.tensionScore) && chapter.tensionScore >= 0) {
      tensionByChapter.set(number, chapter.tensionScore);
    }
  }
  for (const entry of summaries) {
    const chapter = resolveEntryChapter(entry, "chapterNumber", "chapter_number");
    if (chapter === undefined) continue;
    const existing = titleByChapter.get(chapter);
    const title = trimTitle(entry.title, 18);
    if (!existing) titleByChapter.set(chapter, title);
    const f = fields(entry);
    const rawTension = typeof f.tension_score === "number" ? f.tension_score
      : typeof f.tensionScore === "number" ? f.tensionScore
      : Number(f.tension_score ?? f.tensionScore);
    // 负值是「评过但失败」的哨兵，与未评分同样按缺省处理
    if (Number.isFinite(rawTension) && rawTension >= 0 && !tensionByChapter.has(chapter)) tensionByChapter.set(chapter, rawTension);
  }
  for (const event of events) {
    const chapter = toChapter(event.chapterNumber);
    if (chapter !== undefined && !titleByChapter.has(chapter)) titleByChapter.set(chapter, `第 ${chapter} 章`);
  }

  const known = [...titleByChapter.keys()];
  const maxChapter = known.length > 0 ? Math.max(...known, currentChapter) : currentChapter;
  if (maxChapter <= 0) return [];

  const columns: StoryProgressChapterColumn[] = [];
  for (let chapter = 1; chapter <= maxChapter + FUTURE_CHAPTER_COLUMNS; chapter += 1) {
    const tension = tensionByChapter.get(chapter);
    columns.push({
      chapterNumber: chapter,
      title: titleByChapter.get(chapter) ?? `第 ${chapter} 章`,
      future: chapter > currentChapter,
      ...(tension !== undefined ? { tensionScore: tension } : {}),
    });
  }
  return columns;
}

function resolveCurrentChapter(input: BuildStoryProgressBoardInput): number {
  const explicit = toChapter(input.currentChapter);
  if (explicit !== undefined) return explicit;
  const chapters: number[] = [];
  for (const event of input.events ?? []) {
    const chapter = toChapter(event.chapterNumber);
    if (chapter !== undefined) chapters.push(chapter);
  }
  for (const entry of input.chapterSummaries ?? []) {
    const chapter = resolveEntryChapter(entry, "chapterNumber", "chapter_number");
    if (chapter !== undefined) chapters.push(chapter);
  }
  return chapters.length > 0 ? Math.max(...chapters) : 0;
}

// ─── 焦点列：回答「下一章该写什么」 ───

export function buildNextChapterFocus(
  currentChapter: number,
  lanes: readonly StoryProgressLane[],
  debts: readonly ForeshadowDebt[],
): NextChapterFocus | null {
  if (currentChapter <= 0) return null;
  const dueDebts = debts.filter((debt) => debt.urgency === "overdue" || debt.urgency === "watch").slice(0, 5);
  const stalledLanes = lanes.filter((lane) => lane.stalled);
  const involvedCharacters = stalledLanes
    .filter((lane) => lane.kind === "character")
    .map((lane) => lane.title);
  return {
    chapterNumber: currentChapter + 1,
    dueDebts,
    stalledLanes,
    involvedCharacters,
  };
}

// ─── 总装配 ───

export function buildStoryProgressBoard(input: BuildStoryProgressBoardInput): StoryProgressBoardModel {
  const currentChapter = resolveCurrentChapter(input);
  const events = input.events ?? [];
  const chapters = buildChapterColumns(input.chapterSummaries ?? [], events, currentChapter, input.chapters);

  // 1. 真剧情线优先装配（挂载场景）
  const storylines = input.storylines ?? [];
  const scenes = input.scenes ?? [];
  const mounts = input.mounts ?? [];
  const hasRealStorylines = storylines.length > 0;

  const realStorylineLanes: StoryProgressLane[] = [];
  if (hasRealStorylines) {
    const sceneMap = new Map(scenes.map((s) => [s.id, s]));
    const mountsByLine = new Map<string, string[]>();
    for (const m of mounts) {
      const list = mountsByLine.get(m.storylineId) ?? [];
      list.push(m.sceneId);
      mountsByLine.set(m.storylineId, list);
    }

    for (const line of storylines) {
      const sceneIds = mountsByLine.get(line.id) ?? [];
      const lineCells: StoryProgressCell[] = [];
      for (const sid of sceneIds) {
        const sc = sceneMap.get(sid);
        if (!sc) continue;
        lineCells.push({
          id: `scene:${sc.id}`,
          title: trimTitle(sc.title || `第 ${sc.ordinal} 场`, 24),
          summary: sc.summary || sc.conflict || undefined,
          chapterNumber: sc.chapterNumber,
          status: sc.status,
        });
      }
      realStorylineLanes.push(
        laneFromCells(
          line.id,
          (line.kind as StoryProgressLaneKind) || "other",
          line.name,
          lineCells,
          currentChapter,
          {
            source: "storyline",
            storylineId: line.id,
            lifecycle: line.lifecycle,
          },
        ),
      );
    }
  }

  // 2. 派生泳道（向下兼容老书与补充）：主线、冲突、角色、未收伏笔
  const mainCells: StoryProgressCell[] = [];
  for (const entry of input.chapterSummaries ?? []) {
    const chapter = resolveEntryChapter(entry, "chapterNumber", "chapter_number");
    if (chapter === undefined) continue;
    mainCells.push({
      id: `main:${entry.id}`,
      title: trimTitle(entry.title, 24),
      ...(entrySummary(entry) ? { summary: entrySummary(entry) } : {}),
      chapterNumber: chapter,
      entryId: entry.id,
      ...(entry.status ? { status: entry.status } : {}),
    });
  }

  // 冲突：每条冲突条目一条泳道
  const conflictLanes = (input.conflictEntries ?? []).map((entry) => {
    const chapter = resolveEntryChapter(entry, "chapterStart", "firstChapter", "chapterNumber");
    const cells: StoryProgressCell[] = chapter !== undefined
      ? [{
        id: `conflict:${entry.id}`,
        title: trimTitle(entrySummary(entry) ?? entry.title, 24),
        ...(entrySummary(entry) ? { summary: entrySummary(entry) } : {}),
        chapterNumber: chapter,
        entryId: entry.id,
        ...(entry.status ? { status: entry.status } : {}),
      }]
      : [];
    return laneFromCells(
      `lane:conflict:${entry.id}`,
      "conflict",
      entry.title ?? "冲突",
      cells,
      currentChapter,
      { source: "derived" },
    );
  });

  // 快照路径此前只传了剧情线与场景：伏笔债务永远是空的，「该收的债」与底部账本都显示没有伏笔。
  const debts = input.foreshadowDebts
    ? [...input.foreshadowDebts]
    : buildForeshadowDebts(input.foreshadowEntries ?? [], currentChapter, input.foreshadowThresholds);

  // 伏笔泳道：只画未回收的（已回收的进债务行的历史区，不占网格）
  const foreshadowCells: StoryProgressCell[] = [];
  for (const debt of debts) {
    if (debt.status === "paid_off" || debt.plantedChapter === undefined) continue;
    foreshadowCells.push({
      id: `foreshadow:${debt.entryId}`,
      title: debt.title,
      summary: debt.reason,
      chapterNumber: debt.plantedChapter,
      entryId: debt.entryId,
      status: debt.status,
    });
  }

  const { lanes: characterLanes, collapsed } = buildCharacterLanes(
    events,
    currentChapter,
    input.maxCharacterLanes ?? DEFAULT_MAX_CHARACTER_LANES,
  );

  const derivedLanes: StoryProgressLane[] = [
    // 如果已有真主线，派生主线标注为章节摘要；它一格都没有时不画——有真剧情线时那只是一行空壳。
    ...(hasRealStorylines && mainCells.length === 0
      ? []
      : [laneFromCells(
          "lane:main",
          "main",
          hasRealStorylines ? "章节摘要 (自动归类)" : "主线",
          mainCells,
          currentChapter,
          { source: "derived" },
        )]),
    ...conflictLanes,
    ...characterLanes.map((l) => ({ ...l, source: "derived" as const })),
    ...(foreshadowCells.length > 0
      ? [laneFromCells("lane:foreshadow", "foreshadow", "未收伏笔", foreshadowCells, currentChapter, { source: "derived" })]
      : []),
  ];

  // 排序组合：真剧情线在上，派生行在下
  const lanes: StoryProgressLane[] = hasRealStorylines
    ? [...realStorylineLanes, ...derivedLanes]
    : derivedLanes;

  const explanation = !hasRealStorylines
    ? {
        title: "当前显示自动推导泳道",
        what: "本书尚未建立结构化剧情线，当前视图按章节摘要、冲突和角色出场频次自动归类为派生泳道。",
        why: "正式剧情线可跨越多章挂载具体场景，并精准计算断档与推进节奏；派生泳道为兼容展示。",
        action: "建议在故事推进或大纲中创建第一条正式剧情线，让网格呈现清晰的因果脉络。",
      }
    : undefined;

  return {
    chapters,
    lanes,
    debts,
    focus: buildNextChapterFocus(currentChapter, lanes, debts),
    currentChapter,
    collapsedCharacterLanes: collapsed,
    hasRealStorylines,
    ...(explanation ? { explanation } : {}),
  };
}

/** 取某条泳道在某章的格子（组件渲染用，避免在 JSX 里索引可能缺失的键）。 */
export function cellsForChapter(lane: StoryProgressLane, chapterNumber: number): readonly StoryProgressCell[] {
  return lane.cellsByChapter[chapterNumber] ?? [];
}

/** 网格是否有可展示内容：判空态用，避免「有章节但全是空行」也显示成正常网格。 */
export function hasProgressContent(board: StoryProgressBoardModel): boolean {
  return board.chapters.length > 0
    && board.lanes.some((lane) => Object.keys(lane.cellsByChapter).length > 0);
}
