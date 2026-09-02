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
  readonly chapterSummaries?: readonly ProgressJingweiEntry[];
  readonly foreshadowEntries?: readonly ProgressJingweiEntry[];
  readonly conflictEntries?: readonly ProgressJingweiEntry[];
  readonly events?: readonly ProgressMemoryEvent[];
  /** 作者当前所在章；缺省时取数据中的最大章号。 */
  readonly currentChapter?: number;
  /** 角色泳道上限，超出折叠。默认 4。 */
  readonly maxCharacterLanes?: number;
}

// ─── 输出类型 ───

export type StoryProgressLaneKind = "main" | "conflict" | "character" | "foreshadow";

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
}

export type ForeshadowDebtStatus = "planted" | "triggered" | "paid_off" | "unknown";
export type ForeshadowDebtUrgency = "ok" | "watch" | "overdue";

export interface ForeshadowDebt {
  readonly id: string;
  readonly title: string;
  readonly entryId: string;
  readonly plantedChapter?: number;
  readonly payoffChapter?: number;
  readonly status: ForeshadowDebtStatus;
  /** 已悬置章数（仅未回收且有埋设章时给出）。 */
  readonly chaptersPending?: number;
  readonly urgency: ForeshadowDebtUrgency;
  /** 给作者看的一句话理由。 */
  readonly reason: string;
}

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

/** 数据层模型；组件名 StoryProgressBoard 已被 tsx 占用，故此处带 Model 后缀。 */
export interface StoryProgressBoardModel {
  readonly chapters: readonly StoryProgressChapterColumn[];
  readonly lanes: readonly StoryProgressLane[];
  readonly debts: readonly ForeshadowDebt[];
  readonly focus: NextChapterFocus | null;
  readonly currentChapter: number;
  /** 被折叠的角色泳道数（超出 maxCharacterLanes 的部分）。 */
  readonly collapsedCharacterLanes: number;
}

// ─── 常量 ───

/** 剧情线断档判定：连续这么多章没有节拍就算停滞。 */
export const STALLED_LANE_GAP = 3;
/** 伏笔悬置警戒线（章）。 */
export const DEBT_WATCH_CHAPTERS = 5;
export const DEBT_OVERDUE_CHAPTERS = 12;
/** 未来章预留列数。 */
export const FUTURE_CHAPTER_COLUMNS = 2;

const DEFAULT_MAX_CHARACTER_LANES = 4;

/** 低饱和分类色（暗底/亮底都可读，避免饱和亮色刺眼）。 */
export const LANE_COLORS: Record<StoryProgressLaneKind, string> = {
  main: "#7aa2f7",
  conflict: "#f7768e",
  character: "#bb9af7",
  foreshadow: "#e0af68",
};

