/**
 * 本章叙事记忆与改动板（ChapterMemoryDiffBoard）
 *
 * 位于已写章节编辑器右侧伴随栏的「记忆改动」页签：
 * 1. 展示本章已留存的叙事记忆：本章事件流、当章生效/变动的叙事事实、待作者确认的事件提案（支持就地确认/驳回）；
 * 2. 展示本章出现的人物内核与到期伏笔提醒；
 * 3. 展示作者手改状态：结算新鲜度比对、作者手改 AI 原稿占比，以及一键「让叙述者重结算」与「打开文风金库」入口。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  GitCompare,
  History,
  Loader2,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fetchJson, useApi } from "@/hooks/use-api";
import { cn } from "@/lib/utils";
import { computeAuthorShare } from "../../engine/writing-layers/style-vault-share";
import { toWireToolName } from "../../engine/workflows/run-brief";
import {
  fetchPendingEvents,
  mutatePendingEvent,
  riskLabel,
  type PendingEvent,
} from "./narrative-pending-events";

export interface ChapterMemoryDiffBoardProps {
  readonly bookId: string;
  readonly chapterNumber?: number;
  /** 当前编辑器正文（用于实时比对 AI 原稿改动占比与结算新鲜度）。 */
  readonly content?: string;
  readonly dirty?: boolean;
  readonly onOpenJingweiEntry?: (entryId: string) => boolean;
  readonly onOpenStyleVault?: (chapterNumber: number) => void;
  readonly onSendToNarrator?: (message: string) => Promise<void> | void;
  readonly className?: string;
}

interface GraphEventItem {
  readonly id?: string;
  readonly summary?: string;
  readonly description?: string;
  readonly eventType?: string;
  readonly subject?: string;
  readonly object?: string;
  readonly subjectEntryId?: string;
  readonly objectEntryId?: string;
  readonly chapterNumber?: number;
}

interface FactsResponse {
  readonly facts?: ReadonlyArray<{
    readonly id: string;
    readonly subject: string;
    readonly predicate: string;
    readonly object: string;
    readonly category: string;
    readonly validFromChapter?: number;
    readonly sourceType?: string;
  }>;
}

interface AiDraftResponse {
  readonly hasAiDraft?: boolean;
  readonly text?: string;
  readonly createdAt?: string;
}

interface SettlementStatusResponse {
  readonly changed?: boolean;
}

