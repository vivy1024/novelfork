import { useEffect, useMemo, useState, useRef } from "react";
import {
  AlertCircle,
  BarChart2,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Clock,
  Download,
  FileInput,
  Flame,
  MoreVertical,
  Plus,
  Settings,
  Target,
  TrendingUp,
  Trash2,
  Zap,
} from "lucide-react";

import { AiModelRequiredDialog } from "@/components/ai/AiModelRequiredDialog";
import { PageEmptyState } from "@/components/layout/PageEmptyState";
import { PageScaffold } from "@/components/layout/PageScaffold";
import { GettingStartedChecklist, type GettingStartedStatus } from "@/components/onboarding/GettingStartedChecklist";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useAiModelGate } from "../hooks/use-ai-model-gate";
import { deriveActiveBookIds, shouldRefetchBookCollections } from "../hooks/use-book-activity";
import { fetchJson, postApi, useApi } from "../hooks/use-api";
import { notify } from "@/lib/notify";
import { useColors } from "../hooks/use-colors";
import type { TFunction } from "../hooks/use-i18n";
import type { SSEMessage } from "../hooks/use-sse";
import type { Theme } from "../hooks/use-theme";

interface BookSummary {
  readonly id: string;
  readonly title: string;
  readonly genre: string;
  readonly status: string;
  readonly chaptersWritten: number;
  readonly language?: string;
  readonly fanficMode?: string;
}

interface Nav {
  toBook: (id: string) => void;
  toAnalytics: (id: string) => void;
  toBookCreate: () => void;
  toAdmin?: (section?: "providers") => void;
  toBible?: (id: string) => void;
  toDetect?: (id: string) => void;
  toWorkflow?: (section?: "advanced") => void;
}

