/**
 * 下一章整合页（T4.5）：一屏回答「下一章写什么」。
 *
 * 三块数据全部来自现有权威源：
 *  - 焦点与建议：经纬 current-focus 单例 + narrative-structure 快照（纯函数 next-chapter-plan 合成，不另算）
 *  - 情节板：快照里的剧情线 × 场景（建议排序优先，不重复 buildStoryProgressBoard 的另一套派生线）
 *  - 伏笔账本：快照里已带 urgency 的 ForeshadowDebt，「排进本章」发叙述者指令、
 *    「标记已回收」走 PUT jingwei/entries 的 fieldsPatch、待埋点用 POST 建 needs-review 草稿——
 *    本体数据不变，直到叙述者或作者经正常通道落盘。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Compass, Loader2, RefreshCw, Sprout, Swords } from "lucide-react";

import { fetchJson } from "@/hooks/use-api";
import { buildNextChapterPlan, type NextChapterPlan } from "./next-chapter-plan";
import { useNarrativeStructure } from "./useNarrativeStructure";
import type { ForeshadowDebt } from "../../engine/narrative-taxonomy/foreshadow-debts.js";
import type { NarrativeScene, NarrativeStoryline } from "../../engine/narrative-memory/scene-store.js";

export interface NextChapterPanelProps {
  readonly bookId: string;
  readonly currentChapter?: number;
  readonly onOpenChapter?: (chapterNumber: number) => void;
  readonly onSendToNarrator?: (message: string) => Promise<void> | void;
}

interface FocusEntryLike {
  readonly title?: string;
  readonly fields?: Record<string, unknown>;
}

interface ForeshadowEntryLike {
  readonly id: string;
  readonly fields?: Record<string, unknown>;
}

function readFocus(raw: unknown): { goal: string; why?: string } | null {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const entries = record && Array.isArray(record.entries) ? (record.entries as readonly FocusEntryLike[]) : null;
  const entry = entries?.[0];
  const fields = entry?.fields && typeof entry.fields === "object" ? entry.fields : {};
  const goal = typeof fields.goal === "string" ? fields.goal.trim() : "";
  if (!goal) return null;
  const why = typeof fields.why === "string" && fields.why.trim() ? fields.why.trim() : undefined;
  return { goal, ...(why ? { why } : {}) };
}

function useCurrentFocus(bookId: string | undefined): { readonly focus: { goal: string; why?: string } | null; readonly error: string | null } {
  const [focus, setFocus] = useState<{ goal: string; why?: string } | null>(null);
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

function useForeshadowEntries(bookId: string | undefined, version: number): ReadonlyMap<string, Record<string, unknown>> | null {
  const [fields, setFields] = useState<ReadonlyMap<string, Record<string, unknown>> | null>(null);
  useEffect(() => {
    if (!bookId) return;
    let cancelled = false;
    void fetchJson<{ entries?: readonly ForeshadowEntryLike[] }>(
      `/api/books/${encodeURIComponent(bookId)}/jingwei/entries?category=foreshadowing&limit=500`,
    )
      .then((raw) => {
        if (cancelled) return;
        const map = new Map<string, Record<string, unknown>>();
        for (const entry of raw.entries ?? []) {
          map.set(entry.id, entry.fields && typeof entry.fields === "object" ? entry.fields : {});
        }
        setFields(map);
      })
      .catch(() => {
        if (!cancelled) setFields(null);
      });
    return () => { cancelled = true; };
  }, [bookId, version]);
  return fields;
}

const URGENCY_META: Record<ForeshadowDebt["urgency"], { label: string; className: string }> = {
  overdue: { label: "超期", className: "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400" },
  watch: { label: "临近", className: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  ok: { label: "近期可用", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
};

function kindLabel(kind: string): string {
  const map: Record<string, string> = {
    main: "主线",
    sub: "支线",
    romance: "感情线",
    faction: "势力线",
    mystery: "悬疑线",
    "character-arc": "人物成长",
    conflict: "矛盾线",
    character: "人物线",
    foreshadow: "伏笔线",
    other: "其他",
  };
  return map[kind] ?? kind;
}

export function NextChapterPanel({ bookId, currentChapter, onOpenChapter, onSendToNarrator }: NextChapterPanelProps) {
  const { state, reload } = useNarrativeStructure(bookId);
  const { focus } = useCurrentFocus(bookId);
  const [version, setVersion] = useState(0);
  const fieldsMap = useForeshadowEntries(bookId, version);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [plantOpen, setPlantOpen] = useState(false);
  const [plantTitle, setPlantTitle] = useState("");
  const [plantChapter, setPlantChapter] = useState("");
  const [plantBusy, setPlantBusy] = useState(false);

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

  const sceneTitlesByChapter = useMemo(() => {
    const map = new Map<string, Map<number, string[]>>();
    if (state.status !== "ready") return map;
    const mountByScene = new Map<string, string[]>();
    for (const mount of state.data.mounts) {
      const list = mountByScene.get(mount.sceneId) ?? [];
      list.push(mount.storylineId);
      mountByScene.set(mount.sceneId, list);
    }
    for (const scene of state.data.scenes) {
      for ( const storylineId of mountByScene.get(scene.id) ?? []) {
        const byChapter = map.get(storylineId) ?? new Map<number, string[]>();
        const list = byChapter.get(scene.chapterNumber) ?? [];
        list.push(scene.title?.trim() || `第 ${scene.ordinal} 场`);
        byChapter.set(scene.chapterNumber, list);
        map.set(storylineId, byChapter);
      }
    }
    return map;
  }, [state]);

  const messageNarrator = useCallback(async (message: string) => {
    if (!onSendToNarrator) {
      setNote("当前视图没有可用的叙述者；建议仍可读，动作先没法交给它。");
      return;
    }
    try {
      await onSendToNarrator(message);
      setNote("已交给叙述者；结果会在叙述者面板与工作流里继续。");
    } catch (err) {
      setNote(err instanceof Error && err.message ? err.message : "交给叙述者失败");
    }
  }, [onSendToNarrator]);

  const scheduleHook = useCallback((debt: ForeshadowDebt) => {
    if (!plan) return;
    void messageNarrator(
      `请把伏笔「${debt.title}」（第 ${debt.plantedChapter ?? "?"} 章埋下，已悬置 ${debt.chaptersPending ?? "?"} 章）排进第 ${plan.nextChapter} 章的写作计划：在 scene.spec 里安排推进或回收节拍，写作上下文里确保它在场。数据以伏笔条目为准，不要改写条目内容。`,
    );
  }, [messageNarrator, plan]);

  const markPaidOff = useCallback(async (debt: ForeshadowDebt) => {
    if (!plan) return;
    if (!fieldsMap) {
      setNote("伏笔条目还没读完，稍后再标记回收。");
      return;
    }
    setBusyId(debt.entryId);
    setNote(null);
    try {
      await fetchJson(`/api/books/${encodeURIComponent(bookId)}/jingwei/entries/${encodeURIComponent(debt.entryId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldsPatch: { status: "paid_off", payoffChapter: plan.nextChapter - 1 } }),
      });
      setNote(`伏笔「${debt.title}」已按第 ${plan.nextChapter - 1} 章标记为已回收。`);
      setVersion((value) => value + 1);
      reload();
    } catch (err) {
      setNote(err instanceof Error && err.message ? err.message : "标记回收失败");
    } finally {
      setBusyId(null);
    }
  }, [bookId, fieldsMap, plan, reload]);

  const plantHook = useCallback(async () => {
    if (!plan) return;
    const title = plantTitle.trim();
    const chapter = Number(plantChapter || plan.nextChapter);
    if (!title) {
      setNote("先写一句要埋什么，再埋点。");
      return;
    }
    if (!Number.isInteger(chapter) || chapter <= 0) {
      setNote("埋设章号要是正整数。");
      return;
    }
    setPlantBusy(true);
    setNote(null);
    try {
      await fetchJson(`/api/books/${encodeURIComponent(bookId)}/jingwei/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: "foreshadowing",
          title,
          status: "needs-review",
          layer: "dynamic",
          fields: { status: "planted", plantedChapter: chapter },
        }),
      });
      setNote(`已在第 ${chapter} 章埋「${title}」，待你确认后开始倒计时。`);
      setPlantTitle("");
      setPlantChapter("");
      setPlantOpen(false);
      setVersion((value) => value + 1);
      reload();
    } catch (err) {
      setNote(err instanceof Error && err.message ? err.message : "埋点失败");
    } finally {
      setPlantBusy(false);
    }
  }, [bookId, plantChapter, plantTitle, plan, reload]);

  if (state.status === "loading" || !plan) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground" data-testid="next-chapter-panel">
        <Loader2 className="size-4 animate-spin" /> 正在读取叙事结构…
      </div>
    );
  }

  const lanes = plan.suggestions.map((suggestion) => ({
    id: suggestion.storylineId ?? suggestion.id,
    title: suggestion.laneTitle,
    kind: suggestion.laneKind,
    reasonText: suggestion.reasonText,
  }));
  const extraLanes: typeof lanes = (state.data.storylines as readonly NarrativeStoryline[])
    .filter((line) => line.lifecycle === "active" && !lanes.some((lane) => lane.id === line.id))
    .slice(0, 4)
    .map((line) => ({ id: line.id, title: line.title, kind: line.kind, reasonText: "" }));
  const allLanes = [...lanes, ...extraLanes];
  const latestChapter = state.data.chapters.length > 0 ? Math.max(...state.data.chapters.map((chapter) => chapter.chapterNumber)) : 0;
  const boardChapters = [Math.max(1, latestChapter - 3), latestChapter - 2, latestChapter - 1, latestChapter, plan.nextChapter].filter((value, index, list) => list.indexOf(value) === index && value > 0);

  return (
    <div className="grid h-full grid-cols-1 gap-3 overflow-y-auto p-1 lg:grid-cols-[1fr_300px]" data-testid="next-chapter-panel">
      <div className="flex min-w-0 flex-col gap-3">
        {/* 焦点卡 */}
        <section className="rounded-md border border-border bg-card/50 px-4 py-3" data-testid="next-focus-card">
          <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Compass className="size-3.5" /> 本章焦点
          </div>
          {plan.focus ? (
            <>
              <p className="mt-1.5 text-sm font-medium" data-testid="next-focus-goal">{plan.focus.goal}</p>
              {plan.focus.why ? <p className="mt-1 text-2xs text-muted-foreground" data-testid="next-focus-why">为什么现在：{plan.focus.why}</p> : null}
            </>
          ) : (
            <p className="mt-1.5 text-sm text-muted-foreground" data-testid="next-focus-empty">
              还没填本章焦点。到写作视图的「创作罗盘」写一句本章最该推进的事，建议会按它点名剧情线。
            </p>
          )}
          {plan.hasStorylines ? (
            <div className="mt-2 rounded-md bg-primary/10 px-3 py-2 text-2xs text-foreground" data-testid="next-suggestion-line">
              下一章建议：第 {plan.nextChapter} 章
              {plan.suggestions.length > 0
                ? ` · ${plan.suggestions.map((s) => `${kindLabel(s.laneKind)}「${s.laneTitle}」（${s.reasonText}）`).join("；")}`
                : " · 活跃剧情线都在推进中"}
              {plan.hookPlan.length > 0 ? ` · 顺手回收「${plan.hookPlan[0]!.debt.title}」` : ""}
            </div>
          ) : (
            <div className="mt-2 rounded-md bg-muted px-3 py-2 text-2xs text-muted-foreground" data-testid="next-suggestion-empty">
              还没有剧情线。到「推进板」把主线和感情线各建一条，这里才会有建议；伏笔账本已经能用。
            </div>
          )}
          {plan.suggestions.length > 0 ? (
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                className="rounded bg-primary px-2.5 py-1 text-2xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                disabled={!onSendToNarrator}
                onClick={() =>
                  void messageNarrator(
                    `按下一章建议推进第 ${plan.nextChapter} 章：${plan.suggestions.map((s) => `${kindLabel(s.laneKind)}「${s.laneTitle}」推进一拍（${s.reasonText}）`).join("；")}${plan.hookPlan.length > 0 ? `；顺手回收或推进伏笔「${plan.hookPlan[0]!.debt.title}」` : ""}。先经 write.preflight 检查 就绪，再 scene.spec 排蓝图，最后 pipeline.write 写章；数据以快照为准，编排以写作技能为准。`,
                  )
                }
                data-testid="next-send-suggestion"
              >
                把建议发给叙述者
              </button>
            </div>
          ) : null}
        </section>

        {/* 情节板迷你 */}
        <section className="rounded-md border border-border bg-card/50 px-3 py-2" data-testid="next-board-mini">
          <div className="flex items-center justify-between">
            <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Swords className="mr-1 inline size-3.5" /> 剧情线 × 最近章
            </span>
            <span className="text-2xs text-muted-foreground">{plan.narrativeSummary}</span>
          </div>
          {allLanes.length === 0 ? (
            <p className="mt-2 text-2xs text-muted-foreground">还没有剧情线，建后才能排节拍。</p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full border-collapse text-2xs" data-testid="next-board-table">
                <thead>
                  <tr>
                    <th className="border border-border bg-muted/40 px-2 py-1 text-left font-medium text-muted-foreground">剧情线</th>
                    {boardChapters.map((chapter) => (
                      <th key={chapter} className={`border border-border px-2 py-1 text-left font-medium ${chapter === plan.nextChapter ? "bg-primary/10 text-primary" : "bg-muted/40 text-muted-foreground"}`}>
                        第 {chapter} 章{chapter === plan.nextChapter ? "（建议）" : ""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {allLanes.map((lane) => (
                    <tr key={lane.id}>
                      <td className="border border-border bg-muted/20 px-2 py-1 align-top">
                        <div className="font-medium">{kindLabel(lane.kind)}「{lane.title}」</div>
                        {lane.reasonText ? <div className="text-muted-foreground">{lane.reasonText}</div> : null}
                      </td>
                      {boardChapters.map((chapter) => {
                        if (chapter === plan.nextChapter) {
                          const isFocusLane = lanes.some((item) => item.id === lane.id);
                          return (
                            <td key={chapter} className="border border-border bg-primary/5 px-2 py-1 align-top" data-testid={`next-board-suggest-${lane.id}`}>
                              {isFocusLane ? (
                                plan.suggestions.find((suggestion) => suggestion.storylineId === lane.id || suggestion.id === lane.id)?.reasonText ?? "建议推进一拍"
                              ) : (
                                <span className="text-muted-foreground">＋</span>
                              )}
                            </td>
                          );
                        }
                        const scenesFor = sceneTitlesByChapter.get(lane.id)?.get(chapter) ?? [];
                        return (
                          <td key={chapter} className="border border-border px-2 py-1 align-top">
                            {scenesFor.length > 0 ? (
                              scenesFor.map((title, index) => (
                                <button
                                  key={`${lane.id}-${chapter}-${index}`}
                                  type="button"
                                  className="block w-full rounded bg-primary/10 px-1.5 py-0.5 text-left hover:bg-primary/20"
                                  onClick={() => onOpenChapter?.(chapter)}
                                >
                                  {title}
                                </button>
                              ))
                            ) : (
                              <span className="text-muted-foreground">＋</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-1.5 text-2xs text-muted-foreground">查看完整推进板：切到本页上方「推进」页签。</p>
        </section>
      </div>

      {/* 伏笔账本 */}
      <aside className="rounded-md border border-border bg-card/50 px-3 py-2" data-testid="next-hook-ledger">
        <div className="flex items-center justify-between">
          <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">伏笔账本</span>
          <button
            type="button"
            className="text-2xs text-muted-foreground hover:text-foreground"
            onClick={() => { setVersion((value) => value + 1); reload(); }}
            data-testid="next-hook-refresh"
          >
            <RefreshCw className="inline size-3" />
          </button>
        </div>
        {note ? <p className="mt-1 text-2xs text-muted-foreground" role="status" data-testid="next-hook-note">{note}</p> : null}

        <HookGroup
          plan={plan.overdue}
          urgency="overdue"
          emptyLine="没有超期伏笔。"
          busyId={busyId}
          onSchedule={scheduleHook}
          onPaidOff={markPaidOff}
        />
        <HookGroup
          plan={plan.watch}
          urgency="watch"
          emptyLine="没有临近伏笔。"
          busyId={busyId}
          onSchedule={scheduleHook}
          onPaidOff={markPaidOff}
        />
        <HookGroup plan={plan.healthy} urgency="ok" emptyLine="没有进行中的伏笔。" busyId={busyId} onSchedule={scheduleHook} />

        <div className="mt-2 border-t border-border/60 pt-2" data-testid="next-hook-plant">
          <button
            type="button"
            className="flex items-center gap-1 text-2xs text-muted-foreground hover:text-foreground"
            onClick={() => setPlantOpen((open) => !open)}
            data-testid="next-hook-plant-toggle"
          >
            <ChevronDown className={`size-3 transition-transform ${plantOpen ? "rotate-180" : ""}`} />
            <Sprout className="size-3.5" /> 在第 {plan.nextChapter} 章埋一个新的
          </button>
          {plantOpen ? (
            <div className="mt-2 space-y-1.5">
              <input
                value={plantTitle}
                onChange={(event) => setPlantTitle(event.target.value)}
                placeholder="要埋什么（例：拍卖会上的科学丹方）"
                className="w-full rounded border border-border bg-background px-2 py-1 text-2xs outline-none focus:border-primary"
                data-testid="next-hook-plant-title"
              />
              <input
                value={plantChapter}
                onChange={(event) => setPlantChapter(event.target.value)}
                placeholder={`埋设章（缺省 = 第 ${plan.nextChapter} 章）`}
                className="w-full rounded border border-border bg-background px-2 py-1 text-2xs outline-none focus:border-primary"
                data-testid="next-hook-plant-chapter"
              />
              <button
                type="button"
                className="rounded bg-primary px-2 py-1 text-2xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                disabled={plantBusy}
                onClick={() => void plantHook()}
                data-testid="next-hook-plant-confirm"
              >
                {plantBusy ? "埋点中…" : "埋下（待我确认后开始计时）"}
              </button>
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function HookGroup({ plan, urgency, emptyLine, busyId, onSchedule, onPaidOff }: {
  readonly plan: readonly ForeshadowDebt[];
  readonly urgency: ForeshadowDebt["urgency"];
  readonly emptyLine: string;
  readonly busyId: string | null;
  readonly onSchedule?: (debt: ForeshadowDebt) => void;
  readonly onPaidOff?: (debt: ForeshadowDebt) => Promise<void>;
}) {
  const meta = URGENCY_META[urgency];
  return (
    <div className="mt-2">
      <p className="text-2xs font-medium text-muted-foreground">{meta.label}（{plan.length}）</p>
      {plan.length === 0 ? (
        <p className="text-2xs text-muted-foreground/70">{emptyLine}</p>
      ) : (
        <ul className="mt-1 space-y-1.5">
          {plan.map((debt) => (
            <li key={debt.entryId} className={`rounded border px-2 py-1.5 text-2xs ${meta.className}`} data-testid={`next-hook-${urgency}-${debt.entryId}`}>
              <div className="font-medium text-foreground">{debt.title}</div>
              <div className="text-muted-foreground">{debt.reason}</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {onSchedule ? (
                  <button
                    type="button"
                    className="rounded bg-primary/15 px-1.5 py-0.5 text-primary hover:bg-primary/25"
                    onClick={() => onSchedule(debt)}
                    data-testid={`next-hook-schedule-${debt.entryId}`}
                  >
                    排进下一章
                  </button>
                ) : null}
                {onPaidOff ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 hover:bg-accent disabled:opacity-50"
                    disabled={busyId === debt.entryId}
                    onClick={() => void onPaidOff(debt)}
                    data-testid={`next-hook-paidoff-${debt.entryId}`}
                  >
                    <Check className="size-3" /> 标记已回收
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
