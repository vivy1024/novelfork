/**
 * 全书走势（章节时间线）的数据装配（Hook）。
 *
 * 走势本体走 narrative-memory 的 chapter-timeline 读模型：
 *  - GET /api/books/:bookId/narrative-memory/chapter-timeline → 每章一行（摘要/字数/卡司/伏笔账）
 *  - 章内事件展开复用现有列表接口：GET /narrative-memory/list?kind=event&status=applied&chapterFrom=N&chapterTo=N
 *
 * 接口挂不上或返回空时，面板给空态，不补假数据。解析容错在 normalizeChapterTimeline：
 * 服务端契约外的脏字段一律剔除，结构整体不符时返回 null（面板转错误态）。
 */

import { useCallback, useEffect, useState } from "react";

import { fetchJson } from "@/hooks/use-api";

export interface ChapterCastMember {
  readonly name: string;
  readonly entryId?: string;
}

export interface ChapterTimelineChapter {
  readonly number: number;
  readonly title: string;
  readonly volume?: string;
  readonly chars: number;
  readonly summary: string | null;
  /** 摘要与当前正文不一致时置真，行上标「以正文为准」。 */
  readonly summaryStale: boolean;
  readonly eventCount: number;
  readonly plantedHooks: number;
  readonly recoveredHooks: number;
  readonly cast: readonly ChapterCastMember[];
  readonly moreCast: number;
}

export interface ChapterTimeline {
  readonly chapters: readonly ChapterTimelineChapter[];
  /** 已结算到第几章；null 表示还没有结算记录（各章一律按未结算显示）。 */
  readonly settledThrough: number | null;
}

export type ChapterTimelineState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly data: ChapterTimeline };

export interface ChapterTimelineEvent {
  readonly id: string;
  readonly eventType: string;
  readonly subject: string;
  readonly predicate: string;
  readonly object: string;
  readonly chapterNumber: number | null;
}

export type ChapterEventsState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly events: readonly ChapterTimelineEvent[] };

function readNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function parseCast(raw: unknown): readonly ChapterCastMember[] {
  if (!Array.isArray(raw)) return [];
  const cast: ChapterCastMember[] = [];
  for (const item of raw) {
    const record = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
    const name = record && typeof record.name === "string" ? record.name.trim() : "";
    if (!name) continue;
    const entryId = record && typeof record.entryId === "string" && record.entryId.trim() ? record.entryId : undefined;
    cast.push(entryId ? { name, entryId } : { name });
  }
  return cast;
}

/** 容忍服务端多出来的字段；章号非法的行剔除，整个结构不符返回 null。 */
export function normalizeChapterTimeline(raw: unknown): ChapterTimeline | null {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!record || !Array.isArray(record.chapters)) return null;
  const settled = record.settledThrough;
  const settledThrough = typeof settled === "number" && Number.isInteger(settled) && settled >= 0 ? settled : null;
  const chapters: ChapterTimelineChapter[] = [];
  for (const item of record.chapters as readonly unknown[]) {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
    const number = row && typeof row.number === "number" && Number.isInteger(row.number) && row.number > 0 ? row.number : null;
    if (!row || number === null) continue;
    const volume = typeof row.volume === "string" && row.volume.trim() ? row.volume : undefined;
    chapters.push({
      number,
      title: typeof row.title === "string" ? row.title : "",
      ...(volume ? { volume } : {}),
      chars: readNumber(row.chars),
      summary: typeof row.summary === "string" && row.summary.trim() ? row.summary : null,
      summaryStale: row.summaryStale === true,
      eventCount: readNumber(row.eventCount),
      plantedHooks: readNumber(row.plantedHooks),
      recoveredHooks: readNumber(row.recoveredHooks),
      cast: parseCast(row.cast),
      moreCast: readNumber(row.moreCast),
    });
  }
  chapters.sort((a, b) => a.number - b.number);
  return { chapters, settledThrough };
}

/** settledThrough 为 null 时没有任何章算「已结算」，一律按未结算显示。 */
export function isChapterSettled(timeline: ChapterTimeline, chapterNumber: number): boolean {
  return timeline.settledThrough !== null && chapterNumber <= timeline.settledThrough;
}

/** 列表初始定位：最新结算章；一章都没结算时落到最后一章（作者刚写完的地方）。 */
export function timelineAnchorChapter(timeline: ChapterTimeline): number | null {
  if (timeline.chapters.length === 0) return null;
  if (timeline.settledThrough !== null && timeline.chapters.some((chapter) => chapter.number === timeline.settledThrough)) {
    return timeline.settledThrough;
  }
  return timeline.chapters[timeline.chapters.length - 1]!.number;
}

export function useChapterTimeline(bookId: string | undefined): {
  readonly state: ChapterTimelineState;
  readonly reload: () => void;
} {
  const [state, setState] = useState<ChapterTimelineState>({ status: "loading" });
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (!bookId) {
      setState({ status: "error", message: "未绑定书籍" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    void fetchJson<unknown>(`/api/books/${encodeURIComponent(bookId)}/narrative-memory/chapter-timeline`)
      .then((raw) => {
        if (cancelled) return;
        const data = normalizeChapterTimeline(raw);
        setState(data ? { status: "ready", data } : { status: "error", message: "走势接口返回的结构不完整" });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({ status: "error", message: err instanceof Error && err.message ? err.message : "读取全书走势失败" });
        }
      });
    return () => { cancelled = true; };
  }, [bookId, nonce]);

  return { state, reload };
}

/** 单章事件展开：复用 narrative-memory 的通用 list 接口按章过滤（已应用的事件）。 */
export function useChapterEvents(bookId: string, chapterNumber: number | null): {
  readonly state: ChapterEventsState;
} {
  const [state, setState] = useState<ChapterEventsState>({ status: "loading" });

  useEffect(() => {
    if (chapterNumber === null) return;
    let cancelled = false;
    setState({ status: "loading" });
    void fetchJson<{ entries?: readonly Record<string, unknown>[] }>(
      `/api/books/${encodeURIComponent(bookId)}/narrative-memory/list?kind=event&status=applied&chapterFrom=${chapterNumber}&chapterTo=${chapterNumber}&limit=100`,
    )
      .then((raw) => {
        if (cancelled) return;
        const events: ChapterTimelineEvent[] = (raw.entries ?? []).flatMap((entry) => {
          const id = typeof entry.id === "string" && entry.id ? entry.id : null;
          if (!id) return [];
          return [{
            id,
            eventType: typeof entry.eventType === "string" ? entry.eventType : "event",
            subject: typeof entry.subject === "string" ? entry.subject : "",
            predicate: typeof entry.predicate === "string" ? entry.predicate : "",
            object: typeof entry.object === "string" ? entry.object : "",
            chapterNumber: typeof entry.chapterNumber === "number" ? entry.chapterNumber : null,
          }];
        });
        setState({ status: "ready", events });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({ status: "error", message: err instanceof Error && err.message ? err.message : "读取本章事件失败" });
        }
      });
    return () => { cancelled = true; };
  }, [bookId, chapterNumber]);

  return { state };
}
