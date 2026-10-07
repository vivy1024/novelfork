/**
 * 「故事推进」默认页：全书走势 + 下一章（双栏）。
 *
 * 左栏（约 2/3）：ChapterTimelinePanel——全书走势，每章一行，点行展开章内事件。
 * 右栏（约 1/3）：下一章计划 = 焦点卡 + 建议 + 伏笔账本，数据仍全部来自现有权威源：
 *  - 焦点与建议：经纬 current-focus 单例 + narrative-structure 快照（纯函数 next-chapter-plan 合成，
 *    数据装配在 use-next-chapter-plan，故事推进侧栏的下一步卡引用同一份计划与同一句建议）
 *  - 伏笔账本：快照里已带 urgency 的 ForeshadowDebt，「排进本章」发叙述者指令、
 *    「标记已回收」走 PUT jingwei/entries 的 fieldsPatch、待埋点用 POST 建 needs-review 草稿——
 *    本体数据不变，直到叙述者或作者经正常通道落盘。
 *
 * 与前版的三处改造（样式纪律：状态用文字标签 + 色点，不用彩色色块）：
 *  1. 伏笔改为「状态色点 + 文字标签 + 标题」一行，按紧迫度排序，默认只展开最急 3 条，其余收起；
 *  2. 剧情线为 0 时给引导卡（「这本书还没有剧情线」+ 让叙述者归纳剧情线），不再有空壳网格；
 *  3. 推进 / 因果视图的入口只在有剧情线时出现——没有线的书不给死链。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Compass, GitFork, LayoutGrid, Loader2, MoonStar, RefreshCw, Route, Sprout } from "lucide-react";

import { fetchJson } from "@/hooks/use-api";
import { describeNextChapterSuggestion, storylineKindLabel as kindLabel } from "./next-chapter-plan";
import { useNextChapterPlan } from "./use-next-chapter-plan";
import { ChapterTimelinePanel } from "./ChapterTimelinePanel";
import type { ForeshadowDebt } from "../../engine/narrative-taxonomy/foreshadow-debts.js";

export interface NextChapterPanelProps {
  readonly bookId: string;
  readonly currentChapter?: number;
  readonly onOpenChapter?: (chapterNumber: number) => void;
  readonly onSendToNarrator?: (message: string) => Promise<void> | void;
  /** 有剧情线时的视图入口；入口的实现在宿主画布（页签切换），这里只发意图。 */
  readonly onOpenBoardProgress?: () => void;
  readonly onOpenCausalTree?: () => void;
}

