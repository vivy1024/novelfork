/**
 * 故事时间线：结算抽出的故事内时间锚（迁移 0043 narrative_story_time_anchor）→ 按章累积的单调时间轴。
 *
 * 只存抽取原件（说法 + 原文证据 + 归一字段 + 置信度）；时间轴、推算链、未来约定与时间矛盾一律现算，
 * 改写前面的章后后面跟着变，不存在「推算结果过期」。
 *
 * 时间刻度：「故事日」。第一处时间说法记为第 0 日；相对说法（「三天后」「次日」）在上一锚上加偏移；
 * 历法说法（「天元三年春」）出现后建立历法零点，之后历法日与相对日可以互相换算。
 * 历法按每年 360 日、每季 90 日、每月 30 日近似——网文历法本就粗，够判断先后与大致间隔。
 *
 * 矛盾只告警、不自动改：倒流（历法说法比当前更早，可能是倒叙）、同一人同时在两地（「与此同时」的两章
 * 里同一人物所在不同）、年龄对不上（按经过的年数推算的年龄与正文说法差一岁以上，或年龄变小）。
 */

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import type { DiagnosticExplanation } from "../../handlers/diagnostic-explanation.js";
import { tableExists } from "../book-archive/sql.js";

export const STORY_TIME_ANCHOR_KINDS = ["absolute", "relative", "simultaneous", "deadline", "age"] as const;
export type StoryTimeAnchorKind = (typeof STORY_TIME_ANCHOR_KINDS)[number];

export const STORY_SEASONS = ["春", "夏", "秋", "冬"] as const;
export type StorySeason = (typeof STORY_SEASONS)[number];

export interface StoryCalendar {
  /** 年号 / 纪年名（「天元」「大周」）；不同年号之间的年份不比较。 */
  readonly era?: string;
  readonly year?: number;
  readonly season?: StorySeason;
  readonly month?: number;
  readonly day?: number;
}

/** 抽取器给出的一条时间锚（落库前）。 */
export interface StoryTimeAnchorDraft {
  readonly kind: StoryTimeAnchorKind;
  /** 正文里的时间说法本身（「三天后」「天元三年春」「与此同时」）。 */
  readonly expression: string;
  /** 正文原文短摘录。 */
  readonly evidenceText: string;
  readonly confidence: number;
  readonly calendar?: StoryCalendar;
  /** relative：距上一锚经过的天数；deadline：距此刻还有几天。 */
  readonly offsetDays?: number;
  /** deadline：约定的事（「决战」「开榜」）。 */
  readonly event?: string;
  /** age：谁的年龄。 */
  readonly subject?: string;
  readonly age?: number;
}

export interface StoryTimeAnchorRecord extends StoryTimeAnchorDraft {
  readonly id: string;
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly ordinal: number;
}

// ---------------------------------------------------------------- 归一与解析

const CN_DIGITS: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CN_UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };

/** 中文数字或阿拉伯数字 → 数值；「十五」「二十三」「一百零八」「3」。解析不了返回 undefined。 */
export function parseChineseNumber(text: string): number | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (/^\d+(?:\.\d+)?$/u.test(trimmed)) return Number(trimmed);
  let total = 0;
  let current = 0;
  let seen = false;
  for (const char of trimmed) {
    if (char in CN_DIGITS) {
      current = CN_DIGITS[char]!;
      seen = true;
    } else if (char in CN_UNITS) {
      total += (current === 0 ? 1 : current) * CN_UNITS[char]!;
      current = 0;
      seen = true;
    } else {
      return undefined;
    }
  }
  return seen ? total + current : undefined;
}

const UNIT_DAYS: ReadonlyArray<readonly [RegExp, number]> = [
  [/^(?:个)?(?:时辰|刻钟|刻|炷香|盏茶)$/u, 0],
  [/^(?:天|日|夜|宿)$/u, 1],
  [/^(?:周|星期|礼拜)$/u, 7],
  [/^旬$/u, 10],
  [/^(?:个)?月$/u, 30],
  [/^(?:个)?季$/u, 90],
  [/^(?:年|载|春秋)$/u, 360],
];

const FIXED_OFFSETS: ReadonlyArray<readonly [RegExp, number]> = [
  [/大后天|大后日/u, 3],
  [/后天|后日/u, 2],
  [/次日|翌日|第二天|第二日|隔天|隔日|明天|明日|次晨|翌晨|转天/u, 1],
  [/当夜|当晚|当天|当日|是夜|是日|片刻|半晌|不多时|同日|当即/u, 0],
];

