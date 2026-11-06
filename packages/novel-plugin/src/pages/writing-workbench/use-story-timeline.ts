/**
 * 故事时间轴的数据装配：GET /api/books/:bookId/narrative-memory/story-timeline。
 *
 * 服务端现算：各章时间说法推算出的时间点（带推算链与置信度）、约定时间、时间矛盾（带人话解释）。
 * 结构不符时返回错误态，不补假数据。
 */

import { useCallback, useEffect, useState } from "react";

import { fetchJson } from "@/hooks/use-api";

export interface StoryTimePointView {
  readonly anchorId: string;
  readonly chapterNumber: number;
  readonly kind: string;
  readonly expression: string;
  readonly evidenceText: string;
  readonly storyDay: number;
  readonly calendarLabel?: string;
  readonly derivation: string;
  readonly confidence: number;
}

export interface StoryTimePromiseView {
  readonly anchorId: string;
  readonly chapterNumber: number;
  readonly event: string;
  readonly expression: string;
  readonly evidenceText: string;
  readonly dueDay: number;
  readonly daysLeft: number;
}

export interface StoryTimeConflictView {
  readonly kind: string;
  readonly chapterNumber: number;
  readonly entity: string;
  readonly title: string;
  readonly detail: string;
  readonly evidenceText: string;
  readonly explanation: { readonly whatHappened: string; readonly whyItMatters: string; readonly suggestedAction: string };
}

export interface StoryTimelineView {
  readonly points: readonly StoryTimePointView[];
  readonly promises: readonly StoryTimePromiseView[];
  readonly conflicts: readonly StoryTimeConflictView[];
  readonly currentLabel?: string;
  readonly currentChapter?: number;
  readonly summary: string;
}

export type StoryTimelineState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly data: StoryTimelineView };

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
}

export function normalizeStoryTimeline(raw: unknown): StoryTimelineView | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.points) || !Array.isArray(record.promises) || !Array.isArray(record.conflicts)) return null;
  const points = records(record.points).flatMap((item): StoryTimePointView[] => {
    const chapterNumber = num(item.chapterNumber);
    const storyDay = num(item.storyDay);
    if (chapterNumber === undefined || storyDay === undefined || !str(item.expression)) return [];
    const calendarLabel = str(item.calendarLabel);
    return [{
      anchorId: str(item.anchorId),
      chapterNumber,
      kind: str(item.kind),
      expression: str(item.expression),
      evidenceText: str(item.evidenceText),
      storyDay,
      ...(calendarLabel ? { calendarLabel } : {}),
      derivation: str(item.derivation),
      confidence: num(item.confidence) ?? 0,
    }];
  });
  const promises = records(record.promises).flatMap((item): StoryTimePromiseView[] => {
    const chapterNumber = num(item.chapterNumber);
    const dueDay = num(item.dueDay);
    const daysLeft = num(item.daysLeft);
    if (chapterNumber === undefined || dueDay === undefined || daysLeft === undefined) return [];
    return [{ anchorId: str(item.anchorId), chapterNumber, event: str(item.event), expression: str(item.expression), evidenceText: str(item.evidenceText), dueDay, daysLeft }];
  });
  const conflicts = records(record.conflicts).flatMap((item): StoryTimeConflictView[] => {
    const chapterNumber = num(item.chapterNumber);
    const explanation = item.explanation && typeof item.explanation === "object" ? (item.explanation as Record<string, unknown>) : null;
    if (chapterNumber === undefined || !explanation) return [];
    return [{
      kind: str(item.kind),
      chapterNumber,
      entity: str(item.entity),
      title: str(item.title),
      detail: str(item.detail),
      evidenceText: str(item.evidenceText),
      explanation: { whatHappened: str(explanation.whatHappened), whyItMatters: str(explanation.whyItMatters), suggestedAction: str(explanation.suggestedAction) },
    }];
  });
  const currentLabel = str(record.currentLabel);
  const currentChapter = num(record.currentChapter);
  return {
    points,
    promises,
    conflicts,
    ...(currentLabel ? { currentLabel } : {}),
    ...(currentChapter !== undefined ? { currentChapter } : {}),
    summary: str(record.summary),
  };
}

export function useStoryTimeline(bookId: string | undefined): { readonly state: StoryTimelineState; readonly reload: () => void } {
  const [state, setState] = useState<StoryTimelineState>({ status: "loading" });
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (!bookId) {
      setState({ status: "error", message: "未绑定书籍" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    void fetchJson<unknown>(`/api/books/${encodeURIComponent(bookId)}/narrative-memory/story-timeline`)
      .then((raw) => {
        if (cancelled) return;
        const data = normalizeStoryTimeline(raw);
        setState(data ? { status: "ready", data } : { status: "error", message: "时间轴接口返回的结构不完整" });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ status: "error", message: err instanceof Error && err.message ? err.message : "读取故事时间失败" });
      });
    return () => { cancelled = true; };
  }, [bookId, nonce]);

  return { state, reload };
}