function BookMenu({ bookId, bookTitle, nav, t, onDelete }: {
  readonly bookId: string;
  readonly bookTitle: string;
  readonly nav: Nav;
  readonly t: TFunction;
  readonly onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const handleDelete = async () => {
    setConfirmDelete(false);
    setOpen(false);
    await fetchJson(`/books/${bookId}`, { method: "DELETE" });
    onDelete();
  };

  const handleExport = async () => {
    setOpen(false);
    try {
      const data = await fetchJson<{ content: string; filename: string }>(`/books/${bookId}/export?format=txt`);
      const blob = new Blob([data.content], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = data.filename || `${bookId}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      notify.error("导出失败", { description: e instanceof Error ? e.message : undefined });
    }
  };

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="p-3 rounded-xl text-muted-foreground hover:text-primary hover:bg-primary/10 hover:scale-105 active:scale-95 transition-all cursor-pointer"
      >
        <MoreVertical size={18} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-44 bg-card border border-border rounded-xl shadow-lg shadow-primary/5 py-1 z-50 fade-in">
          <button
            onClick={() => { setOpen(false); nav.toBook(bookId); }}
            className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-foreground hover:bg-secondary/50 transition-colors cursor-pointer"
          >
            <Settings size={14} className="text-muted-foreground" />
            {t("book.settings")}
          </button>
          <button
            onClick={handleExport}
            className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-foreground hover:bg-secondary/50 transition-colors cursor-pointer"
          >
            <Download size={14} className="text-muted-foreground" />
            {t("book.export")}
          </button>
          <div className="border-t border-border/50 my-1" />
          <button
            onClick={() => { setOpen(false); setConfirmDelete(true); }}
            className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
          >
            <Trash2 size={14} />
            {t("book.deleteBook")}
          </button>
        </div>
      )}
      <ConfirmDialog
        open={confirmDelete}
        title={t("book.deleteBook")}
        message={`${t("book.confirmDelete")}\n\n"${bookTitle}"`}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

export function Dashboard({ nav, sse, theme, t }: { nav: Nav; sse: { messages: ReadonlyArray<SSEMessage> }; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { ensureModelFor, blockedResult, closeGate } = useAiModelGate();
  const { data, loading, error, refetch } = useApi<{ books: ReadonlyArray<BookSummary> }>("/books");
  const { data: onboardingData, refetch: refetchOnboarding } = useApi<{ status: GettingStartedStatus }>("/onboarding/status");
  const [gettingStartedDismissedThisSession, setGettingStartedDismissedThisSession] = useState(false);
  const writingBooks = useMemo(() => deriveActiveBookIds(sse.messages), [sse.messages]);

  const logEvents = sse.messages.filter((m) => m.event === "log").slice(-8);
  const progressEvent = sse.messages.filter((m) => m.event === "llm:progress").slice(-1)[0];

  useEffect(() => {
    const recent = sse.messages.at(-1);
    if (!recent) return;
    if (shouldRefetchBookCollections(recent)) {
      refetch();
    }
  }, [refetch, sse.messages]);

  const firstBookId = data?.books[0]?.id;
  const updateGettingStartedDismissed = (dismissed: boolean) => {
    setGettingStartedDismissedThisSession(dismissed);
    void fetchJson("/onboarding/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dismissedGettingStarted: dismissed }),
    }).then(() => refetchOnboarding()).catch(() => undefined);
  };

  const openFirstBookOrCreate = () => {
    if (firstBookId) {
      nav.toBook(firstBookId);
    } else {
      nav.toBookCreate();
    }
  };

  const requestWriteNext = (bookId?: string) => {
    if (!bookId) {
      nav.toBookCreate();
      return;
    }
    if (!ensureModelFor("ai-writing")) {
      return;
    }
    void postApi(`/books/${bookId}/write-next`);
  };

  const onboardingStatus = onboardingData?.status;
  const showGettingStarted = Boolean(onboardingStatus && !onboardingStatus.dismissedGettingStarted && !gettingStartedDismissedThisSession);
  const showGettingStartedReopen = Boolean(onboardingStatus && (onboardingStatus.dismissedGettingStarted || gettingStartedDismissedThisSession));
  const gettingStartedNode = onboardingStatus ? (
    showGettingStarted ? (
      <GettingStartedChecklist
        status={onboardingStatus}
        onConfigureModel={() => nav.toAdmin?.("providers")}
        onCreateBook={nav.toBookCreate}
        onOpenJingwei={() => {
          if (firstBookId && nav.toBible) {
            nav.toBible(firstBookId);
          } else {
            openFirstBookOrCreate();
          }
        }}
        onCreateChapter={openFirstBookOrCreate}
        onTryAiWriting={() => {
          requestWriteNext(firstBookId);
        }}
        onTryAiTasteScan={() => {
          if (firstBookId && nav.toDetect) {
            nav.toDetect(firstBookId);
          } else {
            openFirstBookOrCreate();
          }
        }}
        onOpenWorkbenchIntro={() => nav.toWorkflow?.("advanced")}
        onDismiss={() => updateGettingStartedDismissed(true)}
      />
    ) : showGettingStartedReopen ? (
      <div className="flex justify-end">
        <button
          type="button"
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={() => updateGettingStartedDismissed(false)}
        >
          重新打开任务清单
        </button>
      </div>
    ) : null
  ) : null;

  if (loading) {
    return (
      <PageScaffold title={t("dash.title")} description={t("dash.subtitle")}>
        <div className="flex min-h-[240px] items-center justify-center text-sm text-muted-foreground">
          <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
          <span className="ml-3">Gathering manuscripts...</span>
        </div>
      </PageScaffold>
    );
  }

  if (error) {
    return (
      <PageScaffold title={t("dash.title")} description={t("dash.subtitle")}>
        <PageEmptyState
          title="Failed to load library"
          description={error}
          icon={AlertCircle}
        />
      </PageScaffold>
    );
  }

  if (!data?.books.length) {
    return (
      <PageScaffold title={t("dash.title")} description={t("dash.subtitle")}>
        <div className="space-y-6">
          {gettingStartedNode}
          <PageEmptyState
            title={t("dash.noBooks")}
            description={t("dash.createFirst")}
            icon={BookOpen}
            action={
              <button
                onClick={nav.toBookCreate}
                className="group flex items-center gap-2 rounded-xl bg-primary px-8 py-3.5 text-sm font-bold text-primary-foreground transition-all hover:scale-105 active:scale-95"
              >
                <Plus size={18} />
                {t("nav.newBook")}
              </button>
            }
          />
        </div>
      </PageScaffold>
    );
  }

  return (
    <PageScaffold
      title={t("dash.title")}
      description={t("dash.subtitle")}
      actions={
        <button
          onClick={nav.toBookCreate}
          className="group flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground transition-all hover:scale-105 active:scale-95"
        >
          <Plus size={16} />
          {t("nav.newBook")}
        </button>
      }
    >
      <div className="space-y-12">
        {gettingStartedNode}
        <div className="grid gap-6">
          {data.books.map((book, index) => {
            const isWriting = writingBooks.has(book.id);
            const staggerClass = `stagger-${Math.min(index + 1, 5)}`;
            return (
              <div
                key={book.id}
                className={`paper-sheet group relative rounded-2xl overflow-hidden fade-in ${staggerClass}`}
              >
                <div className="p-8 flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="p-2 rounded-lg bg-primary/5 text-primary">
                        <BookOpen size={20} />
                      </div>
                      <button
                        onClick={() => nav.toBook(book.id)}
                        className="font-serif text-2xl hover:text-primary transition-all text-left truncate block font-medium hover:underline underline-offset-4 decoration-primary/30"
                      >
                        {book.title}
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-y-2 gap-x-4 text-[13px] text-muted-foreground font-medium">
                      <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-secondary/50">
                        <span className="uppercase tracking-wider">{book.genre}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Clock size={14} />
                        <span>{book.chaptersWritten} {t("dash.chapters")}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className={`w-2 h-2 rounded-full ${
                          book.status === "active" ? "bg-emerald-500" :
                          book.status === "paused" ? "bg-amber-500" :
                          "bg-muted-foreground"
                        }`} />
                        <span>{
                          book.status === "active" ? t("book.statusActive") :
                          book.status === "paused" ? t("book.statusPaused") :
                          book.status === "outlining" ? t("book.statusOutlining") :
                          book.status === "completed" ? t("book.statusCompleted") :
                          book.status === "dropped" ? t("book.statusDropped") :
                          book.status
                        }</span>
                      </div>
                      {book.language === "en" && (
                        <span className="px-1.5 py-0.5 rounded border border-primary/20 text-primary text-[10px] font-bold">EN</span>
                      )}
                      {book.fanficMode && (
                        <span className="flex items-center gap-1 text-purple-500">
                          <Zap size={12} />
                          <span className="italic">{book.fanficMode}</span>
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 ml-6">
                    <button
                      onClick={() => requestWriteNext(book.id)}
                      disabled={isWriting}
                      className={`flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold transition-all shadow-sm ${
                        isWriting
                          ? "bg-primary/20 text-primary cursor-wait animate-pulse"
                          : "bg-secondary text-foreground hover:bg-primary hover:text-primary-foreground hover:shadow-lg hover:shadow-primary/20 hover:scale-105 active:scale-95"
                      }`}
                    >
                      {isWriting ? (
                        <>
                          <div className="w-4 h-4 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
                          {t("dash.writing")}
                        </>
                      ) : (
                        <>
                          <Zap size={16} />
                          {t("dash.writeNext")}
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => nav.toAnalytics(book.id)}
                      className="p-3 rounded-xl bg-secondary text-muted-foreground hover:text-primary hover:bg-primary/10 hover:border-primary/30 hover:shadow-md hover:scale-105 active:scale-95 transition-all border border-border/50 shadow-sm"
                      title={t("dash.stats")}
                    >
                      <BarChart2 size={18} />
                    </button>
                    <BookMenu
                      bookId={book.id}
                      bookTitle={book.title}
                      nav={nav}
                      t={t}
                      onDelete={() => refetch()}
                    />
                  </div>
                </div>

                {/* Enhanced progress indicator */}
                {isWriting && (
                  <div className="absolute bottom-0 left-0 right-0 h-1 bg-secondary overflow-hidden">
                    <div className="h-full bg-primary w-1/3 animate-[progress_2s_ease-in-out_infinite]" />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Daily Writing Target Panel */}
        <DailyTargetPanel theme={theme} />

        {/* Modern writing progress panel */}
        {writingBooks.size > 0 && logEvents.length > 0 && (
          <div className="glass-panel rounded-2xl p-8 border-primary/20 bg-primary/[0.02] shadow-2xl shadow-primary/5 fade-in">
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-primary p-2 text-primary-foreground shadow-lg shadow-primary/20">
                  <Flame size={18} className="animate-pulse" />
                </div>
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-widest text-primary"> Manuscript Foundry</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">Real-time LLM generation tracking</p>
                </div>
              </div>
              {progressEvent && (
                <div className="flex items-center gap-4 rounded-full border border-primary/20 bg-primary/10 px-4 py-2 text-xs font-bold text-primary">
                  <div className="flex items-center gap-2">
                    <Clock size={12} />
                    <span>{Math.round(((progressEvent.data as { elapsedMs?: number })?.elapsedMs ?? 0) / 1000)}s</span>
                  </div>
                  <div className="h-3 w-px bg-primary/20" />
                  <div className="flex items-center gap-2">
                    <Zap size={12} />
                    <span>{((progressEvent.data as { totalChars?: number })?.totalChars ?? 0).toLocaleString()} Chars</span>
                  </div>
                </div>
              )}
            </div>

            <div className="max-h-[200px] space-y-2 overflow-y-auto rounded-xl border border-border/50 bg-black/5 p-6 font-mono text-xs shadow-sm dark:bg-black/20 scrollbar-thin">
              {logEvents.map((msg, i) => {
                const d = msg.data as { tag?: string; message?: string };
                return (
                  <div key={i} className="flex gap-3 leading-relaxed animate-in fade-in slide-in-from-left-2 duration-300">
                    <span className="shrink-0 font-bold text-primary/60">[{d.tag}]</span>
                    <span className="text-muted-foreground">{d.message}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <style>{`
          @keyframes progress {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(300%); }
          }
        `}</style>
        <AiModelRequiredDialog
          open={Boolean(blockedResult)}
          message={blockedResult?.message ?? ""}
          onCancel={closeGate}
          onConfigureModel={() => {
            closeGate();
            nav.toAdmin?.("providers");
          }}
        />
      </div>
    </PageScaffold>
  );
}

// --- Daily Writing Target Panel ---


interface DailyStats {
  readonly todayWords: number;
  readonly todayChapters: number;
  readonly trend: ReadonlyArray<{ date: string; words: number }>;
}

const DEFAULT_DAILY_TARGET = 6000;
const STORAGE_KEY = "novelfork-daily-target";

function DailyTargetPanel({ theme }: { theme: Theme }) {
  const c = useColors(theme);
  const { data, loading } = useApi<DailyStats>("/daily-stats");
  const [target, setTarget] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_DAILY_TARGET;
  });
  const [editing, setEditing] = useState(false);

  if (loading || !data) return null;

  const pct = target > 0 ? Math.min(Math.round((data.todayWords / target) * 100), 100) : 0;
  const isComplete = data.todayWords >= target;
  const maxTrend = Math.max(...data.trend.map((d) => d.words), 1);

  const handleTargetChange = (val: string) => {
    const n = parseInt(val, 10);
    if (Number.isFinite(n) && n > 0) {
      setTarget(n);
      localStorage.setItem(STORAGE_KEY, String(n));
    }
  };

  return (
    <div className={`rounded-2xl border ${c.cardStatic} p-6 fade-in`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className={`p-1.5 rounded-lg ${isComplete ? "bg-emerald-500/10 text-emerald-500" : "bg-primary/10 text-primary"}`}>
            <Target size={16} />
          </div>
          <span className="text-sm font-bold">日更目标</span>
        </div>
        {editing ? (
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1000}
              max={20000}
              step={1000}
              value={target}
              onChange={(e) => handleTargetChange(e.target.value)}
              className={`w-24 px-2 py-1 rounded text-xs text-right ${c.input}`}
              autoFocus
              onBlur={() => setEditing(false)}
              onKeyDown={(e) => e.key === "Enter" && setEditing(false)}
            />
            <span className="text-[10px] text-muted-foreground">字</span>
          </div>
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-muted-foreground hover:text-primary transition-colors"
          >
            {target.toLocaleString()} 字/天
          </button>
        )}
      </div>

      {/* Progress bar */}
      <div className="mb-3">
        <div className="flex items-baseline justify-between mb-1.5">
          <span className={`text-2xl font-bold tabular-nums ${isComplete ? "text-emerald-500" : "text-foreground"}`}>
            {data.todayWords.toLocaleString()}
          </span>
          <span className="text-xs text-muted-foreground">
            {pct}% · {data.todayChapters} 章
          </span>
        </div>
        <div className="h-2 rounded-full bg-secondary overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${isComplete ? "bg-emerald-500" : "bg-primary"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* 7-day trend */}
      <div className="flex items-center gap-1.5 mt-4">
        <TrendingUp size={12} className="text-muted-foreground shrink-0" />
        <span className="text-[10px] text-muted-foreground mr-1">7日</span>
        <div className="flex items-end gap-px flex-1" style={{ height: 28 }}>
          {data.trend.map((d) => (
            <div
              key={d.date}
              className="flex-1 group relative"
              style={{ height: 28 }}
            >
              <div
                className={`w-full rounded-t-sm absolute bottom-0 ${
                  d.words >= target ? "bg-emerald-500/60" : "bg-primary/30"
                }`}
                style={{ height: Math.max(2, (d.words / maxTrend) * 28) }}
              />
              <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:block
                bg-popover border border-border rounded px-1.5 py-0.5 text-[9px] text-foreground
                shadow-sm whitespace-nowrap pointer-events-none z-10">
                {d.date.slice(5)}: {d.words.toLocaleString()}字
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