/**
 * 从相对时间说法里读出天数：「三天后」「过了半个月」「十年之后」「次日」。
 * 读不出返回 undefined（交给抽取器给的 offsetDays，都没有就不推进时间）。
 */
export function parseRelativeOffsetDays(expression: string): number | undefined {
  const text = expression.replace(/\s+/gu, "");
  const half = /半(个)?(月|年|旬)/u.exec(text);
  if (half) return half[2] === "月" ? 15 : half[2] === "年" ? 180 : 5;
  const counted = /([0-9]+|[零〇一二两三四五六七八九十百千]+)(?:多)?(个)?(时辰|刻钟|刻|炷香|盏茶|天|日|夜|宿|周|星期|礼拜|旬|月|季|年|载|春秋)/u.exec(text);
  if (counted) {
    const amount = parseChineseNumber(counted[1]!);
    const unit = `${counted[2] ?? ""}${counted[3]!}`;
    const days = UNIT_DAYS.find(([pattern]) => pattern.test(unit))?.[1];
    if (amount !== undefined && days !== undefined) return Math.round(amount * days);
  }
  for (const [pattern, days] of FIXED_OFFSETS) {
    if (pattern.test(text)) return days;
  }
  return undefined;
}

function seasonOfMonth(month: number): StorySeason {
  return STORY_SEASONS[Math.min(3, Math.max(0, Math.floor((month - 1) / 3)))]!;
}

/** 历法 → 历法日（每年 360 / 每季 90 / 每月 30）。没有年份时只算年内日。 */
function calendarDayWithinYear(calendar: StoryCalendar): number | undefined {
  if (calendar.month !== undefined) return (calendar.month - 1) * 30 + Math.max(0, (calendar.day ?? 1) - 1);
  if (calendar.season !== undefined) return STORY_SEASONS.indexOf(calendar.season) * 90 + Math.max(0, (calendar.day ?? 1) - 1);
  return undefined;
}

export function formatStoryCalendar(calendar: StoryCalendar): string {
  const parts: string[] = [];
  if (calendar.year !== undefined) parts.push(`${calendar.era ?? ""}${calendar.year}年`);
  else if (calendar.era) parts.push(calendar.era);
  if (calendar.month !== undefined) parts.push(`${calendar.month}月`);
  else if (calendar.season) parts.push(`${calendar.season}`);
  if (calendar.day !== undefined) parts.push(`${calendar.day}日`);
  return parts.join("") || "（无历法）";
}

function calendarFromDay(day: number, era: string | undefined): StoryCalendar {
  const year = Math.floor(day / 360);
  const inYear = day - year * 360;
  const month = Math.floor(inYear / 30) + 1;
  return { ...(era ? { era } : {}), year, season: seasonOfMonth(month), month, day: inYear - (month - 1) * 30 + 1 };
}

// ---------------------------------------------------------------- 时间轴推算

export interface StoryTimePoint {
  readonly anchorId: string;
  readonly chapterNumber: number;
  readonly kind: StoryTimeAnchorKind;
  readonly expression: string;
  readonly evidenceText: string;
  /** 推算后的故事日；没能定位（第一锚之前只有约定 / 年龄）时为当时的当前日。 */
  readonly storyDay: number;
  /** 历法零点已知时的历法说法（近似）。 */
  readonly calendarLabel?: string;
  /** 这一步怎么推出来的（人话，一句）。 */
  readonly derivation: string;
  /** 沿推算链累积的置信度（逐步取较小值，推断为次年等再打折）。 */
  readonly confidence: number;
}

export interface StoryTimePromise {
  readonly anchorId: string;
  readonly chapterNumber: number;
  readonly event: string;
  readonly expression: string;
  readonly evidenceText: string;
  readonly madeOnDay: number;
  readonly dueDay: number;
  /** 相对「当前故事日」：正数还有几天，0 当天，负数已过几天。 */
  readonly daysLeft: number;
  readonly confidence: number;
}

export type StoryTimeConflictKind = "time-reversal" | "time-two-places" | "time-age-mismatch";

export interface StoryTimeConflict {
  readonly kind: StoryTimeConflictKind;
  readonly severity: "warning";
  readonly chapterNumber: number;
  /** 牵涉的人物（两地 / 年龄）；倒流为空串。 */
  readonly entity: string;
  readonly anchorId: string;
  readonly title: string;
  readonly detail: string;
  readonly evidenceText: string;
  /** 与之冲突的那一章。 */
  readonly otherChapter: number;
  readonly explanation: DiagnosticExplanation;
}

