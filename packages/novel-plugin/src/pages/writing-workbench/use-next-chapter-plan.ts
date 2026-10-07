/**
 * 下一章计划的数据装配（Hook）：故事画布「下一章」页与故事推进侧栏的下一步卡共用。
 *
 * 只读现有权威源，交给纯函数 buildNextChapterPlan 合成，不另算第二套规则：
 *  - 剧情线 / 场景 / 挂载 / 伏笔债务：narrative-structure 快照（useNarrativeStructure，同书请求去重）
 *  - 本章焦点：经纬 current-focus 单例（goal / why 由作者手填）
 */

import { useEffect, useMemo, useState } from "react";

import { fetchJson } from "@/hooks/use-api";
import { buildNextChapterPlan, type CurrentFocusSnapshot, type NextChapterPlan } from "./next-chapter-plan";
import { useNarrativeStructure, type NarrativeStructureState } from "./useNarrativeStructure";

interface FocusEntryLike {
  readonly title?: string;
  readonly fields?: Record<string, unknown>;
}

function readFocus(raw: unknown): CurrentFocusSnapshot | null {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const entries = record && Array.isArray(record.entries) ? (record.entries as readonly FocusEntryLike[]) : null;
  const entry = entries?.[0];
  const fields = entry?.fields && typeof entry.fields === "object" ? entry.fields : {};
  const goal = typeof fields.goal === "string" ? fields.goal.trim() : "";
  if (!goal) return null;
  const why = typeof fields.why === "string" && fields.why.trim() ? fields.why.trim() : undefined;
  return { goal, ...(why ? { why } : {}) };
}

function useCurrentFocus(bookId: string | undefined): { readonly focus: CurrentFocusSnapshot | null; readonly error: string | null } {
  const [focus, setFocus] = useState<CurrentFocusSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!bookId) return;
    let cancelled = false;
    void fetchJson<{ entries?: readonly FocusEntryLike[] }>(
      `/api/books/${encodeURIComponent(bookId)}/jingwei/entries?category=current-focus&limit=1`,
    )
      .then((raw) => {
        if (!cancelled) setFocus(readFocus(raw));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error && err.message ? err.message : "读取本章焦点失败");
      });
    return () => { cancelled = true; };
  }, [bookId]);
  return { focus, error };
}

export function useNextChapterPlan(bookId: string, currentChapter: number | undefined): {
  readonly state: NarrativeStructureState;
  readonly reload: () => void;
  /** 快照就绪前为 null。 */
  readonly plan: NextChapterPlan | null;
} {
  const { state, reload } = useNarrativeStructure(bookId);
  const { focus } = useCurrentFocus(bookId);

  const plan = useMemo<NextChapterPlan | null>(() => {
    if (state.status !== "ready") return null;
    return buildNextChapterPlan({
      chapters: state.data.chapters,
      scenes: state.data.scenes,
      storylines: state.data.storylines,
      mounts: state.data.mounts,
      foreshadows: state.data.foreshadows,
      focus,
      ...(currentChapter !== undefined ? { currentChapter } : {}),
    });
  }, [state, focus, currentChapter]);

  return { state, reload, plan };
}
