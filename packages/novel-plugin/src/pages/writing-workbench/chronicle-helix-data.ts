/**
 * G9 全息编年史双螺旋 · 数据聚合层（纯函数，零副作用）。
 *
 * 两条轨的数据来源：
 *  - 表世界（A）：chapter-summaries 类目条目（章号 + 摘要 + 张力分）
 *  - 里世界（B）：narrative-memory event_chain 视图（返回全部事件类型，
 *    由 extractChronicleArcEvents 过滤 character_state_changed / relationship_changed）
 * 交汇点 = 关键冲突/转折章节：conflict 类目事实、high 风险事件、张力≥8 任一命中。
 */

export interface ChronicleSummaryInput {
  readonly fields?: Record<string, unknown>;
  readonly title?: string;
  readonly contentMd?: string;
  readonly summaryMd?: string;
  /** 经纬条目顶层的关联章号（fields 缺章号时的回退来源之一）。 */
  readonly relatedChapterNumbers?: readonly unknown[];
}

export interface ChronicleGraphPayload {
  readonly facts?: ReadonlyArray<{ category?: string; sourceChapter?: number }>;
  readonly events?: ReadonlyArray<{
    readonly subject?: string;
    readonly chapterNumber?: number;
    readonly eventType?: string;
    readonly riskLevel?: string;
    readonly evidenceText?: string;
    readonly predicate?: string;
    readonly object?: string;
    readonly subjectEntryId?: string;
  }>;
}

export interface ChronicleBeat {
  readonly chapterNumber: number;
  readonly summary: string;
  readonly tensionScore?: number;
}

export interface ChronicleArcEvent {
  readonly chapterNumber: number;
  readonly characterName: string;
  readonly entryId?: string;
  readonly description: string;
}

export type ChronicleIntersectionReason = "conflict-fact" | "high-risk" | "tension-peak";

export interface ChronicleIntersection {
  readonly chapterNumber: number;
  readonly reasons: readonly ChronicleIntersectionReason[];
  /** 交叉点摘要标签：优先取该章主线摘要首句。 */
  readonly label: string;
}

export interface ChronicleCharacter {
  readonly name: string;
  readonly entryId?: string;
  readonly eventCount: number;
}

export interface ChronicleHelixModel {
  /** 升序章节轴。 */
  readonly chapters: readonly number[];
  readonly strandA: ReadonlyMap<number, ChronicleBeat>;
  readonly strandB: ReadonlyMap<number, readonly ChronicleArcEvent[]>;
  readonly intersections: readonly ChronicleIntersection[];
  readonly topCharacters: readonly ChronicleCharacter[];
}

const TENSION_PEAK_THRESHOLD = 8;
const TOP_CHARACTER_LIMIT = 8;
/** 每章弧线节点最多展示数；超出聚合计数。 */
export const MAX_ARC_NODES_PER_CHAPTER = 3;

function toNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** 合理章号：正整数（章号从 1 起，浮点/零/负数不接受）。 */
function toChapterNumber(value: unknown): number | undefined {
  const parsed = toNumber(value);
  if (parsed === undefined || parsed <= 0 || !Number.isInteger(parsed)) return undefined;
  return parsed;
}

/** 从标题回退提取章号：匹配「第N章」（支持全角/半角数字前缀）。 */
function chapterFromTitle(title: string | undefined): number | undefined {
  if (!title) return undefined;
  const match = /第\s*(\d+)\s*章/u.exec(title);
  return match ? toChapterNumber(match[1]) : undefined;
}

/**
 * 章号提取（多路径，解析失败才丢弃）：
 * ① fields.chapterNumber / fields.chapter_number
 * ② relatedChapterNumbers 中第一个合理章号
 * ③ 标题「第N章」回退
 */
function resolveChapterNumber(entry: ChronicleSummaryInput, fields: Record<string, unknown>): number | undefined {
  const fromFields = toChapterNumber(fields.chapterNumber) ?? toChapterNumber(fields.chapter_number);
  if (fromFields !== undefined) return fromFields;
  for (const candidate of entry.relatedChapterNumbers ?? []) {
    const chapter = toChapterNumber(candidate);
    if (chapter !== undefined) return chapter;
  }
  return chapterFromTitle(entry.title);
}

/** 摘要内容兼容 summaryMd / contentMd / fields.summary，无数据诚实降级为空串。 */
function resolveSummary(entry: ChronicleSummaryInput, fields: Record<string, unknown>): string {
  const candidates = [entry.summaryMd, entry.contentMd, fields.summary];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "";
}