export interface StoryTimelineSnapshot {
  readonly bookId: string;
  /** 截至第几章（含）。 */
  readonly throughChapter?: number;
  readonly points: readonly StoryTimePoint[];
  /** 当前故事日（最后一个时间点）；没有任何时间锚时为 undefined。 */
  readonly currentDay?: number;
  readonly currentLabel?: string;
  readonly currentChapter?: number;
  readonly promises: readonly StoryTimePromise[];
  readonly conflicts: readonly StoryTimeConflict[];
}

/** 某章里人物「所在」的记录，用来查「同一人同时在两地」。 */
export interface ChapterLocationRecord {
  readonly chapterNumber: number;
  readonly subject: string;
  readonly location: string;
  readonly evidenceText: string;
}

interface CalendarOrigin {
  readonly era?: string;
  /** 历法日 = 故事日 + offset。 */
  readonly offset: number;
}

function storyDayLabel(day: number, origin: CalendarOrigin | undefined): string {
  if (origin) return `${formatStoryCalendar(calendarFromDay(day + origin.offset, origin.era))}前后`;
  return `故事第 ${day + 1} 日`;
}

function clampConfidence(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
}

export function buildStoryTimeline(input: {
  readonly bookId: string;
  readonly anchors: readonly StoryTimeAnchorRecord[];
  readonly throughChapter?: number;
  readonly locations?: readonly ChapterLocationRecord[];
}): StoryTimelineSnapshot {
  const anchors = [...input.anchors]
    .filter((anchor) => input.throughChapter === undefined || anchor.chapterNumber <= input.throughChapter)
    .sort((a, b) => a.chapterNumber - b.chapterNumber || a.ordinal - b.ordinal);
  const points: StoryTimePoint[] = [];
  const promiseDrafts: Omit<StoryTimePromise, "daysLeft">[] = [];
  const conflicts: StoryTimeConflict[] = [];
  /** 「与此同时」的章 → 与之同时的前一章。 */
  const simultaneousWith = new Map<number, number>();
  const ages = new Map<string, { age: number; day: number; chapter: number }>();

  let currentDay: number | undefined;
  let currentConfidence = 1;
  let origin: CalendarOrigin | undefined;
  let lastChapterWithTime: number | undefined;

  const push = (anchor: StoryTimeAnchorRecord, day: number, derivation: string, confidence: number) => {
    const point: StoryTimePoint = {
      anchorId: anchor.id,
      chapterNumber: anchor.chapterNumber,
      kind: anchor.kind,
      expression: anchor.expression,
      evidenceText: anchor.evidenceText,
      storyDay: day,
      ...(origin ? { calendarLabel: storyDayLabel(day, origin) } : {}),
      derivation,
      confidence: clampConfidence(confidence),
    };
    points.push(point);
  };

  for (const anchor of anchors) {
    const ownConfidence = clampConfidence(anchor.confidence);
    if (anchor.kind === "absolute" && anchor.calendar) {
      const calendar = anchor.calendar;
      const withinYear = calendarDayWithinYear(calendar);
      if (calendar.year !== undefined && (!origin || (origin.era ?? "") === (calendar.era ?? ""))) {
        const calendarDay = calendar.year * 360 + (withinYear ?? 0);
        if (currentDay === undefined) {
          currentDay = 0;
          origin = { ...(calendar.era ? { era: calendar.era } : {}), offset: calendarDay };
          currentConfidence = ownConfidence;
          push(anchor, 0, `第${anchor.chapterNumber}章「${anchor.expression}」是全书第一个时间说法，记为起点。`, currentConfidence);
        } else if (!origin) {
          origin = { ...(calendar.era ? { era: calendar.era } : {}), offset: calendarDay - currentDay };
          currentConfidence = Math.min(currentConfidence, ownConfidence);
          push(anchor, currentDay, `第${anchor.chapterNumber}章「${anchor.expression}」第一次给出历法，与此前推算的${storyDayLabel(currentDay, undefined)}对齐。`, currentConfidence);
        } else {
          const day = calendarDay - origin.offset;
          if (day < currentDay) {
            const fromChapter = lastChapterWithTime ?? anchor.chapterNumber;
            conflicts.push(reversalConflict(anchor, fromChapter, storyDayLabel(currentDay, origin), formatStoryCalendar(calendar)));
            // 倒流只告警；时间轴不跟着倒退，后续推算仍以已推到的时间为准。
            push(anchor, currentDay, `第${anchor.chapterNumber}章「${anchor.expression}」比已推到的${storyDayLabel(currentDay, origin)}更早，按倒叙或笔误处理，时间轴不回退。`, Math.min(currentConfidence, ownConfidence) * 0.6);
            continue;
          }
          currentConfidence = ownConfidence;
          currentDay = day;
          push(anchor, day, `第${anchor.chapterNumber}章「${anchor.expression}」按历法定位。`, currentConfidence);
        }
        lastChapterWithTime = anchor.chapterNumber;
        continue;
      }
      // 只有季节 / 月份（没有年份）：取不早于当前的最近一次。
      if (withinYear !== undefined && origin && currentDay !== undefined) {
        const currentCalendarDay = currentDay + origin.offset;
        const year = Math.floor(currentCalendarDay / 360);
        let candidate = year * 360 + withinYear;
        let note = "同一年";
        if (candidate < currentCalendarDay - (calendar.month === undefined ? 89 : 29)) {
          candidate += 360;
          note = "推算为次年";
        }
        const day = Math.max(currentDay, candidate - origin.offset);
        const confidence = Math.min(currentConfidence, ownConfidence) * (note === "推算为次年" ? 0.8 : 1);
        currentDay = day;
        currentConfidence = confidence;
        push(anchor, day, `第${anchor.chapterNumber}章「${anchor.expression}」只给了${calendar.month !== undefined ? "月份" : "季节"}，${note}。`, confidence);
        lastChapterWithTime = anchor.chapterNumber;
        continue;
      }
      if (currentDay === undefined) {
        currentDay = 0;
        currentConfidence = ownConfidence * 0.8;
        push(anchor, 0, `第${anchor.chapterNumber}章「${anchor.expression}」是全书第一个时间说法，记为起点（没有年份，历法未定）。`, currentConfidence);
        lastChapterWithTime = anchor.chapterNumber;
        continue;
      }
      // 历法未定又没有年份：无法比较，只记录不推进。
      push(anchor, currentDay, `第${anchor.chapterNumber}章「${anchor.expression}」没有年份，历法零点未定，不推进时间。`, Math.min(currentConfidence, ownConfidence) * 0.5);
      continue;
    }

    if (anchor.kind === "relative") {
      const offset = anchor.offsetDays ?? parseRelativeOffsetDays(anchor.expression);
      if (offset === undefined || offset < 0) {
        if (currentDay !== undefined) push(anchor, currentDay, `第${anchor.chapterNumber}章「${anchor.expression}」读不出经过了多久，不推进时间。`, Math.min(currentConfidence, ownConfidence) * 0.5);
        continue;
      }
      const base = currentDay ?? 0;
      const baseLabel = currentDay === undefined ? "起点" : storyDayLabel(base, origin);
      currentDay = base + offset;
      currentConfidence = Math.min(currentConfidence, ownConfidence);
      push(anchor, currentDay, `第${anchor.chapterNumber}章「${anchor.expression}」：${baseLabel} + ${offset} 日。`, currentConfidence);
      lastChapterWithTime = anchor.chapterNumber;
      continue;
    }

    if (anchor.kind === "simultaneous") {
      // 「与此同时」指与上一章同时（章内切换视角的同时不查两地：同章两处本来就是不同人物线）。
      const previous = anchor.chapterNumber > 1 ? anchor.chapterNumber - 1 : undefined;
      const base = currentDay ?? 0;
      currentDay = base;
      if (previous !== undefined) simultaneousWith.set(anchor.chapterNumber, previous);
      currentConfidence = Math.min(currentConfidence, ownConfidence);
      push(anchor, base, `第${anchor.chapterNumber}章「${anchor.expression}」与${previous !== undefined ? `第${previous}章` : "上文"}同时，时间不变。`, currentConfidence);
      lastChapterWithTime = anchor.chapterNumber;
      continue;
    }

    if (anchor.kind === "deadline") {
      const offset = anchor.offsetDays ?? parseRelativeOffsetDays(anchor.expression);
      if (offset === undefined || offset < 0) continue;
      const madeOnDay = currentDay ?? 0;
      promiseDrafts.push({
        anchorId: anchor.id,
        chapterNumber: anchor.chapterNumber,
        event: anchor.event?.trim() || anchor.expression,
        expression: anchor.expression,
        evidenceText: anchor.evidenceText,
        madeOnDay,
        dueDay: madeOnDay + offset,
        confidence: clampConfidence(Math.min(currentConfidence, ownConfidence)),
      });
      continue;
    }

    if (anchor.kind === "age" && anchor.subject?.trim() && anchor.age !== undefined) {
      const subject = anchor.subject.trim();
      const day = currentDay ?? 0;
      const known = ages.get(subject);
      if (known) {
        const expected = known.age + (day - known.day) / 360;
        if (anchor.age < known.age || Math.abs(anchor.age - expected) > 1.01) {
          conflicts.push(ageConflict(anchor, subject, known, expected));
        }
      }
      ages.set(subject, { age: anchor.age, day, chapter: anchor.chapterNumber });
    }
  }

  // 同一人同时在两地：「与此同时」的章和与之同时的那一章里，同一人物所在不同。
  if (input.locations && simultaneousWith.size > 0) {
    const byChapter = new Map<number, Map<string, ChapterLocationRecord>>();
    for (const record of input.locations) {
      const bucket = byChapter.get(record.chapterNumber) ?? new Map<string, ChapterLocationRecord>();
      bucket.set(record.subject.trim(), record);
      byChapter.set(record.chapterNumber, bucket);
    }
    for (const [chapter, other] of simultaneousWith) {
      const here = byChapter.get(chapter);
      const there = byChapter.get(other);
      if (!here || !there) continue;
      const anchor = anchors.find((item) => item.chapterNumber === chapter && item.kind === "simultaneous");
      for (const [subject, record] of here) {
        const theirs = there.get(subject);
        if (!theirs || theirs.location.trim() === record.location.trim()) continue;
        conflicts.push(twoPlacesConflict(anchor, chapter, other, subject, theirs.location, record));
      }
    }
  }

  const promises = promiseDrafts
    .map((promise) => ({ ...promise, daysLeft: promise.dueDay - (currentDay ?? promise.madeOnDay) }))
    .sort((a, b) => a.dueDay - b.dueDay || a.chapterNumber - b.chapterNumber);
  const last = points.at(-1);
  return {
    bookId: input.bookId,
    ...(input.throughChapter !== undefined ? { throughChapter: input.throughChapter } : {}),
    points,
    ...(currentDay !== undefined ? { currentDay, currentLabel: storyDayLabel(currentDay, origin) } : {}),
    ...(last ? { currentChapter: last.chapterNumber } : {}),
    promises,
    conflicts,
  };
}

