import { useState, useRef, useEffect } from "react";
import { fetchJson, useApi, postApi } from "../hooks/use-api";
import { useAutosave } from "../hooks/use-autosave";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import { InkEditor, getMarkdown } from "../components/InkEditor";
import { ContextPanel } from "../components/ContextPanel";
import { HistoryPanel } from "../components/HistoryPanel";
import { OutlinePanel } from "../components/OutlinePanel";
import { DiffPanel } from "../components/DiffPanel";
import {
  ChevronLeft,
  Check,
  X,
  List,
  RotateCcw,
  BookOpen,
  CheckCircle2,
  XCircle,
  Hash,
  Type,
  Clock,
  Pencil,
  Save,
  Eye,
  GitCompare,
  Layers,
  History,
  BookmarkPlus,
} from "lucide-react";

interface ChapterData {
  readonly chapterNumber: number;
  readonly filename: string;
  readonly content: string;
}

interface Nav {
  toBook: (id: string) => void;
  toDashboard: () => void;
  toDiff: (bookId: string, chapterNumber: number) => void;
}

export function ChapterReader({ bookId, chapterNumber, nav, theme, t }: {
  bookId: string;
  chapterNumber: number;
  nav: Nav;
  theme: Theme;
  t: TFunction;
}) {
  const c = useColors(theme);
  const { data, loading, error, refetch } = useApi<ChapterData>(
    `/books/${bookId}/chapters/${chapterNumber}`,
  );
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [manualSaving, setManualSaving] = useState(false);
  const [contextPanelOpen, setContextPanelOpen] = useState(false);
  const [historyPanelOpen, setHistoryPanelOpen] = useState(false);
  const [outlinePanelOpen, setOutlinePanelOpen] = useState(false);
  const [diffPanelData, setDiffPanelData] = useState<{ originalText: string; newText: string; mode: string; snapshotId: number } | null>(null);
  const [showSnapshotDialog, setShowSnapshotDialog] = useState(false);
  const [snapshotDescription, setSnapshotDescription] = useState("");
  const editorRef = useRef<any>(null);

  const autosave = useAutosave({
    bookId,
    chapterNumber,
    content: editContent,
    enabled: editing,
    onSave: async (content) => {
      await fetchJson(`/books/${bookId}/chapters/${chapterNumber}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
    },
  });

  const handleStartEdit = () => {
    if (!data) return;
    setEditContent(data.content);
    setEditing(true);
  };

  const handleCancelEdit = () => {
    setEditing(false);
    setEditContent("");
  };

  const handleSave = async () => {
    setManualSaving(true);
    try {
      await autosave.flush();
      setEditing(false);
      refetch();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setManualSaving(false);
    }
  };

  const handleAIAction = async (params: { text: string; surrounding: string; mode: string }): Promise<string> => {
    const response = await fetchJson<{ result: string; mode: string }>("/api/ai/transform", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    return response.result;
  };

  const handleSnapshotSelect = async (snapshotId: number) => {
    try {
      // Get current editor content
      const currentContent = editorRef.current ? getMarkdown(editorRef.current) : editContent;

      // Fetch snapshot content
      const snapshotData = await fetchJson<{ content: string }>(`/api/snapshots/${snapshotId}/content`);

      // Open DiffPanel with comparison
      setDiffPanelData({
        originalText: snapshotData.content,
        newText: currentContent,
        mode: "restore",
        snapshotId,
      });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to load snapshot");
    }
  };

  const handleRestoreSnapshot = async () => {
    if (!diffPanelData) return;

    try {
      // Call restore API
      await postApi(`/api/snapshots/${diffPanelData.snapshotId}/restore`);

      // Update editor content with snapshot content
      setEditContent(diffPanelData.originalText);

      // Close diff panel and refresh
      setDiffPanelData(null);
      refetch();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to restore snapshot");
    }
  };

  const handleSaveSnapshot = async () => {
    try {
      // Get current editor content
      const currentContent = editorRef.current ? getMarkdown(editorRef.current) : editContent;

      // Get chapter ID
      const chapterData = await fetchJson<{ id: number }>(`/books/${bookId}/chapters/${chapterNumber}`);

      // Create snapshot
      await fetchJson("/api/snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chapterId: chapterData.id,
          content: currentContent,
          triggerType: "manual",
          description: snapshotDescription || "手动保存",
        }),
      });

      // Close dialog and reset
      setShowSnapshotDialog(false);
      setSnapshotDescription("");
      alert("快照已保存");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to save snapshot");
    }
  };

  const isSaving = manualSaving || autosave.saving;

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-32 space-y-4">
      <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
      <span className="text-sm text-muted-foreground">{t("reader.openingManuscript")}</span>
    </div>
  );

  if (error) return <div className="text-destructive p-8 bg-destructive/5 rounded-xl border border-destructive/20">Error: {error}</div>;
  if (!data) return null;

  // Split markdown content into title and body
  const lines = data.content.split("\n");
  const titleLine = lines.find((l) => l.startsWith("# "));
  const title = titleLine?.replace(/^#\s*/, "") ?? `Chapter ${chapterNumber}`;
  const body = lines
    .filter((l) => l !== titleLine)
    .join("\n")
    .trim();

  const handleApprove = async () => {
    await postApi(`/books/${bookId}/chapters/${chapterNumber}/approve`);
    nav.toBook(bookId);
  };

  const handleReject = async () => {
    await postApi(`/books/${bookId}/chapters/${chapterNumber}/reject`);
    nav.toBook(bookId);
  };

  // Keyboard shortcut: Ctrl+S / Cmd+S for manual snapshot
  useEffect(() => {
    if (!editing) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        setShowSnapshotDialog(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editing]);

  return (
    <div className="max-w-4xl mx-auto space-y-10 fade-in">
      {/* Navigation & Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <nav className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
          <button
            onClick={nav.toDashboard}
            className="hover:text-primary transition-colors flex items-center gap-1"
          >
            {t("bread.books")}
          </button>
          <span className="text-border">/</span>
          <button
            onClick={() => nav.toBook(bookId)}
            className="hover:text-primary transition-colors truncate max-w-[120px]"
          >
            {bookId}
          </button>
          <span className="text-border">/</span>
          <span className="text-foreground flex items-center gap-1">
            <Hash size={12} />
            {chapterNumber}
          </span>
        </nav>

        <div className="flex gap-2">
          <button
            onClick={() => nav.toBook(bookId)}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-secondary text-muted-foreground rounded-xl hover:text-foreground hover:bg-secondary/80 transition-all border border-border/50"
          >
            <List size={14} />
            {t("reader.backToList")}
          </button>

          <button
            onClick={() => nav.toDiff(bookId, chapterNumber)}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-secondary text-muted-foreground rounded-xl hover:text-primary hover:bg-primary/10 transition-all border border-border/50"
          >
            <GitCompare size={14} />
            {t("diff.title")}
          </button>

          <button
            onClick={() => {
              setContextPanelOpen(false);
              setHistoryPanelOpen(false);
              setOutlinePanelOpen(!outlinePanelOpen);
            }}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-secondary text-muted-foreground rounded-xl hover:text-primary hover:bg-primary/10 transition-all border border-border/50"
          >
            <BookOpen size={14} />
            大纲
          </button>

          <button
            onClick={() => {
              setContextPanelOpen(false);
              setOutlinePanelOpen(false);
              setHistoryPanelOpen(!historyPanelOpen);
            }}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-secondary text-muted-foreground rounded-xl hover:text-primary hover:bg-primary/10 transition-all border border-border/50"
          >
            <History size={14} />
            历史
          </button>

          <button
            onClick={() => {
              setHistoryPanelOpen(false);
              setOutlinePanelOpen(false);
              setContextPanelOpen(!contextPanelOpen);
            }}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-secondary text-muted-foreground rounded-xl hover:text-primary hover:bg-primary/10 transition-all border border-border/50"
          >
            <Layers size={14} />
            上下文
          </button>

          {editing && (
            <button
              onClick={() => setShowSnapshotDialog(true)}
              className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-blue-500/10 text-blue-600 rounded-xl hover:bg-blue-500 hover:text-white transition-all border border-blue-500/20"
            >
              <BookmarkPlus size={14} />
              保存快照
            </button>
          )}

          {/* Edit / Preview toggle */}
          {editing ? (
            <>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-primary text-primary-foreground rounded-xl hover:scale-105 active:scale-95 transition-all shadow-sm disabled:opacity-50"
              >
                {isSaving ? <div className="w-3.5 h-3.5 border-2 border-primary-foreground/20 border-t-primary-foreground rounded-full animate-spin" /> : <Save size={14} />}
                {isSaving ? t("book.saving") : t("book.save")}
              </button>
              <button
                onClick={handleCancelEdit}
                className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-secondary text-muted-foreground rounded-xl hover:text-foreground transition-all border border-border/50"
              >
                <Eye size={14} />
                {t("reader.preview")}
              </button>
            </>
          ) : (
            <button
              onClick={handleStartEdit}
              className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-secondary text-muted-foreground rounded-xl hover:text-primary hover:bg-primary/10 transition-all border border-border/50"
            >
              <Pencil size={14} />
              {t("reader.edit")}
            </button>
          )}

          <button
            onClick={handleApprove}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-emerald-500/10 text-emerald-600 rounded-xl hover:bg-emerald-500 hover:text-white transition-all border border-emerald-500/20 shadow-sm"
          >
            <CheckCircle2 size={14} />
            {t("reader.approve")}
          </button>
          <button
            onClick={handleReject}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-destructive/10 text-destructive rounded-xl hover:bg-destructive hover:text-white transition-all border border-destructive/20 shadow-sm"
          >
            <XCircle size={14} />
            {t("reader.reject")}
          </button>
        </div>
      </div>

      {/* Manuscript Sheet */}
      <div className="paper-sheet rounded-2xl p-8 md:p-16 lg:p-24 shadow-2xl shadow-primary/5 min-h-[80vh] relative overflow-hidden">
        {/* Physical Paper Details */}
        <div className="absolute top-0 left-8 w-px h-full bg-primary/5 hidden md:block" />
        <div className="absolute top-0 right-8 w-px h-full bg-primary/5 hidden md:block" />

        <header className="mb-16 text-center">
          <div className="flex items-center justify-center gap-2 text-muted-foreground/30 mb-8 select-none">
            <div className="h-px w-12 bg-border/40" />
            <BookOpen size={20} />
            <div className="h-px w-12 bg-border/40" />
          </div>
          <h1 className="text-4xl md:text-5xl font-serif font-medium italic text-foreground tracking-tight leading-tight">
            {title}
          </h1>
          <div className="mt-8 flex items-center justify-center gap-4 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60">
            <span>{t("reader.manuscriptPage")}</span>
            <span className="text-border">·</span>
            <span>{chapterNumber.toString().padStart(2, '0')}</span>
          </div>
        </header>

        {editing ? (
          <>
            <InkEditor
              ref={editorRef}
              initialContent={editContent}
              onChange={(md) => setEditContent(md)}
              editable={true}
              onAIAction={handleAIAction}
              bookId={bookId}
              chapterNumber={chapterNumber}
            />
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2">
              {autosave.saving
                ? "保存中..."
                : autosave.dirty
                  ? "未保存更改"
                  : autosave.lastSaved
                    ? `已保存 ${autosave.lastSaved.toLocaleTimeString()}`
                    : ""}
            </div>
          </>
        ) : (
          <InkEditor
            initialContent={data.content}
            editable={false}
          />
        )}

        <footer className="mt-24 pt-12 border-t border-border/20 flex flex-col items-center gap-6 text-center">
          <div className="flex items-center gap-4 text-xs font-medium text-muted-foreground">
             <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary/50">
               <Type size={14} className="text-primary/60" />
               <span>{body.length.toLocaleString()} {t("reader.characters")}</span>
             </div>
             <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary/50">
               <Clock size={14} className="text-primary/60" />
               <span>{Math.ceil(body.length / 500)} {t("reader.minRead")}</span>
             </div>
          </div>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground/40 font-bold">{t("reader.endOfChapter")}</p>
        </footer>
      </div>

      {/* Footer Navigation */}
      <div className="flex justify-between items-center py-8">
        {chapterNumber > 1 ? (
          <button
            onClick={() => nav.toBook(bookId)}
            className="flex items-center gap-2 text-sm font-bold text-muted-foreground hover:text-primary transition-all group"
          >
            <RotateCcw size={16} className="group-hover:-rotate-45 transition-transform" />
            {t("reader.chapterList")}
          </button>
        ) : (
          <div />
        )}
      </div>

      <ContextPanel
        bookId={bookId}
        chapterNumber={chapterNumber}
        visible={contextPanelOpen}
        onClose={() => setContextPanelOpen(false)}
      />

      <HistoryPanel
        bookId={bookId}
        chapterNumber={chapterNumber}
        visible={historyPanelOpen}
        onClose={() => setHistoryPanelOpen(false)}
        onSnapshotSelect={handleSnapshotSelect}
      />

      <OutlinePanel
        bookId={bookId}
        visible={outlinePanelOpen}
        onClose={() => setOutlinePanelOpen(false)}
      />

      {diffPanelData && (
        <DiffPanel
          originalText={diffPanelData.originalText}
          newText={diffPanelData.newText}
          mode={diffPanelData.mode}
          onAccept={handleRestoreSnapshot}
          onReject={() => setDiffPanelData(null)}
        />
      )}

      {showSnapshotDialog && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 animate-in fade-in duration-200">
          <div className="bg-background rounded-2xl border border-border shadow-2xl w-[400px] p-6 space-y-4 animate-in zoom-in-95 duration-200">
            <h3 className="text-lg font-bold text-foreground">保存快照</h3>
            <input
              type="text"
              value={snapshotDescription}
              onChange={(e) => setSnapshotDescription(e.target.value)}
              placeholder="输入快照描述（可选）"
              className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setShowSnapshotDialog(false);
                  setSnapshotDescription("");
                }}
                className="px-4 py-2 text-xs font-bold bg-secondary text-muted-foreground rounded-lg hover:text-foreground transition-all"
              >
                取消
              </button>
              <button
                onClick={handleSaveSnapshot}
                className="px-4 py-2 text-xs font-bold bg-primary text-primary-foreground rounded-lg hover:scale-105 active:scale-95 transition-all"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