interface ForeshadowEntryLike {
  readonly id: string;
  readonly fields?: Record<string, unknown>;
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

/** 伏笔状态：文字标签 + 色点。只有「超期」会当正文警示色，其余克制。 */
const URGENCY_META: Record<ForeshadowDebt["urgency"], { label: string; dot: string }> = {
  overdue: { label: "超期", dot: "bg-red-500" },
  watch: { label: "临近", dot: "bg-amber-500" },
  ok: { label: "近期可用", dot: "bg-emerald-500" },
};

/** 默认只展开最急的 3 条。 */
const DEFAULT_EXPANDED_HOOKS = 3;

/** 诱导剧情线的叙述者指令：读已结算事件 → 归纳草稿 → 作者在待确认里逐条定。 */
const INDUCE_STORYLINES_MESSAGE =
  "这本书还没有剧情线。请读取已结算章节的叙事事件，归纳剧情线草案（主线 / 支线 / 感情线等），写成 needs-review 待确认草稿，不要直接当定稿；我会到「待确认」里逐条定。";

export function NextChapterPanel({
  bookId,
  currentChapter,
  onOpenChapter,
  onSendToNarrator,
  onOpenBoardProgress,
  onOpenCausalTree,
}: NextChapterPanelProps) {
  const { state, reload, plan } = useNextChapterPlan(bookId, currentChapter);
  const [version, setVersion] = useState(0);
  const fieldsMap = useForeshadowEntries(bookId, version);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [plantOpen, setPlantOpen] = useState(false);
  const [plantTitle, setPlantTitle] = useState("");
  const [plantChapter, setPlantChapter] = useState("");
  const [plantBusy, setPlantBusy] = useState(false);
  const [restOpen, setRestOpen] = useState(false);

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

  // 伏笔账本：四类合成一串，按紧迫度（超期 → 临近 → 近期可用）排，默认只展开最急 3 条。
  const allHooks = useMemo<readonly ForeshadowDebt[]>(() => {
    if (!plan) return [];
    return [...plan.overdue, ...plan.watch, ...plan.healthy];
  }, [plan]);
  const pinnedHooks = allHooks.slice(0, DEFAULT_EXPANDED_HOOKS);
  const restHooks = allHooks.slice(DEFAULT_EXPANDED_HOOKS);

  if (state.status === "loading" || !plan) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground" data-testid="next-chapter-panel">
        <Loader2 className="size-4 animate-spin" /> 正在读取叙事结构…
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-1" data-testid="next-chapter-panel">
      <header className="flex flex-wrap items-baseline gap-x-2 px-1">
        <Route className="size-3.5 self-center text-muted-foreground" />
        <span className="text-sm font-semibold">全书走势 · 下一章</span>
        <span className="text-2xs text-muted-foreground">左边看故事怎么走到现在，右边定第 {plan.nextChapter} 章写什么。</span>
      </header>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[2fr_1fr]" data-testid="next-chapter-columns">
        {/* 左栏：全书走势 */}
        <section className="min-w-0 rounded-md border border-border bg-card/50 px-2 py-1.5" aria-label="全书走势">
          <ChapterTimelinePanel
            bookId={bookId}
            {...(currentChapter !== undefined ? { currentChapter } : {})}
            {...(onOpenChapter ? { onOpenChapter } : {})}
          />
        </section>

        {/* 右栏：下一章 */}
        <aside className="flex min-w-0 flex-col gap-3 rounded-md border border-border bg-card/50 px-3 py-2" data-testid="next-chapter-side" aria-label={`下一章：第 ${plan.nextChapter} 章`}>
          <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Compass className="size-3.5" /> 下一章 · 第 {plan.nextChapter} 章
          </div>

          {/* 焦点卡 */}
          <section data-testid="next-focus-card">
            {plan.focus ? (
              <>
                <p className="text-sm font-medium" data-testid="next-focus-goal">{plan.focus.goal}</p>
                {plan.focus.why ? <p className="mt-1 text-2xs text-muted-foreground" data-testid="next-focus-why">为什么现在：{plan.focus.why}</p> : null}
              </>
            ) : (
              <p className="text-2xs text-muted-foreground" data-testid="next-focus-empty">
                还没填本章焦点。到写作视图的「创作罗盘」写一句本章最该推进的事，建议会按它点名剧情线。
              </p>
            )}
          </section>

          {/* 建议 / 剧情线引导卡 */}
          {plan.hasStorylines ? (
            <div className="rounded-md bg-primary/10 px-3 py-2 text-2xs text-foreground" data-testid="next-suggestion-line">
              {describeNextChapterSuggestion(plan)}
            </div>
          ) : (
            <section className="rounded-md border border-dashed border-border px-3 py-2.5" data-testid="next-storyline-empty">
              <div className="flex items-center gap-1.5 text-2xs font-medium">
                <GitFork className="size-3.5 text-muted-foreground" /> 这本书还没有剧情线
              </div>
              <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">
                剧情线是「下一章建议」的地基。叙述者可以先替你起个草稿：读已结算章的事件、归纳剧情线草稿、你在「待确认」里逐条定。
              </p>
              <button
                type="button"
                className="mt-2 inline-flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-2xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                disabled={!onSendToNarrator}
                onClick={() => void messageNarrator(INDUCE_STORYLINES_MESSAGE)}
                data-testid="next-storyline-induce"
              >
                <MoonStar className="size-3" /> 让叙述者从事件里归纳剧情线
              </button>
              {!onSendToNarrator ? (
                <p className="mt-1 text-2xs text-muted-foreground">当前视图没接叙述者通道，按钮暂不可用。</p>
              ) : null}
            </section>
          )}

          {plan.suggestions.length > 0 ? (
            <div className="flex justify-start">
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

          {/* 推进 / 因果视图入口：只在有剧情线时给；没有线的书这两个视图同样没有内容，不给死链。 */}
          {plan.hasStorylines && (onOpenBoardProgress || onOpenCausalTree) ? (
            <div className="flex items-center gap-2 text-2xs text-muted-foreground" data-testid="next-view-links">
              <span>完整视图：</span>
              {onOpenBoardProgress ? (
                <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={onOpenBoardProgress} data-testid="next-link-board">
                  <LayoutGrid className="size-3" /> 推进板
                </button>
              ) : null}
              {onOpenCausalTree ? (
                <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={onOpenCausalTree} data-testid="next-link-causal">
                  <GitFork className="size-3" /> 因果树
                </button>
              ) : null}
            </div>
          ) : null}

          {/* 伏笔账本 */}
          <section className="border-t border-border/60 pt-2" data-testid="next-hook-ledger">
            <div className="flex items-center justify-between">
              <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">伏笔账本（{allHooks.length}）</span>
              <button
                type="button"
                className="text-2xs text-muted-foreground hover:text-foreground"
                onClick={() => { setVersion((value) => value + 1); reload(); }}
                data-testid="next-hook-refresh"
                aria-label="刷新伏笔账本"
              >
                <RefreshCw className="inline size-3" />
              </button>
            </div>
            {note ? <p className="mt-1 text-2xs text-muted-foreground" role="status" data-testid="next-hook-note">{note}</p> : null}

            {allHooks.length === 0 ? (
              <p className="mt-1.5 text-2xs text-muted-foreground/70" data-testid="next-hook-empty">还没有开着伏笔账。埋了新的才会在这里倒计时。</p>
            ) : (
              <ul className="mt-1.5 space-y-1" data-testid="next-hook-list">
                {(restOpen ? allHooks : pinnedHooks).map((debt) => {
                  const meta = URGENCY_META[debt.urgency];
                  return (
                    <li
                      key={debt.entryId}
                      className="rounded border border-border/60 px-2 py-1.5 text-2xs"
                      data-testid={`next-hook-item-${debt.entryId}`}
                      data-urgency={debt.urgency}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className={`size-1.5 shrink-0 rounded-full ${meta.dot}`} data-testid={`next-hook-dot-${debt.entryId}`} />
                        <span className="shrink-0 text-muted-foreground">{meta.label} · 已悬置 {debt.chaptersPending ?? "?"} 章</span>
                        <span className="min-w-0 truncate font-medium">{debt.title}</span>
                      </div>
                      {debt.reason ? <div className="mt-0.5 pl-3 text-muted-foreground">{debt.reason}</div> : null}
                      <div className="mt-1 flex flex-wrap gap-1.5 pl-3">
                        <button
                          type="button"
                          className="rounded bg-primary/15 px-1.5 py-0.5 text-primary hover:bg-primary/25"
                          onClick={() => scheduleHook(debt)}
                          data-testid={`next-hook-schedule-${debt.entryId}`}
                        >
                          排进下一章
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 hover:bg-accent disabled:opacity-50"
                          disabled={busyId === debt.entryId}
                          onClick={() => void markPaidOff(debt)}
                          data-testid={`next-hook-paidoff-${debt.entryId}`}
                        >
                          <Check className="size-3" /> 标记已回收
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {restHooks.length > 0 ? (
              <button
                type="button"
                className="mt-1.5 flex items-center gap-1 text-2xs text-muted-foreground hover:text-foreground"
                onClick={() => setRestOpen((open) => !open)}
                data-testid="next-hook-toggle-rest"
              >
                <ChevronDown className={`size-3 transition-transform ${restOpen ? "rotate-180" : ""}`} />
                {restOpen ? "收起" : `展开其余 ${restHooks.length} 条（${restHooks.map((debt) => debt.title).join("、")}）`}
              </button>
            ) : null}

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
          </section>
        </aside>
      </div>
    </div>
  );
}