function reversalConflict(anchor: StoryTimeAnchorRecord, fromChapter: number, currentLabel: string, calendarLabel: string): StoryTimeConflict {
  return {
    kind: "time-reversal",
    severity: "warning",
    chapterNumber: anchor.chapterNumber,
    entity: "",
    anchorId: anchor.id,
    title: `第${anchor.chapterNumber}章的时间比前文更早`,
    detail: `前文（到第${fromChapter}章）已推到${currentLabel}，第${anchor.chapterNumber}章却写「${anchor.expression}」（${calendarLabel}）。`,
    evidenceText: anchor.evidenceText,
    otherChapter: fromChapter,
    explanation: {
      whatHappened: `第${anchor.chapterNumber}章写的「${anchor.expression}」比前文已经过去的时间还早。`,
      whyItMatters: "如果这不是回忆或倒叙，读者会觉得时间倒流了；后面按日子推算的约定（几天后决战之类）也会跟着乱。",
      suggestedAction: "是倒叙就忽略这一条；不是的话改正文里的年份或季节，或者把前面某章「几年后」的跨度改小，再重新结算。",
    },
  };
}

function ageConflict(
  anchor: StoryTimeAnchorRecord,
  subject: string,
  known: { age: number; day: number; chapter: number },
  expected: number,
): StoryTimeConflict {
  const years = Math.round(((expected - known.age) * 10)) / 10;
  return {
    kind: "time-age-mismatch",
    severity: "warning",
    chapterNumber: anchor.chapterNumber,
    entity: subject,
    anchorId: anchor.id,
    title: `${subject}的年龄对不上`,
    detail: `第${known.chapter}章${subject}${known.age}岁，按时间线过了约 ${years} 年，到第${anchor.chapterNumber}章应在${Math.round(expected)}岁左右，正文写的是${anchor.age}岁。`,
    evidenceText: anchor.evidenceText,
    otherChapter: known.chapter,
    explanation: {
      whatHappened: `第${anchor.chapterNumber}章说${subject}${anchor.age}岁，和第${known.chapter}章的${known.age}岁加上中间经过的时间对不上。`,
      whyItMatters: "年龄是读者容易记住的硬数字，前后不一致很显眼；也可能是中间某章的时间跨度记错了。",
      suggestedAction: `核对两处的年龄和中间的时间跨度，改掉错的一处后重新结算；如果是故意的（比如谎报年龄），忽略这一条。`,
    },
  };
}

