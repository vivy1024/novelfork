import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Eye, Trash2 } from "lucide-react";

import { ContextPreviewModal } from "../components/Bible/ContextPreviewModal";
import { EntryForm } from "../components/Bible/EntryForm";
import { QuestionnaireWizard, type QuestionnaireTemplateView } from "../components/Bible/QuestionnaireWizard";
import { FilterReportTab } from "../components/filter/FilterReportTab";
import { JingweiSectionManager } from "../components/jingwei/JingweiSectionManager";
import { JingweiSectionTabs } from "../components/jingwei/JingweiSectionTabs";
import type { JingweiSectionView } from "../components/jingwei/types";
import { BIBLE_TABS, responseKeyForTab, titleOfEntry, type BibleContextPreview, type BibleEntry, type BibleTab } from "../components/Bible/types";
import { PageEmptyState } from "../components/layout/PageEmptyState";
import { PageScaffold } from "../components/layout/PageScaffold";
import { fetchJson, postApi, useApi } from "../hooks/use-api";
import { notify } from "../lib/notify";

interface BibleListResponse {
  characters?: BibleEntry[];
  events?: BibleEntry[];
  settings?: BibleEntry[];
  chapterSummaries?: BibleEntry[];
  conflicts?: BibleEntry[];
  worldModel?: BibleEntry | null;
  premise?: BibleEntry | null;
  characterArcs?: BibleEntry[];
  templates?: BibleEntry[];
  coreShifts?: BibleEntry[];
  reports?: Array<BibleEntry & { chapterNumber: number; aiTasteScore: number; level: "clean" | "mild" | "moderate" | "severe"; details: { pgiUsed?: boolean; hits?: Array<{ ruleId: string; name: string; severity: "low" | "medium" | "high"; spans: Array<{ start: number; end: number; matched: string }>; suggestion?: string }> } }>;
}

interface BookData {
  book: {
    id: string;
    title: string;
  };
  nextChapter: number;
}

interface JingweiSectionsResponse {
  sections: JingweiSectionView[];
}

function bibleTabForSection(section: JingweiSectionView): BibleTab | null {
  switch (section.builtinKind ?? section.key) {
    case "people":
      return "characters";
    case "events":
      return "events";
    case "settings":
      return "settings";
    case "chapter-summary":
      return "chapter-summaries";
    default:
      return null;
  }
}