export const LANE_KIND_LABEL: Record<StoryProgressLaneKind, string> = {
  main: "主线",
  conflict: "冲突",
  character: "角色",
  foreshadow: "伏笔",
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

/** 标题裁剪：实测有把整段正文当标题的条目，网格里必须截断（全文走 hover）。 */
export function trimTitle(value: string | undefined, maxLength = 28): string {
  const normalized = text(value);
  if (!normalized) return "未命名";
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`;
}

function entrySummary(entry: ProgressJingweiEntry): string | undefined {
  const candidate = text(entry.summaryMd ?? "") || text(entry.contentMd ?? "");
  return candidate ? candidate.slice(0, 120) : undefined;
}

/**
 * 伏笔状态：只认白名单枚举值。
 * 实测有一条把整句话写进 `fields.status`，这类脏值必须落到 unknown，
 * 再由 payoffChapter 是否存在做二次推断。
 */
export function resolveDebtStatus(entry: ProgressJingweiEntry): ForeshadowDebtStatus {
  const raw = text(fields(entry).status).toLowerCase();
  if (raw === "paid_off" || raw === "paid-off" || raw === "resolved") return "paid_off";
  if (raw === "triggered" || raw === "paying_off" || raw === "唤醒中") return "triggered";
  if (raw === "planted" || raw === "open" || raw === "pending" || raw === "reinforced") return "planted";
  // 脏值/缺失 → 用 payoffChapter 推断，推不出记 unknown（不猜）
  const payoff = toChapter(fields(entry).payoffChapter);
  if (payoff !== undefined) return "paid_off";
  const planted = toChapter(fields(entry).plantedChapter);
  if (planted !== undefined) return "planted";
  return "unknown";
}

function debtUrgency(status: ForeshadowDebtStatus, chaptersPending: number | undefined): ForeshadowDebtUrgency {
  if (status === "paid_off") return "ok";
  if (status === "triggered") return "overdue";
  if (chaptersPending === undefined) return "watch";
  if (chaptersPending >= DEBT_OVERDUE_CHAPTERS) return "overdue";
  if (chaptersPending >= DEBT_WATCH_CHAPTERS) return "watch";
  return "ok";
}

function debtReason(
  status: ForeshadowDebtStatus,
  plantedChapter: number | undefined,
  payoffChapter: number | undefined,
  chaptersPending: number | undefined,
): string {
  if (status === "paid_off") {
    return payoffChapter !== undefined ? `已在第 ${payoffChapter} 章回收` : "已标记回收";
  }
  if (status === "triggered") {
    return "触发条件已满足，尚未兑现——本章应推进或回收";
  }
  if (status === "unknown") {
    return "状态未标注，无法判断是否已回收——建议补一次状态";
  }
  if (plantedChapter === undefined) return "已埋设，但没有记录埋在第几章";
  if (chaptersPending === undefined) return `埋于第 ${plantedChapter} 章`;
  if (chaptersPending <= 0) return `刚埋于第 ${plantedChapter} 章`;
  return `埋于第 ${plantedChapter} 章，已悬 ${chaptersPending} 章未回收`;
}

// ─── 伏笔债务 ───

export function buildForeshadowDebts(
  entries: readonly ProgressJingweiEntry[],
  currentChapter: number,
): ForeshadowDebt[] {
  const debts: ForeshadowDebt[] = [];
  for (const entry of entries) {
    // archived 生命周期视为作者已放弃，不计入债务
    if (entry.lifecycle === "archived" || entry.lifecycle === "retired") continue;
    const f = fields(entry);
    const plantedChapter = toChapter(f.plantedChapter) ?? chapterFromTitle(entry.title);
    const payoffChapter = toChapter(f.payoffChapter);
    const status = resolveDebtStatus(entry);
    const chaptersPending = status !== "paid_off" && plantedChapter !== undefined
      ? Math.max(0, currentChapter - plantedChapter)
      : undefined;
    debts.push({
      id: `debt:${entry.id}`,
      title: trimTitle(entry.title, 34),
      entryId: entry.id,
      ...(plantedChapter !== undefined ? { plantedChapter } : {}),
      ...(payoffChapter !== undefined ? { payoffChapter } : {}),
      status,
      ...(chaptersPending !== undefined ? { chaptersPending } : {}),
      urgency: debtUrgency(status, chaptersPending),
      reason: debtReason(status, plantedChapter, payoffChapter, chaptersPending),
    });
  }
  // 超期最久的排最前；已回收沉底
  const urgencyRank: Record<ForeshadowDebtUrgency, number> = { overdue: 0, watch: 1, ok: 2 };
  return debts.sort((left, right) => (
    urgencyRank[left.urgency] - urgencyRank[right.urgency]
    || (right.chaptersPending ?? -1) - (left.chaptersPending ?? -1)
    || left.title.localeCompare(right.title)
  ));
}

// ─── 泳道 ───

function laneFromCells(
  id: string,
  kind: StoryProgressLaneKind,
  title: string,
  cells: readonly StoryProgressCell[],
  currentChapter: number,
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
    color: LANE_COLORS[kind],
    cellsByChapter,
    ...(chaptersSinceLastBeat !== undefined ? { chaptersSinceLastBeat } : {}),
    // 完全没有节拍不算「断档」（那是还没开始），只有推进过又停下才算
    stalled: chaptersSinceLastBeat !== undefined && chaptersSinceLastBeat >= STALLED_LANE_GAP,
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
): StoryProgressChapterColumn[] {
  const titleByChapter = new Map<number, string>();
  const tensionByChapter = new Map<number, number>();
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
    if (Number.isFinite(rawTension) && rawTension >= 0) tensionByChapter.set(chapter, rawTension);
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
  const chapters = buildChapterColumns(input.chapterSummaries ?? [], events, currentChapter);

  // 主线：章摘要本身
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
    return laneFromCells(`lane:conflict:${entry.id}`, "conflict", entry.title ?? "冲突", cells, currentChapter);
  });

  const debts = buildForeshadowDebts(input.foreshadowEntries ?? [], currentChapter);

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

  const lanes: StoryProgressLane[] = [
    laneFromCells("lane:main", "main", "主线", mainCells, currentChapter),
    ...conflictLanes,
    ...characterLanes,
    ...(foreshadowCells.length > 0
      ? [laneFromCells("lane:foreshadow", "foreshadow", "未收伏笔", foreshadowCells, currentChapter)]
      : []),
  ];

  return {
    chapters,
    lanes,
    debts,
    focus: buildNextChapterFocus(currentChapter, lanes, debts),
    currentChapter,
    collapsedCharacterLanes: collapsed,
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