function twoPlacesConflict(
  anchor: StoryTimeAnchorRecord | undefined,
  chapter: number,
  other: number,
  subject: string,
  otherLocation: string,
  record: ChapterLocationRecord,
): StoryTimeConflict {
  return {
    kind: "time-two-places",
    severity: "warning",
    chapterNumber: chapter,
    entity: subject,
    anchorId: anchor?.id ?? `chapter:${chapter}`,
    title: `${subject}同一时间出现在两个地方`,
    detail: `第${chapter}章写的是与第${other}章同时发生，第${other}章${subject}在「${otherLocation}」，第${chapter}章却在「${record.location}」。`,
    evidenceText: record.evidenceText,
    otherChapter: other,
    explanation: {
      whatHappened: `第${chapter}章与第${other}章是同一时间，${subject}却分别在「${otherLocation}」和「${record.location}」。`,
      whyItMatters: "同一时刻一个人只能在一处；读者会以为写错了人，或者「与此同时」用错了。",
      suggestedAction: `确认第${chapter}章是不是真的与第${other}章同时；不是就改掉「与此同时」这类说法，是就改${subject}的位置或换个人，再重新结算。`,
    },
  };
}

// ---------------------------------------------------------------- 存取

export function ensureStoryTimeSchema(storage: StorageDatabase): void {
  const hasBookTable = tableExists(storage, "book");
  storage.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS narrative_story_time_anchor (
      id TEXT PRIMARY KEY NOT NULL,
      book_id TEXT NOT NULL,
      chapter_number INTEGER NOT NULL,
      ordinal INTEGER NOT NULL,
      kind TEXT NOT NULL,
      expression TEXT NOT NULL,
      evidence_text TEXT NOT NULL,
      anchor_json TEXT NOT NULL DEFAULT '{}',
      confidence REAL NOT NULL DEFAULT 0.7,
      created_at INTEGER NOT NULL${hasBookTable ? `,
      FOREIGN KEY (book_id) REFERENCES book(id) ON DELETE CASCADE` : ""}
    );
    CREATE INDEX IF NOT EXISTS idx_narrative_story_time_anchor_chapter
      ON narrative_story_time_anchor(book_id, chapter_number, ordinal);
  `);
}

function anchorJson(draft: StoryTimeAnchorDraft): string {
  return JSON.stringify({
    ...(draft.calendar ? { calendar: draft.calendar } : {}),
    ...(draft.offsetDays !== undefined ? { offsetDays: draft.offsetDays } : {}),
    ...(draft.event ? { event: draft.event } : {}),
    ...(draft.subject ? { subject: draft.subject } : {}),
    ...(draft.age !== undefined ? { age: draft.age } : {}),
  });
}

/** 同一章重新结算：整章替换。 */
export function replaceChapterStoryTimeAnchors(
  storage: StorageDatabase,
  bookId: string,
  chapterNumber: number,
  drafts: readonly StoryTimeAnchorDraft[],
  now: number = Date.now(),
): void {
  storage.sqlite.prepare(`DELETE FROM narrative_story_time_anchor WHERE book_id = ? AND chapter_number = ?`).run(bookId, chapterNumber);
  const insert = storage.sqlite.prepare(`
    INSERT INTO narrative_story_time_anchor (id, book_id, chapter_number, ordinal, kind, expression, evidence_text, anchor_json, confidence, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  drafts.forEach((draft, ordinal) => {
    insert.run(
      `story-time:${bookId}:${chapterNumber}:${ordinal}`,
      bookId,
      chapterNumber,
      ordinal,
      draft.kind,
      draft.expression,
      draft.evidenceText,
      anchorJson(draft),
      clampConfidence(draft.confidence),
      now,
    );
  });
}

export function deleteStoryTimeAnchorsInRange(storage: StorageDatabase, bookId: string, from: number, to: number): number {
  if (!tableExists(storage, "narrative_story_time_anchor")) return 0;
  return storage.sqlite.prepare(`DELETE FROM narrative_story_time_anchor WHERE book_id = ? AND chapter_number >= ? AND chapter_number <= ?`).run(bookId, from, to).changes;
}

function isSeason(value: unknown): value is StorySeason {
  return typeof value === "string" && (STORY_SEASONS as readonly string[]).includes(value);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function parseStoryCalendar(raw: unknown): StoryCalendar | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const era = typeof record.era === "string" && record.era.trim() ? record.era.trim() : undefined;
  const year = finiteNumber(record.year);
  const month = finiteNumber(record.month);
  const day = finiteNumber(record.day);
  const season = isSeason(record.season) ? record.season : month !== undefined && month >= 1 && month <= 12 ? seasonOfMonth(month) : undefined;
  const calendar: StoryCalendar = {
    ...(era ? { era } : {}),
    ...(year !== undefined && year >= 0 ? { year: Math.round(year) } : {}),
    ...(season ? { season } : {}),
    ...(month !== undefined && month >= 1 && month <= 12 ? { month: Math.round(month) } : {}),
    ...(day !== undefined && day >= 1 && day <= 31 ? { day: Math.round(day) } : {}),
  };
  return Object.keys(calendar).length > 0 ? calendar : undefined;
}

interface RawAnchorRow {
  id: string;
  book_id: string;
  chapter_number: number;
  ordinal: number;
  kind: string;
  expression: string;
  evidence_text: string;
  anchor_json: string;
  confidence: number;
}

function toRecord(row: RawAnchorRow): StoryTimeAnchorRecord | undefined {
  if (!(STORY_TIME_ANCHOR_KINDS as readonly string[]).includes(row.kind)) return undefined;
  let extra: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.anchor_json) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) extra = parsed as Record<string, unknown>;
  } catch {
    extra = {};
  }
  const calendar = parseStoryCalendar(extra.calendar);
  const offsetDays = finiteNumber(extra.offsetDays);
  const age = finiteNumber(extra.age);
  return {
    id: row.id,
    bookId: row.book_id,
    chapterNumber: row.chapter_number,
    ordinal: row.ordinal,
    kind: row.kind as StoryTimeAnchorKind,
    expression: row.expression,
    evidenceText: row.evidence_text,
    confidence: row.confidence,
    ...(calendar ? { calendar } : {}),
    ...(offsetDays !== undefined ? { offsetDays } : {}),
    ...(typeof extra.event === "string" && extra.event.trim() ? { event: extra.event.trim() } : {}),
    ...(typeof extra.subject === "string" && extra.subject.trim() ? { subject: extra.subject.trim() } : {}),
    ...(age !== undefined ? { age } : {}),
  };
}