export function ChapterMemoryDiffBoard({
  bookId,
  chapterNumber,
  content = "",
  dirty = false,
  onOpenJingweiEntry,
  onOpenStyleVault,
  onSendToNarrator,
  className,
}: ChapterMemoryDiffBoardProps) {
  const hasChapter = typeof chapterNumber === "number" && chapterNumber > 0;

  const eventsQuery = useApi<{ readonly events?: readonly GraphEventItem[] }>(
    hasChapter
      ? `/api/books/${encodeURIComponent(bookId)}/narrative-memory/graph?view=timeline&chapterFrom=${chapterNumber}&chapterTo=${chapterNumber}`
      : null,
  );
  const factsQuery = useApi<FactsResponse>(
    hasChapter
      ? `/api/books/${encodeURIComponent(bookId)}/narrative-memory/facts?asOfChapter=${chapterNumber}`
      : null,
  );
  const aiDraftQuery = useApi<AiDraftResponse>(
    hasChapter
      ? `/api/books/${encodeURIComponent(bookId)}/style/vault/chapters/${chapterNumber}/ai-draft`
      : null,
  );

  const [pendingEvents, setPendingEvents] = useState<readonly PendingEvent[]>([]);
  const [pendingBusyId, setPendingBusyId] = useState<string | null>(null);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [settlementStale, setSettlementStale] = useState<boolean | null>(null);
  const [checkingSettlement, setCheckingSettlement] = useState(false);

  const loadPending = useCallback(async () => {
    if (!hasChapter) {
      setPendingEvents([]);
      return;
    }
    try {
      const all = await fetchPendingEvents(bookId, { limit: 60 });
      setPendingEvents(all.filter((e) => e.chapterNumber === chapterNumber));
      setPendingError(null);
    } catch (err) {
      setPendingError(err instanceof Error ? err.message : "读取待审提议失败");
    }
  }, [bookId, chapterNumber, hasChapter]);

  useEffect(() => {
    void loadPending();
  }, [loadPending]);

  useEffect(() => {
    if (!hasChapter || !content.trim()) {
      setSettlementStale(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setCheckingSettlement(true);
      try {
        const res = await fetchJson<SettlementStatusResponse>(
          `/api/books/${encodeURIComponent(bookId)}/narrative-memory/settlement-status`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chapterNumber, content }),
            signal: controller.signal,
          },
        );
        if (!controller.signal.aborted) {
          setSettlementStale(Boolean(res?.changed));
        }
      } catch {
        if (!controller.signal.aborted) setSettlementStale(null);
      } finally {
        if (!controller.signal.aborted) setCheckingSettlement(false);
      }
    }, 600);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [bookId, chapterNumber, content, hasChapter]);

  const reloadAll = useCallback(() => {
    void Promise.allSettled([
      eventsQuery.refetch(),
      factsQuery.refetch(),
      aiDraftQuery.refetch(),
      loadPending(),
    ]);
  }, [aiDraftQuery, eventsQuery, factsQuery, loadPending]);

  const chapterEvents = eventsQuery.data?.events ?? [];
  const chapterFacts = useMemo(() => {
    const all = factsQuery.data?.facts ?? [];
    if (!hasChapter) return [];
    const current = all.filter((f) => f.validFromChapter === chapterNumber);
    return current.length > 0 ? current : all.slice(0, 8);
  }, [factsQuery.data?.facts, hasChapter, chapterNumber]);

  const isCurrentChapterFacts = useMemo(() => {
    const all = factsQuery.data?.facts ?? [];
    return hasChapter && all.some((f) => f.validFromChapter === chapterNumber);
  }, [factsQuery.data?.facts, hasChapter, chapterNumber]);

  const share = useMemo(() => {
    if (!aiDraftQuery.data?.hasAiDraft || !aiDraftQuery.data.text) return null;
    return computeAuthorShare(aiDraftQuery.data.text, content);
  }, [aiDraftQuery.data, content]);

  const handlePendingAction = async (event: PendingEvent, action: "approve" | "reject") => {
    if (!event.id || pendingBusyId) return;
    setPendingBusyId(event.id);
    try {
      await mutatePendingEvent(bookId, event.id, action);
      await loadPending();
      void factsQuery.refetch();
      void eventsQuery.refetch();
    } catch (err) {
      setPendingError(err instanceof Error ? err.message : "处理提议失败");
    } finally {
      setPendingBusyId(null);
    }
  };

  const loading = eventsQuery.loading || factsQuery.loading || aiDraftQuery.loading;

  return (
    <aside
      className={cn("flex h-full min-h-0 flex-col overflow-y-auto bg-card text-card-foreground", className)}
      data-testid="chapter-memory-diff-board"
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold text-foreground">
              {hasChapter ? `第 ${chapterNumber} 章记忆与改动` : "记忆与改动"}
            </span>
            {dirty ? (
              <Badge variant="outline" className="h-4 px-1.5 text-2xs text-warning border-warning/40">
                有未保存改动
              </Badge>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={reloadAll}
          disabled={loading}
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          title="刷新记忆与改动状态"
          aria-label="刷新记忆与改动状态"
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
        </button>
      </header>

      <div className="flex flex-1 flex-col divide-y divide-border">
        {/* 1. 本章正文改动与结算状态 */}
        <section className="space-y-2 px-3 py-2.5" data-testid="memory-diff-settlement-section">
          <div className="flex items-center justify-between gap-1">
            <span className="inline-flex items-center gap-1 text-2xs font-semibold text-foreground">
              <GitCompare className="size-3 text-primary" />
              正文改动与记忆新鲜度
            </span>
            {checkingSettlement ? <Loader2 className="size-3 animate-spin text-muted-foreground" /> : null}
          </div>

          {hasChapter ? (
            <>
              {settlementStale === true ? (
                <div className="rounded-md border border-warning/40 bg-warning/10 p-2 text-2xs text-warning space-y-1.5">
                  <div className="flex items-start gap-1.5">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    <span>本章正文在结算后有过修改，已留存的叙事记忆可能与当前正文不一致。</span>
                  </div>
                  {onSendToNarrator ? (
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      className="h-6 w-full gap-1 text-2xs border-warning/40 hover:bg-warning/15"
                      onClick={() => {
                        void onSendToNarrator(
                          `请对第 ${chapterNumber} 章重新执行 ${toWireToolName("memory.settle_chapter")}（force=true），正文已修改需要刷新叙事记忆与事实变动。`,
                        );
                      }}
                    >
                      <Sparkles className="size-3" />
                      <span>让叙述者重结算本章记忆</span>
                    </Button>
                  ) : null}
                </div>
              ) : settlementStale === false ? (
                <div className="flex items-center justify-between gap-2 rounded-md border border-border/70 bg-background/60 px-2.5 py-1.5 text-2xs">
                  <span className="inline-flex items-center gap-1 text-primary">
                    <CheckCircle2 className="size-3.5" />
                    叙事记忆与当前正文同步
                  </span>
                  {onSendToNarrator ? (
                    <button
                      type="button"
                      onClick={() => {
                        void onSendToNarrator(
                          `请对第 ${chapterNumber} 章强制重新梳理叙事记忆（调用 ${toWireToolName("memory.settle_chapter")}，force=true），核对是否漏记事实或状态变动。`,
                        );
                      }}
                      className="text-muted-foreground hover:text-primary hover:underline"
                    >
                      强制复算
                    </button>
                  ) : null}
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2 rounded-md border border-dashed border-border px-2.5 py-1.5 text-2xs text-muted-foreground">
                  <span>尚未比对到结算指纹（可能尚未结算）</span>
                  {onSendToNarrator ? (
                    <button
                      type="button"
                      onClick={() => {
                        void onSendToNarrator(
                          `请对第 ${chapterNumber} 章执行 ${toWireToolName("memory.settle_chapter")}，抽取本章叙事事件与设定改动。`,
                        );
                      }}
                      className="font-medium text-primary hover:underline"
                    >
                      结算本章
                    </button>
                  ) : null}
                </div>
              )}

              {/* 作者改动 AI 原稿比例 */}
              <div className="rounded-md border border-border/70 bg-background/60 p-2 text-2xs space-y-1">
                <div className="flex items-center justify-between gap-1">
                  <span className="font-medium text-foreground">AI 原稿手改占比</span>
                  {share ? (
                    <Badge variant="secondary" className="h-4 px-1.5 text-2xs">
                      作者改动 {Math.round(share.authorRatio * 100)}%
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">无 AI 原稿对照</span>
                  )}
                </div>
                {share ? (
                  <p className="text-muted-foreground">
                    你改写或新写了 {share.authorChars.toLocaleString()} 字，原样保留 {share.aiChars.toLocaleString()} 字。
                  </p>
                ) : null}
                {onOpenStyleVault && share ? (
                  <button
                    type="button"
                    onClick={() => onOpenStyleVault(chapterNumber!)}
                    className="text-primary hover:underline"
                  >
                    去文风金库查看逐句 Diff / 采纳范文 →
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            <p className="text-2xs text-muted-foreground">打开具体章节后即可核对本章手改占比与记忆同步状态。</p>
          )}
        </section>

        {/* 2. 待确认的本章记忆提议 */}
        {pendingEvents.length > 0 || pendingError ? (
          <section className="space-y-2 px-3 py-2.5" data-testid="memory-diff-pending-section">
            <div className="flex items-center justify-between gap-1">
              <span className="text-2xs font-semibold text-foreground">
                待确认记忆变动 ({pendingEvents.length})
              </span>
            </div>
            {pendingError ? (
              <p className="text-2xs text-destructive">{pendingError}</p>
            ) : null}
            <ul className="space-y-1.5">
              {pendingEvents.map((event) => {
                const busy = pendingBusyId === event.id;
                return (
                  <li key={event.id ?? event.entity} className="rounded-md border border-warning/35 bg-warning/5 p-2 text-2xs space-y-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-medium text-foreground">
                        {event.entity ?? "未命名实体"}{event.eventType ? ` · ${event.eventType}` : ""}
                      </span>
                      <Badge variant="outline" className="h-4 px-1 text-2xs">
                        {riskLabel(event.risk)}
                      </Badge>
                    </div>
                    {event.evidence ? (
                      <p className="line-clamp-2 text-muted-foreground">{event.evidence}</p>
                    ) : null}
                    {event.id ? (
                      <div className="flex justify-end gap-1 pt-0.5">
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          disabled={Boolean(pendingBusyId)}
                          onClick={() => void handlePendingAction(event, "reject")}
                          className="h-5 gap-0.5 px-1.5 text-2xs"
                        >
                          <X className="size-2.5" />
                          <span>驳回</span>
                        </Button>
                        <Button
                          type="button"
                          size="xs"
                          disabled={Boolean(pendingBusyId)}
                          onClick={() => void handlePendingAction(event, "approve")}
                          className="h-5 gap-0.5 px-1.5 text-2xs"
                        >
                          {busy ? <Loader2 className="size-2.5 animate-spin" /> : <Check className="size-2.5" />}
                          <span>确认入库</span>
                        </Button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {/* 3. 本章已留存的叙事事件 */}
        <section className="space-y-2 px-3 py-2.5" data-testid="memory-diff-events-section">
          <div className="flex items-center justify-between gap-1">
            <span className="inline-flex items-center gap-1 text-2xs font-semibold text-foreground">
              <History className="size-3 text-info" />
              本章已留存事件 ({chapterEvents.length})
            </span>
          </div>
          {eventsQuery.loading && chapterEvents.length === 0 ? (
            <p className="text-2xs text-muted-foreground">读取本章事件中…</p>
          ) : chapterEvents.length === 0 ? (
            <p className="text-2xs text-muted-foreground">本章尚未沉淀叙事事件记录。</p>
          ) : (
            <ul className="space-y-1.5">
              {chapterEvents.map((ev, index) => (
                <li key={ev.id ?? index} className="rounded-md border border-border/70 bg-background/60 p-2 text-2xs space-y-0.5">
                  <div className="flex flex-wrap items-center gap-1 font-medium text-foreground">
                    {ev.subject ? (
                      ev.subjectEntryId && onOpenJingweiEntry ? (
                        <button
                          type="button"
                          onClick={() => onOpenJingweiEntry(ev.subjectEntryId!)}
                          className="text-primary hover:underline"
                        >
                          {ev.subject}
                        </button>
                      ) : (
                        <span>{ev.subject}</span>
                      )
                    ) : null}
                    {ev.eventType ? <span className="text-muted-foreground">· {ev.eventType}</span> : null}
                    {ev.object ? <span className="text-foreground">→ {ev.object}</span> : null}
                  </div>
                  {(ev.summary || ev.description) ? (
                    <p className="leading-relaxed text-muted-foreground">{ev.summary || ev.description}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 4. 本章关联事实变动 */}
        <section className="space-y-2 px-3 py-2.5" data-testid="memory-diff-facts-section">
          <div className="flex items-center justify-between gap-1">
            <span className="text-2xs font-semibold text-foreground">
              {isCurrentChapterFacts ? `第 ${chapterNumber} 章新增/改写事实` : "截至本章生效事实"} ({chapterFacts.length})
            </span>
          </div>
          {factsQuery.loading && chapterFacts.length === 0 ? (
            <p className="text-2xs text-muted-foreground">读取叙事事实中…</p>
          ) : chapterFacts.length === 0 ? (
            <p className="text-2xs text-muted-foreground">暂无对应的叙事事实记录。</p>
          ) : (
            <ul className="space-y-1">
              {chapterFacts.slice(0, 12).map((fact) => (
                <li key={fact.id} className="rounded border border-border/60 bg-background/50 px-2 py-1 text-2xs">
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-medium text-foreground">
                      {fact.subject} · {fact.predicate}
                    </span>
                    {fact.validFromChapter ? (
                      <span className="shrink-0 text-muted-foreground">第{fact.validFromChapter}章</span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-muted-foreground">{fact.object}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </aside>
  );
}