/**
 * 复合主体拆分：把「薛行之与方工」「薛行之、方工」「薛行之和方工」等
 * 拆成独立角色。括号内一般是别名/补充说明，不拆——整体保留后统一裁剪括号。
 */
export function splitCompositeSubject(subject: string): string[] {
  const trimmed = subject.trim();
  if (!trimmed) return [];
  // 括号内含分隔符时视为别名/说明，不参与拆分：先摘出括号段，只对括号外的主体拆分。
  const hasBracket = /[（(].*[）)]/u.test(trimmed);
  if (hasBracket) {
    const stripped = trimmed.replace(/[（(][^（()）]*[）)]/gu, "").trim();
    // 去掉括号后若仍是单主体，直接返回原始（保留别名括号，交由展示层处理）。
    const outerParts = stripped.split(/[、，,]|与|和|及|跟/u).map((part) => part.trim()).filter(Boolean);
    if (outerParts.length <= 1) return [trimmed];
    return outerParts;
  }
  const parts = trimmed
    .split(/[、，,]|与|和|及|跟/u)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [trimmed];
}

function firstSentence(text: string, maxLength = 42): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const sentence = trimmed.split(/[。！？\n]/u).find((part) => part.trim().length > 0) ?? trimmed;
  return sentence.trim().slice(0, maxLength);
}

/**
 * 主线节拍：从 chapter-summaries 条目提取。
 * 章号多路径回退（fields.chapterNumber / chapter_number → relatedChapterNumbers → 标题「第N章」），
 * 全部解析失败才丢弃；摘要兼容 summaryMd/contentMd/fields.summary；张力保持 snake/camel 双键。
 *
 * 同章出现多条（历史双轨残留）时确定性收敛：优先保留 fields 带章号的权威条（auto-settle），
 * 其次保留摘要文本更长者——保证主线链不因条目顺序抖动。
 */
export function extractChronicleBeats(entries: readonly ChronicleSummaryInput[]): ChronicleBeat[] {
  const byChapter = new Map<number, { beat: ChronicleBeat; canonical: boolean }>();
  for (const entry of entries) {
    const fields = typeof entry.fields === "object" && entry.fields !== null ? entry.fields : {};
    const chapterNumber = resolveChapterNumber(entry, fields);
    if (chapterNumber === undefined) continue;
    const summary = resolveSummary(entry, fields);
    const rawTension = fields.tension_score ?? fields.tensionScore;
    const parsedTension = toNumber(rawTension);
    // T1 哨兵语义：负值 = 已尝试评分但失败（未评估），与「从未评分」同样按缺省处理。
    const tensionScore = parsedTension !== undefined && parsedTension >= 0 ? parsedTension : undefined;
    const beat: ChronicleBeat = {
      chapterNumber,
      summary,
      ...(tensionScore !== undefined ? { tensionScore } : {}),
    };
    const canonical = toChapterNumber(fields.chapterNumber) !== undefined || toChapterNumber(fields.chapter_number) !== undefined;
    const existing = byChapter.get(chapterNumber);
    if (!existing) {
      byChapter.set(chapterNumber, { beat, canonical });
      continue;
    }
    // 权威条覆盖非权威条；两个同为权威/同为非权威时，摘要更长者胜出。
    const challengerWins = canonical && !existing.canonical
      ? true
      : canonical === existing.canonical && beat.summary.length > existing.beat.summary.length;
    if (challengerWins) byChapter.set(chapterNumber, { beat, canonical });
  }
  return [...byChapter.values()]
    .map((item) => item.beat)
    .sort((a, b) => a.chapterNumber - b.chapterNumber);
}

/**
 * 角色弧线事件：只收 character_state_changed / relationship_changed，
 * 且 subject 可识别的记录；复合主体（「薛行之与方工」）拆成独立角色节点，
 * 每个拆分后的事件保留原 subjectEntryId；描述优先证据文本。
 */