export function listStoryTimeAnchors(storage: StorageDatabase, bookId: string, throughChapter?: number): StoryTimeAnchorRecord[] {
  if (!tableExists(storage, "narrative_story_time_anchor")) return [];
  const rows = throughChapter === undefined
    ? storage.sqlite.prepare<RawAnchorRow>(`
      SELECT id, book_id, chapter_number, ordinal, kind, expression, evidence_text, anchor_json, confidence
      FROM narrative_story_time_anchor WHERE book_id = ? ORDER BY chapter_number, ordinal
    `).all(bookId)
    : storage.sqlite.prepare<RawAnchorRow>(`
      SELECT id, book_id, chapter_number, ordinal, kind, expression, evidence_text, anchor_json, confidence
      FROM narrative_story_time_anchor WHERE book_id = ? AND chapter_number <= ? ORDER BY chapter_number, ordinal
    `).all(bookId, throughChapter);
  return rows.map(toRecord).filter((record): record is StoryTimeAnchorRecord => record !== undefined);
}

/**
 * 「与此同时」的章才需要查两地，所以只取这些章及其前一锚章的所在记录（不扫全书事件）。
 * 所在取本章未驳回的 location_changed 事件，同一人取本章最后一条。
 */
export function loadChapterLocations(storage: StorageDatabase, bookId: string, chapters: readonly number[]): ChapterLocationRecord[] {
  if (chapters.length === 0 || !tableExists(storage, "narrative_event")) return [];
  const unique = [...new Set(chapters)];
  const placeholders = unique.map(() => "?").join(", ");
  const rows = storage.sqlite.prepare<{ chapter_number: number; subject: string; object: string; evidence_text: string }>(`
    SELECT chapter_number, subject, object, evidence_text
    FROM narrative_event
    WHERE book_id = ? AND chapter_number IN (${placeholders}) AND event_type = 'location_changed' AND status != 'rejected'
    ORDER BY chapter_number, created_at, id
  `).all(bookId, ...unique);
  return rows.map((row) => ({ chapterNumber: row.chapter_number, subject: row.subject, location: row.object, evidenceText: row.evidence_text }));
}