export function BibleView({ bookId, nav }: { bookId: string; nav: { toDashboard: () => void; toBook: (bookId: string) => void } }) {
  const [activeTab, setActiveTab] = useState<BibleTab>("characters");
  const [bibleMode, setBibleMode] = useState<"static" | "dynamic">("dynamic");
  const [savingMode, setSavingMode] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<BibleContextPreview | null>(null);
  const [sceneText, setSceneText] = useState("");
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const { data: bookData } = useApi<BookData>(`/books/${bookId}`);
  const { data: sectionsData, loading: sectionsLoading, error: sectionsError, refetch: refetchSections } = useApi<JingweiSectionsResponse>(`/books/${bookId}/jingwei/sections`);
  const currentChapterDefault = bookData?.nextChapter ?? 1;
  const [currentChapter, setCurrentChapter] = useState(1);

  const endpoint = activeTab === "questionnaires"
    ? "/questionnaires"
    : activeTab === "core-shifts"
      ? `/books/${bookId}/core-shifts`
      : activeTab === "ai-filter"
        ? `/books/${bookId}/filter/report?groupByPgi=true`
        : `/books/${bookId}/bible/${activeTab}`;
  const { data, loading, error, refetch } = useApi<BibleListResponse>(endpoint);

  useEffect(() => {
    const key = `novelfork:open-questionnaire:${bookId}`;
    if (typeof window !== "undefined" && window.sessionStorage.getItem(key)) {
      window.sessionStorage.removeItem(key);
      setActiveTab("questionnaires");
    }
  }, [bookId]);

  const entries = useMemo(() => {
    const value = data?.[responseKeyForTab(activeTab)];
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
  }, [activeTab, data]);

  const jingweiSections = useMemo(() => sectionsData?.sections ?? [], [sectionsData]);
  const visibleJingweiSections = useMemo(
    () => jingweiSections.filter((section) => section.enabled && section.showInSidebar).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)),
    [jingweiSections],
  );
  const activeSection = visibleJingweiSections.find((section) => section.id === activeSectionId) ?? visibleJingweiSections[0] ?? null;
  const activeSectionTab = activeSection ? bibleTabForSection(activeSection) : null;
  const customSectionSelected = Boolean(activeSection && !activeSectionTab);
  const visibleEntries = customSectionSelected ? [] : entries;
  const activeSectionTitle = activeSection?.name ?? BIBLE_TABS.find((tab) => tab.id === activeTab)?.label;

  useEffect(() => {
    if (!activeSection && activeSectionId !== null) {
      setActiveSectionId(null);
      return;
    }
    if (!activeSection || activeSectionId) return;
    setActiveSectionId(activeSection.id);
    const mappedTab = bibleTabForSection(activeSection);
    if (mappedTab) setActiveTab(mappedTab);
  }, [activeSection, activeSectionId]);

  const createEntry = async (payload: Record<string, unknown>) => {
    try {
      if (activeTab === "world-model" || activeTab === "premise") {
        await fetchJson(endpoint, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        await postApi(endpoint, payload);
      }
      await refetch();
      notify.success("故事经纬条目已保存");
    } catch (error) {
      notify.error("保存失败", { description: error instanceof Error ? error.message : undefined });
      throw error;
    }
  };

  const deleteEntry = async (entryId: string) => {
    try {
      await fetchJson(`${endpoint}/${entryId}`, { method: "DELETE" });
      await refetch();
      notify.success("故事经纬条目已删除");
    } catch (error) {
      notify.error("删除失败", { description: error instanceof Error ? error.message : undefined });
    }
  };

  const updateCoreShift = async (entryId: string, action: "accept" | "reject") => {
    try {
      await postApi(`/books/${bookId}/core-shifts/${entryId}/${action}`, {});
      await refetch();
      notify.success(action === "accept" ? "变更已接受" : "变更已拒绝");
    } catch (error) {
      notify.error("变更操作失败", { description: error instanceof Error ? error.message : undefined });
    }
  };

  const saveBookMode = async () => {
    setSavingMode(true);
    try {
      await fetchJson(`/books/${bookId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bibleMode, currentChapter }),
      });
      notify.success("经纬模式已更新");
    } catch (error) {
      notify.error("模式更新失败", { description: error instanceof Error ? error.message : undefined });
    } finally {
      setSavingMode(false);
    }
  };

  const runPreview = async () => {
    setPreviewLoading(true);
    try {
      const result = await postApi<{ context: BibleContextPreview }>(`/books/${bookId}/bible/preview-context`, {
        currentChapter,
        sceneText,
      });
      setPreview(result.context);
    } catch (error) {
      notify.error("预览失败", { description: error instanceof Error ? error.message : undefined });
    } finally {
      setPreviewLoading(false);
    }
  };

  return (
    <PageScaffold title="故事经纬" description="结构化管理人物、事件、设定与章节摘要，并预览将注入 AI 写作的上下文。">
      <div className="space-y-6 fade-in">
        <nav className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
          <button onClick={nav.toDashboard} className="flex items-center gap-1 hover:text-primary">
            <ChevronLeft size={14} />书籍
          </button>
          <span>/</span>
          <button onClick={() => nav.toBook(bookId)} className="hover:text-primary">{bookData?.book.title ?? bookId}</button>
          <span>/</span>
          <span className="text-foreground">故事经纬</span>
        </nav>

        <section className="rounded-2xl border border-border/40 bg-card/70 p-5 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="font-serif text-2xl font-semibold">故事经纬设置</h2>
              <p className="text-sm text-muted-foreground">static 只注入全局可见条目；dynamic 会额外按 sceneText 命中 tracked 并展开 nested。</p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
                经纬模式
                <select value={bibleMode} onChange={(event) => setBibleMode(event.target.value as "static" | "dynamic")} className="rounded-lg border border-border/50 bg-background px-3 py-2 text-sm text-foreground">
                  <option value="static">static</option>
                  <option value="dynamic">dynamic</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
                currentChapter
                <input type="number" value={currentChapter || currentChapterDefault} onChange={(event) => setCurrentChapter(Number(event.target.value))} className="w-32 rounded-lg border border-border/50 bg-background px-3 py-2 text-sm text-foreground" />
              </label>
              <button onClick={saveBookMode} disabled={savingMode} className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50">
                {savingMode ? "保存中..." : "保存模式"}
              </button>
              <JingweiSectionManager bookId={bookId} sections={jingweiSections} onRefresh={refetchSections} />
              <button onClick={() => { setPreviewOpen(true); void runPreview(); }} className="inline-flex items-center gap-2 rounded-xl border border-border/60 bg-secondary/50 px-4 py-2 text-sm font-bold text-foreground hover:bg-secondary">
                <Eye size={15} />预览 AI 上下文
              </button>
            </div>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <JingweiSectionTabs
            sections={jingweiSections}
            activeSectionId={activeSection?.id ?? null}
            activeLegacyTab={activeTab}
            legacyTabs={BIBLE_TABS}
            onSelectSection={(section) => {
              setActiveSectionId(section.id);
              const mappedTab = bibleTabForSection(section);
              if (mappedTab) setActiveTab(mappedTab);
            }}
            onSelectLegacyTab={setActiveTab}
          />

          <main className="space-y-6">
            {error && <PageEmptyState title="加载故事经纬失败" description={error} />}
            {sectionsError && <PageEmptyState title="加载经纬栏目失败" description={sectionsError} />}
            <section className="rounded-2xl border border-border/40 bg-card/70 p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="font-serif text-2xl font-semibold">{activeSectionTitle}</h2>
                  <p className="text-sm text-muted-foreground">当前 {visibleEntries.length} 条。点击删除会执行软删除。</p>
                </div>
                {(loading || sectionsLoading) && <div className="text-xs text-muted-foreground">加载中...</div>}
              </div>
              {activeTab === "questionnaires" && visibleEntries[0] ? (
                <QuestionnaireWizard
                  bookId={bookId}
                  template={visibleEntries[0] as QuestionnaireTemplateView}
                  onDone={() => {
                    notify.success("问卷状态已保存");
                    void refetch();
                  }}
                />
              ) : null}
              {activeTab === "ai-filter" ? <FilterReportTab reports={data?.reports ?? []} /> : null}
              <div className="grid gap-3 md:grid-cols-2">
                {visibleEntries.map((entry) => (
                  <article key={entry.id} className="rounded-xl border border-border/50 bg-background/70 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold">{titleOfEntry(entry)}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{entry.id}</div>
                      </div>
                      {activeTab === "core-shifts" && entry.status === "proposed" ? (
                        <div className="flex gap-2">
                          <button onClick={() => void updateCoreShift(entry.id, "accept")} className="rounded-lg bg-primary/10 px-2 py-1 text-xs font-bold text-primary">accept</button>
                          <button onClick={() => void updateCoreShift(entry.id, "reject")} className="rounded-lg bg-destructive/10 px-2 py-1 text-xs font-bold text-destructive">reject</button>
                        </div>
                      ) : activeTab !== "world-model" && activeTab !== "premise" && activeTab !== "questionnaires" && activeTab !== "core-shifts" && (
                        <button onClick={() => deleteEntry(entry.id)} className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="删除">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                    <p className="mt-3 line-clamp-3 text-sm leading-6 text-muted-foreground">{entry.summary ?? entry.content ?? entry.stakes ?? entry.currentPosition ?? entry.uniqueHook ?? "（无摘要）"}</p>
                    {entry.stalled && <div className="mt-3 rounded-lg bg-orange-500/10 px-2 py-1 text-xs font-bold text-orange-600">stalled-conflict</div>}
                    {entry.affectedChapters && entry.affectedChapters.length > 0 && <div className="mt-3 rounded-lg bg-orange-500/10 px-2 py-1 text-xs font-bold text-orange-600">需复核章节：{entry.affectedChapters.join("、")}</div>}
                    {entry.status && <div className="mt-3 rounded-lg bg-muted/50 px-2 py-1 text-xs text-muted-foreground">status: {entry.status}</div>}
                    {entry.visibilityRule && <div className="mt-3 rounded-lg bg-muted/50 px-2 py-1 text-xs text-muted-foreground">visibility: {entry.visibilityRule.type}</div>}
                  </article>
                ))}
              </div>
            </section>

            {customSectionSelected ? (
              <PageEmptyState title="自定义栏目条目表单待接入" description="栏目结构已经可管理；自定义栏目条目列表与动态字段表单将在下一步任务接入。" />
            ) : activeTab !== "questionnaires" && activeTab !== "ai-filter" && <EntryForm tab={activeTab} entries={visibleEntries} onSubmit={createEntry} />}
          </main>
        </div>
      </div>

      <ContextPreviewModal
        open={previewOpen}
        preview={preview}
        currentChapter={currentChapter || currentChapterDefault}
        sceneText={sceneText}
        loading={previewLoading}
        onCurrentChapterChange={setCurrentChapter}
        onSceneTextChange={setSceneText}
        onPreview={runPreview}
        onClose={() => setPreviewOpen(false)}
      />
    </PageScaffold>
  );
}