export function extractChronicleArcEvents(graph: ChronicleGraphPayload): ChronicleArcEvent[] {
  const arcTypes = new Set(["character_state_changed", "relationship_changed"]);
  const result: ChronicleArcEvent[] = [];
  for (const event of graph.events ?? []) {
    if (!event.eventType || !arcTypes.has(event.eventType)) continue;
    const rawSubject = event.subject?.trim();
    const chapterNumber = toNumber(event.chapterNumber);
    if (!rawSubject || chapterNumber === undefined) continue;
    const description =
      event.evidenceText?.trim()
      || [event.predicate, event.object].filter((value): value is string => typeof value === "string" && value.trim().length > 0).join("：")
      || "状态发生变化";
    for (const characterName of splitCompositeSubject(rawSubject)) {
      result.push({
        chapterNumber,
        characterName,
        ...(event.subjectEntryId ? { entryId: event.subjectEntryId } : {}),
        description,
      });
    }
  }
  return result.sort((a, b) => a.chapterNumber - b.chapterNumber);
}

/** 出场频次 Top-N 角色（供 B 链着色与图例）。 */
export function pickTopCharacters(arcEvents: readonly ChronicleArcEvent[]): ChronicleCharacter[] {
  const byName = new Map<string, ChronicleCharacter>();
  for (const event of arcEvents) {
    const existing = byName.get(event.characterName) ?? { name: event.characterName, eventCount: 0 };
    byName.set(event.characterName, {
      name: event.characterName,
      eventCount: existing.eventCount + 1,
      // 取该角色任一命中身份链的 entryId。
      ...(existing.entryId ?? event.entryId ? { entryId: existing.entryId ?? event.entryId } : {}),
    });
  }
  return [...byName.values()]
    .sort((a, b) => b.eventCount - a.eventCount || a.name.localeCompare(b.name))
    .slice(0, TOP_CHARACTER_LIMIT);
}

/**
 * 交叉点 = 关键冲突/转折章节，三来源任一命中：
 * ① conflict 类目事实；② high 风险事件；③ 张力≥8 的主线节拍。
 */
export function findChronicleIntersections(
  beats: readonly ChronicleBeat[],
  graph: ChronicleGraphPayload,
): ChronicleIntersection[] {
  const byChapter = new Map<number, { reasons: Set<ChronicleIntersectionReason>; label: string }>();
  const beatByChapter = new Map(beats.map((beat) => [beat.chapterNumber, beat]));
  const touch = (chapterNumber: number, reason: ChronicleIntersectionReason) => {
    const entry = byChapter.get(chapterNumber) ?? { reasons: new Set<ChronicleIntersectionReason>(), label: "" };
    entry.reasons.add(reason);
    byChapter.set(chapterNumber, entry);
  };

  for (const fact of graph.facts ?? []) {
    if (fact.category === "conflict") {
      const chapter = toNumber(fact.sourceChapter);
      if (chapter !== undefined) touch(chapter, "conflict-fact");
    }
  }
  for (const event of graph.events ?? []) {
    if (event.riskLevel === "high") {
      const chapter = toNumber(event.chapterNumber);
      if (chapter !== undefined) touch(chapter, "high-risk");
    }
  }
  for (const beat of beats) {
    if (beat.tensionScore !== undefined && beat.tensionScore >= TENSION_PEAK_THRESHOLD) {
      touch(beat.chapterNumber, "tension-peak");
    }
  }

  return [...byChapter.entries()]
    .map(([chapterNumber, entry]) => ({
      chapterNumber,
      reasons: [...entry.reasons],
      label: firstSentence(beatByChapter.get(chapterNumber)?.summary ?? ""),
    }))
    .sort((a, b) => a.chapterNumber - b.chapterNumber);
}

/** 总装配：两条链 + 章节轴 + 交叉点 + Top 角色。 */
export function buildChronicleHelixModel(
  summaries: readonly ChronicleSummaryInput[],
  graph: ChronicleGraphPayload,
): ChronicleHelixModel {
  const beats = extractChronicleBeats(summaries);
  const arcEvents = extractChronicleArcEvents(graph);

  const strandA = new Map<number, ChronicleBeat>();
  for (const beat of beats) strandA.set(beat.chapterNumber, beat);

  const grouped = new Map<number, ChronicleArcEvent[]>();
  for (const event of arcEvents) {
    const bucket = grouped.get(event.chapterNumber) ?? [];
    bucket.push(event);
    grouped.set(event.chapterNumber, bucket);
  }

  const chapters = [...new Set([...strandA.keys(), ...grouped.keys()])].sort((a, b) => a - b);
  return {
    chapters,
    strandA,
    strandB: grouped,
    intersections: findChronicleIntersections(beats, graph),
    topCharacters: pickTopCharacters(arcEvents),
  };
}