/** 读库 + 推算：截至 throughChapter（含）的故事时间轴。 */
export function readStoryTimeline(storage: StorageDatabase, bookId: string, throughChapter?: number): StoryTimelineSnapshot {
  const anchors = listStoryTimeAnchors(storage, bookId, throughChapter);
  const simultaneousChapters = anchors.filter((anchor) => anchor.kind === "simultaneous").map((anchor) => anchor.chapterNumber);
  let locations: ChapterLocationRecord[] = [];
  if (simultaneousChapters.length > 0) {
    const related = simultaneousChapters.flatMap((chapter) => (chapter > 1 ? [chapter, chapter - 1] : [chapter]));
    locations = loadChapterLocations(storage, bookId, related);
  }
  return buildStoryTimeline({ bookId, anchors, ...(throughChapter !== undefined ? { throughChapter } : {}), locations });
}

// ---------------------------------------------------------------- 抽取结果校验

/** 每章最多保留的时间锚条数（防模型刷屏）。 */
export const MAX_TIME_ANCHORS_PER_CHAPTER = 24;

/**
 * 校验抽取器给出的 timeAnchors：kind 合法、说法与证据非空、证据是正文原文；
 * relative / deadline 的天数缺失时从说法里读，读不出则丢弃；age 必须有人名与合理年龄。
 */
export function parseStoryTimeAnchorDrafts(raw: readonly unknown[], chapterContent: string, warnings: string[]): StoryTimeAnchorDraft[] {
  const drafts: StoryTimeAnchorDraft[] = [];
  let dropped = 0;
  for (const item of raw) {
    if (drafts.length >= MAX_TIME_ANCHORS_PER_CHAPTER) {
      dropped += 1;
      continue;
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      dropped += 1;
      continue;
    }
    const record = item as Record<string, unknown>;
    const kind = typeof record.kind === "string" ? record.kind.trim() : "";
    const expression = typeof record.expression === "string" ? record.expression.trim() : "";
    const evidenceText = typeof record.evidenceText === "string" ? record.evidenceText.trim() : "";
    if (!(STORY_TIME_ANCHOR_KINDS as readonly string[]).includes(kind) || !expression || !evidenceText || !chapterContent.includes(evidenceText)) {
      dropped += 1;
      continue;
    }
    const confidenceRaw = finiteNumber(record.confidence);
    const confidence = clampConfidence(confidenceRaw ?? 0.7);
    const base = { kind: kind as StoryTimeAnchorKind, expression, evidenceText, confidence };
    if (kind === "absolute") {
      const calendar = parseStoryCalendar(record.calendar);
      if (!calendar) {
        dropped += 1;
        continue;
      }
      drafts.push({ ...base, calendar });
      continue;
    }
    if (kind === "relative" || kind === "deadline") {
      const given = finiteNumber(record.offsetDays);
      const offsetDays = given !== undefined && given >= 0 ? Math.round(given) : parseRelativeOffsetDays(expression);
      if (offsetDays === undefined) {
        dropped += 1;
        continue;
      }
      const event = typeof record.event === "string" && record.event.trim() ? record.event.trim().slice(0, 40) : undefined;
      drafts.push({ ...base, offsetDays, ...(kind === "deadline" && event ? { event } : {}) });
      continue;
    }
    if (kind === "age") {
      const subject = typeof record.subject === "string" ? record.subject.trim() : "";
      const age = finiteNumber(record.age);
      if (!subject || age === undefined || age < 0 || age > 100_000) {
        dropped += 1;
        continue;
      }
      drafts.push({ ...base, subject, age: Math.round(age) });
      continue;
    }
    drafts.push(base);
  }
  if (dropped > 0) warnings.push(`丢弃了 ${dropped} 条故事时间说法：类型不对、缺少原文证据或读不出经过了多久。`);
  return drafts;
}
