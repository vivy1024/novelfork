import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { createPortal } from "react-dom";
import {
  Activity,
  BookMarked,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Eye,
  FileText,
  FileUp,
  Folder,
  FolderOpen,
  Layers,
  Loader2,
  MessageSquare,
  PenLine,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { fetchJson as defaultFetch } from "@/hooks/use-api";
import type {
  ChapterSelection,
  DissectBuildInput,
  DissectChapterSummaryMetric,
  DissectMeta,
  DissectNode,
  DissectPreviewResult,
} from "../../engine/dissect-library/dissect-library";

interface LibraryTree {
  tree: DissectNode;
  referenceFiles: { path: string; title: string; bytes: number }[];
}

interface BookWorkspaceResponse {
  slug: string;
  meta: DissectMeta;
  hasStoredSource: boolean;
  chapters: readonly DissectChapterSummaryMetric[];
}

interface ChapterPairResponse {
  slug: string;
  chapterNumber: number;
  title: string;
  sourceText: string;
  analysisPath: string;
  analysisContent: string;
  metrics: {
    words: number;
    dialogueRatio: number;
    tension: number;
    rhythmScore: number;
    avgSentenceLength: number;
    hooks: readonly string[];
  } | null;
}

export interface DissectLibraryPanelProps {
  bookId: string;
  sidebarHost?: HTMLElement | null;
  fetchJson?: (path: string, init?: RequestInit) => Promise<unknown>;
  onSendToNarrator?: (message: string) => Promise<void> | void;
  onDirtyChange?: (title: string | null) => void;
}

type ImportSourceKind = "upload" | "workspace" | "paste";
type MainViewState =
  | { kind: "welcome" }
  | { kind: "overview"; slug: string }
  | { kind: "document"; slug: string | null; path: string; title: string }
  | { kind: "chapter"; slug: string; chapterNumber: number };

const CATEGORY_PRESETS = ["仙侠", "玄幻", "都市", "悬疑脑洞", "言情甜宠", "历史架空", "科幻末世", "轻小说"] as const;

export function nextDissectSelection(selection: ChapterSelection): ChapterSelection {
  const end =
    selection.preset === "first3"
      ? 3
      : selection.preset === "first5"
        ? 5
        : selection.preset === "first10"
          ? 10
          : selection.to ?? 0;
  return { preset: "range", from: end + 1, to: end + 10 };
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/u, "").trim();
}

function encodingLabel(enc?: string): string {
  if (enc === "gb18030") return "GB18030/GBK";
  if (enc === "utf-16le") return "UTF-16";
  if (enc === "epub") return "EPUB";
  if (enc === "docx") return "DOCX";
  if (enc === "utf-8") return "UTF-8";
  return "文本";
}

function TreeNode({
  node,
  selected,
  onSelect,
}: {
  node: DissectNode;
  selected?: string;
  onSelect: (node: DissectNode) => void;
}) {
  const [open, setOpen] = useState(node.title !== "卷摘要" && node.title !== "逐章拆解");
  const directory = node.kind === "directory";
  const Icon = directory ? Folder : FileText;
  return (
    <li className="min-w-0 list-none">
      <button
        type="button"
        aria-expanded={directory ? open : undefined}
        aria-current={selected === node.path ? "page" : undefined}
        title={directory ? node.title : `${node.title} · ${node.wordCount} 字`}
        className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted aria-[current=page]:bg-primary/10 aria-[current=page]:text-primary"
        onClick={() => (directory ? setOpen(!open) : onSelect(node))}
      >
        {directory ? open ? <ChevronDown className="size-3 shrink-0" /> : <ChevronRight className="size-3 shrink-0" /> : <span className="w-3 shrink-0" />}
        <Icon className="size-3.5 shrink-0" strokeWidth={1.65} />
        <span className="truncate">{node.title}</span>
      </button>
      {directory && open && (
        <ul className="ml-3 border-l border-border/50 pl-1">
          {node.children?.map((child) => (
            <TreeNode key={child.path} node={child} selected={selected} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </li>
  );
}

function DissectMarkdown({ content }: { content: string }) {
  const [limit, setLimit] = useState(500);
  const all = content.split("\n");
  const lines = all.slice(0, limit);
  const blocks: React.ReactNode[] = [];
  const inline = (text: string) =>
    text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) =>
      part.startsWith("**") ? (
        <strong key={index}>{part.slice(2, -2)}</strong>
      ) : part.startsWith("`") ? (
        <code key={index} className="rounded bg-muted px-1 font-mono text-sm">
          {part.slice(1, -1)}
        </code>
      ) : (
        part
      ),
    );
  for (let i = 0; i < lines.length; ) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (/^\|/.test(line) && /^\|[\s:|\-]+\|\s*$/.test(lines[i + 1] ?? "")) {
      const cells = (row: string) =>
        row
          .replace(/^\||\|\s*$/g, "")
          .split(/(?<!\\)\|/)
          .map((value) => value.trim().replace(/\\\|/g, "|"));
      const headers = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\|/.test(lines[i]!)) rows.push(cells(lines[i++]!));
      blocks.push(
        <div key={i} className="my-5 overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-left font-sans text-xs leading-relaxed">
            <thead className="bg-muted/50">
              <tr>
                {headers.map((value, j) => (
                  <th key={j} className="border-b border-border px-3 py-2 font-medium text-foreground">
                    {inline(value)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, j) => (
                <tr key={j} className="border-b border-border/50 last:border-0">
                  {row.map((value, k) => (
                    <td key={k} className="min-w-20 px-3 py-2.5 align-top">
                      {inline(value)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      blocks.push(
        level === 1 ? (
          <h1 key={i} className="mb-6 mt-1 font-serif text-xl font-semibold text-foreground">
            {inline(heading[2]!)}
          </h1>
        ) : level === 2 ? (
          <h2 key={i} className="mb-3 mt-6 border-b border-border/60 pb-1.5 font-serif text-base font-semibold text-foreground">
            {inline(heading[2]!)}
          </h2>
        ) : (
          <h3 key={i} className="mb-2 mt-4 font-serif text-sm font-semibold text-foreground">
            {inline(heading[2]!)}
          </h3>
        ),
      );
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) code.push(lines[i++]!);
      i++;
      blocks.push(
        <pre key={i} className="my-4 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
          {code.join("\n")}
        </pre>,
      );
      continue;
    }
    if (line.startsWith(">")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i]!.startsWith(">")) quote.push(lines[i++]!.replace(/^>\s?/, ""));
      blocks.push(
        <blockquote key={i} className="my-4 rounded-r-md border-l-2 border-primary/40 bg-muted/30 py-2 pl-3.5 pr-3 text-xs leading-relaxed text-muted-foreground">
          {inline(quote.join("\n"))}
        </blockquote>,
      );
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i]!)) {
        items.push(lines[i++]!.replace(/^[-*]\s+/, ""));
      }
      blocks.push(
        <ul key={i} className="my-3 space-y-1.5 pl-4 text-sm leading-relaxed">
          {items.map((item, idx) => (
            <li key={idx} className="list-disc text-foreground/90">
              {inline(item)}
            </li>
          ))}
        </ul>,
      );
      continue;
    }
    const paragraph: string[] = [line];
    i++;
    while (i < lines.length && lines[i]!.trim() && !/^(?:#{1,6}\s|\||>|```|[-*]\s)/.test(lines[i]!)) {
      paragraph.push(lines[i++]!);
    }
    blocks.push(
      <p key={i} className="my-3 whitespace-pre-wrap font-serif text-sm leading-loose text-foreground/95">
        {inline(paragraph.join("\n"))}
      </p>,
    );
  }
  return (
    <article aria-label="拆书报告预览" className="h-full overflow-auto bg-card px-6 py-6 text-foreground">
      <div className="mx-auto max-w-3xl">
        {blocks}
        {all.length > limit && (
          <Button variant="outline" size="sm" onClick={() => setLimit(limit + 500)}>
            继续阅读后 500 行
          </Button>
        )}
      </div>
    </article>
  );
}

/** 张力/对白节奏柱状条：严格使用主题令牌（var(--primary)/bg-primary/bg-muted），不写死色值。 */
function DissectRhythmChart({
  chapters,
  windowStart,
  onWindowStartChange,
  onSelectChapter,
}: {
  chapters: readonly DissectChapterSummaryMetric[];
  windowStart: number;
  onWindowStartChange: (updater: (prev: number) => number) => void;
  onSelectChapter: (chapterNumber: number) => void;
}) {
  const sample = useMemo(() => {
    if (chapters.length === 0) return [];
    const size = 80;
    const maxStart = Math.max(0, chapters.length - size);
    const start = Math.max(0, Math.min(windowStart, maxStart));
    return chapters.slice(start, start + size);
  }, [chapters, windowStart]);

  if (sample.length === 0) return null;
  const totalCount = chapters.length;
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <Activity className="size-3.5 text-primary" />
            <span>
              篇章张力与钩子曲线（第 {sample[0]!.number}–{sample.at(-1)!.number} 章 / 共 {totalCount} 章，点击柱条直达精读）
            </span>
          </h4>
          <p className="mt-0.5 text-2xs text-muted-foreground">
            柱高代表章节张力分（0–100），顶部圆点标记章末检测到悬念钩子，绿色角标为已完成模型精拆。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
          {totalCount > 80 && (
            <div className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-1.5 py-0.5">
              <button
                type="button"
                disabled={windowStart <= 0}
                onClick={() => onWindowStartChange((v) => Math.max(0, v - 80))}
                className="px-1 text-foreground disabled:opacity-35"
              >
                前 80 章
              </button>
              <span className="text-border">|</span>
              <button
                type="button"
                disabled={windowStart + 80 >= totalCount}
                onClick={() => onWindowStartChange((v) => Math.min(Math.max(0, totalCount - 80), v + 80))}
                className="px-1 text-foreground disabled:opacity-35"
              >
                后 80 章
              </button>
            </div>
          )}
          <span className="inline-flex items-center gap-1">
            <span className="inline-block size-2 rounded-xs bg-primary/75" /> 高张力（≥60）
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block size-2 rounded-xs bg-muted-foreground/35" /> 铺垫过渡
          </span>
        </div>
      </div>
      <div className="flex h-28 items-end gap-1 overflow-x-auto pb-1 pt-3">
        {sample.map((ch) => {
          const heightPct = Math.max(12, Math.min(100, ch.tension));
          const isHot = ch.tension >= 60;
          return (
            <button
              key={ch.number}
              type="button"
              onClick={() => onSelectChapter(ch.number)}
              title={`第 ${ch.number} 章 ${ch.title} · 张力 ${ch.tension} · 对白 ${Math.round(ch.dialogueRatio * 100)}% · ${ch.words} 字`}
              className="group relative flex h-full min-w-2.5 flex-1 flex-col items-center justify-end gap-1 rounded-xs hover:bg-muted/60"
            >
              {ch.hookCount > 0 && (
                <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
              )}
              <div
                className={`w-full max-w-4 rounded-t-xs transition-all group-hover:opacity-90 ${
                  isHot ? "bg-primary/75" : "bg-muted-foreground/30"
                }`}
                style={{ height: `${heightPct}%` }}
              />
              {ch.refined && (
                <span className="h-1 w-full max-w-4 rounded-full bg-success" aria-hidden="true" />
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-2xs text-muted-foreground">
        <span>第 {sample[0]!.number} 章</span>
        {sample.length > 2 && <span>第 {sample[Math.floor(sample.length / 2)]!.number} 章</span>}
        <span>第 {sample.at(-1)!.number} 章</span>
      </div>
    </div>
  );
}

export function DissectLibraryPanel({
  bookId,
  sidebarHost,
  fetchJson = defaultFetch,
  onSendToNarrator,
  onDirtyChange,
}: DissectLibraryPanelProps) {
  const base = `/api/books/${encodeURIComponent(bookId)}/dissect-library`;
  const [library, setLibrary] = useState<LibraryTree | null>(null);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<BookWorkspaceResponse | null>(null);
  const [view, setView] = useState<MainViewState>({ kind: "welcome" });
  const [chapterPair, setChapterPair] = useState<ChapterPairResponse | null>(null);

  const [document, setDocument] = useState<{ path: string; title: string; content: string } | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);

  const [drawer, setDrawer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 导入表单状态
  const [sourceKind, setSourceKind] = useState<ImportSourceKind>("upload");
  const [uploadedFiles, setUploadedFiles] = useState<readonly File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("仙侠");
  const [source, setSource] = useState("");
  const [text, setText] = useState("");
  const [splitPattern, setSplitPattern] = useState("");
  const [preview, setPreview] = useState<DissectPreviewResult | null>(null);
  const [selection, setSelection] = useState<ChapterSelection>({ preset: "first5" });
  const [mode, setMode] = useState<"per-chapter" | "merged">("per-chapter");
  const [template, setTemplate] = useState<NonNullable<DissectBuildInput["template"]>>("full");
  const [useModel, setUseModel] = useState(false);

  // 书房总览筛选与目录展开状态
  const [chapterQuery, setChapterQuery] = useState("");
  const [chapterFilter, setChapterFilter] = useState<"all" | "hot" | "hooks" | "refined">("all");
  const [chapterWindowStart, setChapterWindowStart] = useState(0);
  const [chapterTableLimit, setChapterTableLimit] = useState(120);
  const [showRawTree, setShowRawTree] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const request = useRef(0);
  const alive = useRef(true);

  const dirty = document !== null && draft !== document.content;
  useEffect(() => {
    onDirtyChange?.(dirty ? document.title : null);
    return () => onDirtyChange?.(null);
  }, [dirty, document?.title, onDirtyChange]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      request.current++;
    };
  }, []);

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);

  // 提取书架列表（兼容测试构造的精简树结构）
  const dissectBooks = useMemo(() => {
    const novelsNode = library?.tree.children?.find((child) => child.title === "小说");
    const list = (novelsNode?.children ?? []).filter((child) => child.kind === "directory");
    return list;
  }, [library]);

  const refresh = useCallback(async () => {
    const result = (await fetchJson(`${base}/tree`)) as LibraryTree;
    if (!alive.current) return null;
    setLibrary(result);
    return result;
  }, [base, fetchJson]);

  const loadWorkspace = useCallback(
    async (slug: string) => {
      try {
        const result = (await fetchJson(`${base}/books/${encodeURIComponent(slug)}/workspace`)) as BookWorkspaceResponse;
        if (alive.current) setWorkspace(result);
      } catch {
        if (alive.current) setWorkspace(null);
      }
    },
    [base, fetchJson],
  );

  useEffect(() => {
    setDocument(null);
    setDraft("");
    setLibrary(null);
    setSelectedSlug(null);
    setWorkspace(null);
    setChapterPair(null);
    setView({ kind: "welcome" });
    void refresh()
      .then((res) => {
        if (!res || !alive.current) return;
        const novels = res.tree.children?.find((c) => c.title === "小说")?.children ?? [];
        const firstBook = novels.find((c) => c.kind === "directory");
        if (firstBook) {
          setSelectedSlug(firstBook.title);
          setView({ kind: "overview", slug: firstBook.title });
          void loadWorkspace(firstBook.title);
        }
      })
      .catch((e: unknown) => {
        if (alive.current) setError(e instanceof Error ? e.message : "读取拆书库失败");
      });
  }, [refresh, loadWorkspace]);

  const selectBook = useCallback(
    (slug: string) => {
      if (dirty && !window.confirm("当前笔记有未保存修改，放弃修改并切换书籍？")) return;
      setDocument(null);
      setDraft("");
      setChapterPair(null);
      setSelectedSlug(slug);
      setChapterWindowStart(0);
      setChapterTableLimit(120);
      setView({ kind: "overview", slug });
      const entry = dissectBooks.find((b) => b.title === slug);
      if (entry?.meta) {
        setTitle(entry.meta.bookTitle);
        setCategory(entry.meta.category);
        const last = Math.max(0, ...entry.meta.analyzedRanges.map((r) => r.to));
        if (last < entry.meta.totalChapters) {
          setSelection({ preset: "range", from: last + 1, to: Math.min(last + 10, entry.meta.totalChapters) });
        }
      }
      void loadWorkspace(slug);
    },
    [dirty, dissectBooks, loadWorkspace],
  );

  const openDoc = useCallback(
    async (node: DissectNode) => {
      if (dirty && !window.confirm("当前报告有未保存修改，放弃修改并切换？")) return;
      const seq = ++request.current;
      setError(null);
      try {
        const result = (await fetchJson(`${base}/doc?path=${encodeURIComponent(node.path)}`)) as { content: string };
        if (!alive.current || request.current !== seq) return;
        setDocument({ path: node.path, title: node.title, content: result.content });
        setDraft(result.content);
        setEditing(false);
        const parts = node.path.split("/");
        const slug = parts[2] === "小说" && parts[3] ? parts[3] : null;
        setView({ kind: "document", slug, path: node.path, title: node.title });
        if (slug) {
          setSelectedSlug(slug);
          const entry = dissectBooks.find((child) => child.title === slug);
          if (entry?.meta) {
            setTitle(entry.meta.bookTitle);
            setCategory(entry.meta.category);
            if (entry.meta.sourceFile) setSource(entry.meta.sourceFile);
            const last = Math.max(0, ...entry.meta.analyzedRanges.map((range) => range.to));
            if (last < entry.meta.totalChapters) {
              setSelection({ preset: "range", from: last + 1, to: Math.min(last + 10, entry.meta.totalChapters) });
            }
          }
          if (!workspace || workspace.slug !== slug) {
            void loadWorkspace(slug);
          }
        }
      } catch (e) {
        if (alive.current) setError(e instanceof Error ? e.message : "读取文档失败");
      }
    },
    [base, dirty, dissectBooks, fetchJson, loadWorkspace, workspace],
  );

  const openChapterStudy = useCallback(
    async (slug: string, chapterNumber: number) => {
      if (dirty && !window.confirm("当前笔记有未保存修改，放弃修改并切换章节？")) return;
      const seq = ++request.current;
      setError(null);
      try {
        const pair = (await fetchJson(
          `${base}/books/${encodeURIComponent(slug)}/chapters/${chapterNumber}`,
        )) as ChapterPairResponse;
        if (!alive.current || request.current !== seq) return;
        setSelectedSlug(slug);
        setChapterPair(pair);
        setDocument({ path: pair.analysisPath, title: `第${pair.chapterNumber}章拆解`, content: pair.analysisContent });
        setDraft(pair.analysisContent);
        setEditing(false);
        setView({ kind: "chapter", slug, chapterNumber: pair.chapterNumber });
      } catch (e) {
        if (alive.current) setError(e instanceof Error ? e.message : "读取章节原文与拆解失败");
      }
    },
    [base, dirty, fetchJson],
  );

  const save = async () => {
    if (!document) return;
    const snapshot = draft;
    const path = document.path;
    setSaving(true);
    setError(null);
    try {
      await fetchJson(`${base}/doc`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, content: snapshot }),
      });
      if (!alive.current) return;
      setDocument((current) => (current?.path === path ? { ...current, content: snapshot } : current));
      setNotice("拆书笔记已保存");
      await refresh();
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "保存失败，修改仍保留");
    } finally {
      if (alive.current) setSaving(false);
    }
  };

  const openImportWizard = (preferredKind: ImportSourceKind = "upload") => {
    setSourceKind(preferredKind);
    setPreview(null);
    setError(null);
    setDrawer(true);
  };

  const applySelectedFiles = (list: FileList | File[] | null) => {
    const picked = Array.from(list ?? []).filter((f) => /\.(txt|md|markdown|text|epub|docx)$/iu.test(f.name));
    if (picked.length === 0) {
      setError("请选择 .txt、.md、.epub 或 .docx 格式的文件。");
      return;
    }
    setError(null);
    setUploadedFiles(picked);
    setPreview(null);
    if (!title.trim() && picked[0]) {
      const rel = (picked[0] as File & { webkitRelativePath?: string }).webkitRelativePath;
      setTitle(rel && picked.length > 1 ? rel.split("/")[0] ?? stripExt(picked[0].name) : stripExt(picked[0].name));
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    applySelectedFiles(event.target.files);
    event.target.value = "";
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    applySelectedFiles(event.dataTransfer.files);
  };

  const runPreview = async () => {
    setPreviewBusy(true);
    setError(null);
    try {
      let result: DissectPreviewResult;
      if (sourceKind === "upload" && uploadedFiles.length > 0) {
        const form = new FormData();
        for (const file of uploadedFiles) {
          const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
          form.append("files", file, rel || file.name);
        }
        if (splitPattern.trim()) form.set("splitPattern", splitPattern.trim());
        result = (await fetchJson(`${base}/preview`, { method: "POST", body: form })) as DissectPreviewResult;
      } else {
        result = (await fetchJson(`${base}/preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(sourceKind === "workspace" && source ? { filePath: source } : { text }),
            ...(splitPattern.trim() ? { splitPattern: splitPattern.trim() } : {}),
          }),
        })) as DissectPreviewResult;
      }
      if (!alive.current) return;
      setPreview(result);
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "预览分章失败");
    } finally {
      if (alive.current) setPreviewBusy(false);
    }
  };

  const canSubmitBuild = useMemo(() => {
    if (!title.trim()) return false;
    if (sourceKind === "upload") return uploadedFiles.length > 0;
    if (sourceKind === "workspace") return Boolean(source);
    return Boolean(text.trim());
  }, [source, sourceKind, text, title, uploadedFiles.length]);

  const build = async (mechanical = false) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const effectiveUseModel = mechanical ? false : useModel;
      const effectiveSelection: ChapterSelection = mechanical ? { preset: "all" } : selection;
      let result: { slug: string; selectedRange: { from: number; to: number }; generatedDocuments: number; modelRefined: boolean };

      if (sourceKind === "upload" && uploadedFiles.length > 0) {
        const form = new FormData();
        form.set("bookTitle", title.trim());
        if (category.trim()) form.set("category", category.trim());
        if (splitPattern.trim()) form.set("splitPattern", splitPattern.trim());
        form.set("chapterSelection", JSON.stringify(effectiveSelection));
        form.set("dissectMode", mode);
        form.set("template", template);
        form.set("useModel", String(effectiveUseModel));
        for (const file of uploadedFiles) {
          const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
          form.append("files", file, rel || file.name);
        }
        result = (await fetchJson(`${base}/build`, { method: "POST", body: form })) as typeof result;
      } else {
        result = (await fetchJson(`${base}/build`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bookTitle: title.trim(),
            category: category.trim(),
            ...(sourceKind === "workspace" && source ? { filePath: source } : { text }),
            ...(splitPattern.trim() ? { splitPattern: splitPattern.trim() } : {}),
            chapterSelection: effectiveSelection,
            dissectMode: mode,
            template,
            useModel: effectiveUseModel,
          }),
        })) as typeof result;
      }

      if (!alive.current) return;
      const targetSlug = result.slug || title.trim();
      setNotice(
        `已为《${targetSlug}》建立 ${result.generatedDocuments} 份维度报告与逐章索引；${
          result.modelRefined ? "已完成模型深度精炼" : "本地量化扫描与原文对照已就绪，可随时点选章节调用模型精拆"
        }。`,
      );
      setSelection({ preset: "range", ...result.selectedRange });
      setChapterWindowStart(0);
      setDrawer(false);
      await refresh();
      setSelectedSlug(targetSlug);
      setView({ kind: "overview", slug: targetSlug });
      await loadWorkspace(targetSlug);
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "建库失败");
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const refineStoredRange = async (slug: string, from: number, to: number, perChapter = true) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = (await fetchJson(`${base}/build`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookTitle: slug,
          reuseStoredSource: true,
          chapterSelection: { preset: "range", from, to },
          dissectMode: perChapter ? "per-chapter" : "merged",
          template,
          useModel: true,
        }),
      })) as { selectedRange: { from: number; to: number } };
      if (!alive.current) return;
      setNotice(`已完成第 ${result.selectedRange.from}–${result.selectedRange.to} 章的模型深度细拆。`);
      await refresh();
      await loadWorkspace(slug);
      if (view.kind === "chapter" && view.slug === slug) {
        await openChapterStudy(slug, view.chapterNumber);
      }
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "模型精拆失败");
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const remove = async (targetSlug?: string) => {
    const slug = targetSlug ?? selectedSlug ?? document?.path.split("/")[3];
    if (!slug || !window.confirm(`删除《${slug}》的全部拆书文档与原文快照？此操作不可撤销。`)) return;
    setBusy(true);
    try {
      await fetchJson(`${base}/books/${encodeURIComponent(slug)}`, { method: "DELETE" });
      if (!alive.current) return;
      setDocument(null);
      setDraft("");
      setChapterPair(null);
      setWorkspace(null);
      setSelectedSlug(null);
      setView({ kind: "welcome" });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    } finally {
      setBusy(false);
    }
  };

  const activeBookNode = useMemo(
    () => (selectedSlug ? dissectBooks.find((b) => b.title === selectedSlug) ?? null : null),
    [dissectBooks, selectedSlug],
  );
  const activeBookReports = useMemo(() => {
    const reportDir = activeBookNode?.children?.find((c) => c.title === "报告");
    const cardDir = activeBookNode?.children?.find((c) => c.title === "结构卡");
    return [...(cardDir?.children ?? []), ...(reportDir?.children ?? [])].filter((n) => n.kind === "document");
  }, [activeBookNode]);

  const filteredChapters = useMemo(() => {
    const list = workspace?.chapters ?? [];
    const q = chapterQuery.trim().toLowerCase();
    return list.filter((ch) => {
      if (chapterFilter === "hot" && ch.tension < 60) return false;
      if (chapterFilter === "hooks" && ch.hookCount === 0) return false;
      if (chapterFilter === "refined" && !ch.refined) return false;
      if (!q) return true;
      return (
        ch.title.toLowerCase().includes(q) ||
        String(ch.number).includes(q) ||
        ch.head.toLowerCase().includes(q)
      );
    });
  }, [chapterFilter, chapterQuery, workspace?.chapters]);

  const overviewStats = useMemo(() => {
    const list = workspace?.chapters ?? [];
    if (list.length === 0) return { avgTension: 0, avgDialogue: 0, hookChapters: 0, avgWords: 0 };
    return {
      avgTension: Math.round(list.reduce((s, c) => s + c.tension, 0) / list.length),
      avgDialogue: Math.round((list.reduce((s, c) => s + c.dialogueRatio, 0) / list.length) * 100),
      hookChapters: list.filter((c) => c.hookCount > 0).length,
      avgWords: Math.round(list.reduce((s, c) => s + c.words, 0) / list.length),
    };
  }, [workspace?.chapters]);

  const sendSummaryToNarrator = (label: string, body: string) => {
    if (!onSendToNarrator) return;
    void Promise.resolve(
      onSendToNarrator(
        `请结合拆书资料《${label}》，协助我推进本书的大纲、细纲与技法迁移。注意：以下仅作结构与写法参考，不可照搬原书设定或原句：\n\n${body.slice(0, 6000)}`,
      ),
    ).catch((e: unknown) => setError(e instanceof Error ? e.message : "发送失败"));
  };

  // 左栏目录：参考书架 + 当前书的看板/维度报告/目录树
  const sidebar = (
    <aside className="flex h-full min-h-0 flex-col bg-card" aria-label="拆书库目录">
      <header className="flex items-center justify-between border-b border-border px-3 py-2.5">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <BookMarked className="size-4 text-primary" strokeWidth={1.65} />
          <span>参考拆书库</span>
        </span>
        <Button variant="ghost" size="icon" className="size-7" aria-label="导入拆新书" onClick={() => openImportWizard("upload")}>
          <Plus className="size-4" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-2 space-y-3">
        {!library ? (
          <p className="p-3 text-xs text-muted-foreground">正在翻阅书架…</p>
        ) : dissectBooks.length === 0 && !(library.tree.children?.length) ? (
          <div className="rounded-lg border border-dashed border-border p-3 text-center">
            <p className="text-xs leading-relaxed text-muted-foreground">
              导入对标爆款小说（TXT / MD / EPUB / DOCX），建立结构看板与逐章对照笔记。
            </p>
            <Button variant="outline" size="sm" className="mt-2.5 w-full text-xs" onClick={() => openImportWizard("upload")}>
              <FileUp className="mr-1.5 size-3.5" />
              导入第一本参考书
            </Button>
          </div>
        ) : (
          <>
            {dissectBooks.length > 0 && (
              <div className="space-y-1">
                <p className="px-1.5 text-2xs font-medium text-muted-foreground">已建参考书（{dissectBooks.length}）</p>
                {dissectBooks.map((book) => {
                  const active = selectedSlug === book.title;
                  const meta = book.meta;
                  return (
                    <button
                      key={book.path}
                      type="button"
                      onClick={() => selectBook(book.title)}
                      aria-current={active && view.kind === "overview" ? "page" : undefined}
                      className={`w-full rounded-lg border px-2.5 py-2 text-left transition-colors ${
                        active
                          ? "border-primary/40 bg-primary/8 text-foreground"
                          : "border-transparent hover:border-border hover:bg-muted/50 text-muted-foreground"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="truncate text-xs font-medium text-foreground">《{book.title}》</span>
                        {meta?.category && (
                          <Badge variant="secondary" className="h-4 shrink-0 px-1.5 text-2xs">
                            {meta.category}
                          </Badge>
                        )}
                      </div>
                      <div className="mt-1 flex items-center justify-between text-2xs text-muted-foreground">
                        <span>{meta ? `${meta.totalChapters} 章` : "目录已就绪"}</span>
                        {meta?.refinedChapters?.length ? (
                          <span className="text-success">已精拆 {meta.refinedChapters.length} 章</span>
                        ) : (
                          <span>待深拆</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {selectedSlug && (
              <div className="space-y-1 border-t border-border/60 pt-2">
                <p className="px-1.5 text-2xs font-medium text-muted-foreground">《{selectedSlug}》工作面</p>
                <button
                  type="button"
                  onClick={() => setView({ kind: "overview", slug: selectedSlug })}
                  aria-current={view.kind === "overview" ? "page" : undefined}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted aria-[current=page]:bg-primary/10 aria-[current=page]:font-medium aria-[current=page]:text-primary"
                >
                  <Activity className="size-3.5 shrink-0" />
                  <span>拆书看板 & 节奏图</span>
                </button>
                {workspace && workspace.chapters.length > 0 && (
                  <button
                    type="button"
                    onClick={() => void openChapterStudy(selectedSlug, view.kind === "chapter" ? view.chapterNumber : 1)}
                    aria-current={view.kind === "chapter" ? "page" : undefined}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted aria-[current=page]:bg-primary/10 aria-[current=page]:font-medium aria-[current=page]:text-primary"
                  >
                    <Columns2 className="size-3.5 shrink-0" />
                    <span>逐章原文对照精读</span>
                  </button>
                )}

                {activeBookReports.length > 0 && (
                  <div className="pt-1">
                    <p className="px-1.5 pb-1 text-2xs text-muted-foreground">维度报告与结构卡</p>
                    <div className="space-y-0.5">
                      {activeBookReports.map((report) => (
                        <button
                          key={report.path}
                          type="button"
                          aria-current={document?.path === report.path ? "page" : undefined}
                          className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted aria-[current=page]:bg-primary/10 aria-[current=page]:text-primary"
                          onClick={() => void openDoc(report)}
                        >
                          <FileText className="size-3 shrink-0" />
                          <span className="truncate">{report.title}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 完整文件树折叠查看（兼容直接浏览卷摘要与底层 MD，且保证所有旧单测节点可点开） */}
            <div className="border-t border-border/60 pt-2">
              <button
                type="button"
                onClick={() => setShowRawTree((v) => !v)}
                className="flex w-full items-center justify-between px-1.5 py-1 text-2xs font-medium text-muted-foreground hover:text-foreground"
              >
                <span>完整拆书文件树</span>
                {showRawTree || !selectedSlug ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
              </button>
              {(showRawTree || !selectedSlug) && (
                <ul className="mt-1">
                  <TreeNode node={library.tree} selected={document?.path} onSelect={(node) => void openDoc(node)} />
                </ul>
              )}
            </div>
          </>
        )}
      </div>

      <div className="border-t border-border px-3 py-2 text-2xs text-muted-foreground">
        支持 TXT · MD · EPUB · DOCX 本地导入
      </div>
    </aside>
  );

  const currentChapterMetric = useMemo(() => {
    if (view.kind !== "chapter" || !workspace) return null;
    return workspace.chapters.find((c) => c.number === view.chapterNumber) ?? null;
  }, [view, workspace]);

  return (
    <section className="flex h-full min-h-0 bg-background" aria-label="拆书库工作面">
      {sidebarHost ? createPortal(sidebar, sidebarHost) : <div className="w-64 shrink-0 border-r border-border">{sidebar}</div>}

      <main className="flex min-w-0 flex-1 flex-col">
        {/* 顶栏 */}
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card/60 px-5 py-3">
          <div className="min-w-0">
            <p className="text-2xs tracking-widest text-muted-foreground">读书有痕 · 拆书有法 · 写作有据</p>
            <h2 className="mt-0.5 truncate text-base font-semibold text-foreground">
              {view.kind === "overview"
                ? `《${view.slug}》拆书看板`
                : view.kind === "chapter"
                  ? `《${view.slug}》· 第 ${view.chapterNumber} 章对照精读`
                  : view.kind === "document"
                    ? `${view.slug ? `《${view.slug}》· ` : ""}${view.title}`
                    : "网文拆书与精读案头"}
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="default" size="sm" onClick={() => openImportWizard("upload")}>
              <FileUp className="mr-1.5 size-3.5" />
              导入参考书 / 增量拆解
            </Button>
            {selectedSlug && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="删除此拆书条目"
                disabled={busy}
                onClick={() => void remove(selectedSlug)}
              >
                <Trash2 className="size-4" />
              </Button>
            )}
          </div>
        </header>

        {error && (
          <p role="alert" className="border-b border-destructive/20 bg-destructive/5 px-5 py-2 text-xs text-destructive">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="border-b border-border bg-muted/40 px-5 py-2 text-xs text-foreground">
            {notice}
          </p>
        )}

        {/* 1. 空态欢迎台 */}
        {view.kind === "welcome" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-6 overflow-auto p-8">
            <div className="max-w-lg text-center">
              <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <BookMarked className="size-6" strokeWidth={1.5} />
              </div>
              <h3 className="font-serif text-xl font-semibold text-foreground">从导入一本好书开始拆解</h3>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                别再手动复制粘段落。直接上传本地小说文件，先校准分章、看全书张力与钩子曲线，再进入「原文对照 + 拆解笔记」逐章吃透写法。
              </p>
            </div>

            <div className="grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => openImportWizard("upload")}
                className="flex flex-col items-start gap-2 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"
              >
                <FileUp className="size-5 text-primary" />
                <span className="text-xs font-semibold text-foreground">上传本地小说</span>
                <span className="text-2xs leading-relaxed text-muted-foreground">
                  支持 .txt（UTF-8/GBK）、.md、.epub、.docx 或章节文件夹
                </span>
              </button>

              <button
                type="button"
                onClick={() => openImportWizard("workspace")}
                className="flex flex-col items-start gap-2 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"
              >
                <FolderOpen className="size-5 text-primary" />
                <span className="text-xs font-semibold text-foreground">选本书参考文件</span>
                <span className="text-2xs leading-relaxed text-muted-foreground">
                  直接读取作品目录下的 {library?.referenceFiles.length ?? 0} 份文本资料
                </span>
              </button>

              <button
                type="button"
                onClick={() => openImportWizard("paste")}
                className="flex flex-col items-start gap-2 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"
              >
                <PenLine className="size-5 text-primary" />
                <span className="text-xs font-semibold text-foreground">粘贴黄金三章</span>
                <span className="text-2xs leading-relaxed text-muted-foreground">
                  贴入开篇几章文本，立刻切章扫描钩子与节奏密度
                </span>
              </button>
            </div>
          </div>
        )}

        {/* 2. 拆书总览看板 */}
        {view.kind === "overview" && (
          <div className="flex-1 space-y-5 overflow-y-auto p-5">
            {/* 头部信息与高频动作条 */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-serif text-base font-semibold text-foreground">《{view.slug}》</span>
                  {workspace?.meta.category && <Badge variant="secondary">{workspace.meta.category}</Badge>}
                  {workspace?.meta.sourceEncoding && (
                    <Badge variant="outline" className="text-2xs">
                      {encodingLabel(workspace.meta.sourceEncoding)}
                    </Badge>
                  )}
                </div>
                <p className="text-2xs text-muted-foreground">
                  共 {workspace?.meta.totalChapters ?? 0} 章 · {(workspace?.meta.totalWords ?? 0).toLocaleString("zh-CN")} 字 · 来源：
                  {workspace?.meta.sourceFile ?? "粘贴原文"} · 已深拆：{workspace?.meta.refinedChapters?.length ?? 0} 章
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {workspace && workspace.chapters.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void openChapterStudy(view.slug, 1)}
                  >
                    <Columns2 className="mr-1.5 size-3.5" />
                    进入逐章对照精读
                  </Button>
                )}
                {workspace?.hasStoredSource && (
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      const refinedMax = Math.max(0, ...(workspace.meta.refinedChapters ?? []));
                      const from = Math.min(refinedMax + 1, workspace.meta.totalChapters);
                      const to = Math.min(from + 2, workspace.meta.totalChapters);
                      void refineStoredRange(view.slug, from, to, true);
                    }}
                  >
                    {busy ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Sparkles className="mr-1.5 size-3.5" />}
                    模型精拆下 3 章
                  </Button>
                )}
                {onSendToNarrator && workspace && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      sendSummaryToNarrator(
                        view.slug,
                        `《${view.slug}》（${workspace.meta.category}），共 ${workspace.meta.totalChapters} 章，均章 ${overviewStats.avgWords} 字，平均张力 ${overviewStats.avgTension}/100，平均对白占比 ${overviewStats.avgDialogue}%。前5章切面：\n` +
                          workspace.chapters
                            .slice(0, 5)
                            .map((c) => `- 第${c.number}章 ${c.title}（${c.words}字，张力${c.tension}）：开端「${c.head}」→ 收束「${c.tail}」`)
                            .join("\n"),
                      )
                    }
                  >
                    <MessageSquare className="mr-1.5 size-3.5" />
                    让叙述者参考本书结构
                  </Button>
                )}
              </div>
            </div>

            {/* 四格核心量化卡片 */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-border bg-card p-3.5">
                <p className="text-2xs text-muted-foreground">平均张力分</p>
                <p className="mt-1 text-xl font-semibold text-foreground">{overviewStats.avgTension} <span className="text-xs font-normal text-muted-foreground">/ 100</span></p>
              </div>
              <div className="rounded-xl border border-border bg-card p-3.5">
                <p className="text-2xs text-muted-foreground">平均对白占比</p>
                <p className="mt-1 text-xl font-semibold text-foreground">{overviewStats.avgDialogue}%</p>
              </div>
              <div className="rounded-xl border border-border bg-card p-3.5">
                <p className="text-2xs text-muted-foreground">含章末钩子章</p>
                <p className="mt-1 text-xl font-semibold text-foreground">{overviewStats.hookChapters} <span className="text-xs font-normal text-muted-foreground">章</span></p>
              </div>
              <div className="rounded-xl border border-border bg-card p-3.5">
                <p className="text-2xs text-muted-foreground">均章体量</p>
                <p className="mt-1 text-xl font-semibold text-foreground">{overviewStats.avgWords.toLocaleString("zh-CN")} <span className="text-xs font-normal text-muted-foreground">字</span></p>
              </div>
            </div>

            {/* 节奏曲线图 */}
            {workspace && workspace.chapters.length > 0 && (
              <DissectRhythmChart
                chapters={workspace.chapters}
                windowStart={chapterWindowStart}
                onWindowStartChange={setChapterWindowStart}
                onSelectChapter={(n) => void openChapterStudy(view.slug, n)}
              />
            )}

            {/* 维度报告快捷芯片 */}
            {activeBookReports.length > 0 && (
              <div className="rounded-xl border border-border bg-card p-4">
                <h4 className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <Layers className="size-3.5 text-primary" />
                  <span>结构卡与专题分析报告</span>
                </h4>
                <div className="flex flex-wrap gap-2">
                  {activeBookReports.map((report) => (
                    <Button key={report.path} size="sm" variant="outline" className="h-7 text-xs" onClick={() => void openDoc(report)}>
                      {report.title}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* 逐章索引与入口表 */}
            <div className="rounded-xl border border-border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
                <h4 className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <BookOpen className="size-3.5 text-primary" />
                  <span>逐章拆解台账（{filteredChapters.length} / {workspace?.chapters.length ?? 0} 章）</span>
                </h4>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={chapterQuery}
                      onChange={(e) => setChapterQuery(e.target.value)}
                      placeholder="搜章号或标题…"
                      className="h-7 w-40 pl-7 text-xs"
                    />
                  </div>
                  <ToggleGroup
                    value={[chapterFilter]}
                    onValueChange={(v) => {
                      if (v[0]) setChapterFilter(v[0] as typeof chapterFilter);
                    }}
                    aria-label="章节筛选"
                  >
                    <ToggleGroupItem value="all" className="h-7 px-2 text-2xs">全部</ToggleGroupItem>
                    <ToggleGroupItem value="hot" className="h-7 px-2 text-2xs">高张力</ToggleGroupItem>
                    <ToggleGroupItem value="hooks" className="h-7 px-2 text-2xs">有钩子</ToggleGroupItem>
                    <ToggleGroupItem value="refined" className="h-7 px-2 text-2xs">已精拆</ToggleGroupItem>
                  </ToggleGroup>
                </div>
              </div>

              {filteredChapters.length === 0 ? (
                <p className="p-6 text-center text-xs text-muted-foreground">
                  {workspace?.chapters.length ? "没有匹配的章节，请调整筛选条件。" : "本条目由旧版扫描生成，暂无逐章索引；重新导入一次原文即可解锁双栏精读与曲线。"}
                </p>
              ) : (
                <div className="divide-y divide-border/60">
                  {filteredChapters.slice(0, chapterTableLimit).map((ch) => (
                    <div
                      key={ch.number}
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-muted/40"
                    >
                      <button
                        type="button"
                        onClick={() => void openChapterStudy(view.slug, ch.number)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold text-foreground">
                            第 {ch.number} 章 · {ch.title}
                          </span>
                          {ch.refined && (
                            <Badge variant="secondary" className="h-4 whitespace-nowrap px-1.5 text-2xs text-success">
                              已精拆
                            </Badge>
                          )}
                          {ch.hookCount > 0 && (
                            <Badge variant="outline" className="h-4 whitespace-nowrap px-1.5 text-2xs">
                              {ch.hookCount} 钩子
                            </Badge>
                          )}
                        </div>
                        <p className="mt-1 truncate text-2xs text-muted-foreground">
                          切入：{ch.head || "—"} ｜ 收束：{ch.tail || "—"}
                        </p>
                      </button>

                      <div className="flex shrink-0 items-center gap-3 text-2xs whitespace-nowrap text-muted-foreground tabular-nums">
                        <span>{ch.words} 字</span>
                        <span>张力 {ch.tension}</span>
                        <span>对白 {Math.round(ch.dialogueRatio * 100)}%</span>
                        <Button size="sm" variant="outline" className="h-7 px-2.5 text-2xs" onClick={() => void openChapterStudy(view.slug, ch.number)}>
                          对照精读
                        </Button>
                      </div>
                    </div>
                  ))}
                  {filteredChapters.length > chapterTableLimit && (
                    <div className="flex items-center justify-between gap-2 px-4 py-2.5 text-2xs text-muted-foreground">
                      <span>已展示前 {chapterTableLimit} / {filteredChapters.length} 章</span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2.5 text-2xs"
                        onClick={() => setChapterTableLimit((v) => v + 200)}
                      >
                        继续展开后 200 章
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 3. 逐章双栏对照精读 */}
        {view.kind === "chapter" && chapterPair && (
          <div className="flex min-h-0 flex-1 flex-col">
            {/* 章节导航与精拆操作栏 */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card/40 px-4 py-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={() => setView({ kind: "overview", slug: view.slug })}
                >
                  <ChevronLeft className="mr-0.5 size-3.5" />
                  返回看板
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 whitespace-nowrap px-2 text-xs"
                  disabled={chapterPair.chapterNumber <= 1}
                  onClick={() => void openChapterStudy(view.slug, chapterPair.chapterNumber - 1)}
                >
                  <ChevronLeft className="size-3.5" />
                  上一章
                </Button>
                <select
                  aria-label="快速跳转章节"
                  value={chapterPair.chapterNumber}
                  onChange={(e) => void openChapterStudy(view.slug, Number(e.target.value))}
                  className="h-7 max-w-52 truncate rounded-md border border-border bg-background px-2 text-xs font-medium text-foreground outline-none"
                >
                  {(workspace?.chapters.length
                    ? workspace.chapters
                    : [{ number: chapterPair.chapterNumber, title: chapterPair.title }]
                  ).map((ch) => (
                    <option key={ch.number} value={ch.number}>
                      第 {ch.number} 章 · {ch.title}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 whitespace-nowrap px-2 text-xs"
                  disabled={workspace ? chapterPair.chapterNumber >= workspace.meta.totalChapters : false}
                  onClick={() => void openChapterStudy(view.slug, chapterPair.chapterNumber + 1)}
                >
                  下一章
                  <ChevronRight className="size-3.5" />
                </Button>
                {currentChapterMetric && (
                  <span className="hidden pl-1.5 text-2xs whitespace-nowrap text-muted-foreground xl:inline">
                    {currentChapterMetric.words} 字 · 张力 {currentChapterMetric.tension} · 对白 {Math.round(currentChapterMetric.dialogueRatio * 100)}%
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={busy}
                  onClick={() => void refineStoredRange(view.slug, chapterPair.chapterNumber, chapterPair.chapterNumber, true)}
                >
                  {busy ? <Loader2 className="mr-1 size-3 animate-spin" /> : <Sparkles className="mr-1 size-3" />}
                  精拆本章
                </Button>
                <ToggleGroup
                  value={[editing ? "edit" : "preview"]}
                  onValueChange={(value) => {
                    if (value[0]) setEditing(value[0] === "edit");
                  }}
                  aria-label="拆解笔记显示方式"
                >
                  <ToggleGroupItem value="preview" className="h-7 px-2 text-xs">
                    <Eye className="mr-1 size-3" /> 阅读
                  </ToggleGroupItem>
                  <ToggleGroupItem value="edit" className="h-7 px-2 text-xs">
                    <PenLine className="mr-1 size-3" /> 编辑笔记
                  </ToggleGroupItem>
                </ToggleGroup>
                {dirty && (
                  <Button size="sm" className="h-7 text-xs" disabled={saving} onClick={() => void save()}>
                    {saving ? "保存中…" : "保存笔记"}
                  </Button>
                )}
                {onSendToNarrator && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() =>
                      sendSummaryToNarrator(
                        `${view.slug} 第${chapterPair.chapterNumber}章`,
                        `拆解笔记：\n${draft.slice(0, 3500)}\n\n原文节选：\n${chapterPair.sourceText.slice(0, 2000)}`,
                      )
                    }
                  >
                    <MessageSquare className="mr-1 size-3" />
                    带入叙述者
                  </Button>
                )}
              </div>
            </div>

            {/* 左右双栏：左原文，右拆解 */}
            <div className="grid min-h-0 flex-1 grid-cols-1 divide-y divide-border md:grid-cols-2 md:divide-x md:divide-y-0">
              <section className="flex min-h-0 flex-col bg-background" aria-label="参考书原文">
                <div className="border-b border-border/60 bg-muted/25 px-4 py-1.5 text-2xs font-medium text-muted-foreground">
                  参考书原文（{chapterPair.metrics?.words ?? 0} 字）
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                  {chapterPair.sourceText ? (
                    <div className="space-y-4 font-serif text-sm leading-loose text-foreground/95">
                      {chapterPair.sourceText.split(/\n+/).map((para, idx) => (
                        <p key={idx} className="indent-7">
                          {para}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">未能读取本章原文，请确认建库时已保存原文快照。</p>
                  )}
                </div>
              </section>

              <section className="flex min-h-0 flex-col bg-card" aria-label="本章拆解笔记">
                <div className="border-b border-border/60 bg-muted/25 px-4 py-1.5 text-2xs font-medium text-muted-foreground">
                  拆解结构与笔记（可自由编辑保存）
                </div>
                <div className="min-h-0 flex-1">
                  {editing ? (
                    <Textarea
                      aria-label="拆书报告正文"
                      className="h-full resize-none rounded-none border-0 px-6 py-5 font-serif text-sm leading-loose focus-visible:ring-0"
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                    />
                  ) : (
                    <DissectMarkdown key={chapterPair.analysisPath} content={draft} />
                  )}
                </div>
              </section>
            </div>
          </div>
        )}

        {/* 4. 维度报告 / 结构卡阅读编辑 */}
        {view.kind === "document" && document && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-2">
              <div className="flex flex-wrap items-center gap-2">
                {view.slug && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => setView({ kind: "overview", slug: view.slug! })}
                  >
                    <ChevronLeft className="mr-1 size-3.5" />
                    返回看板
                  </Button>
                )}
                <ToggleGroup
                  value={[editing ? "edit" : "preview"]}
                  onValueChange={(value) => {
                    if (value[0]) setEditing(value[0] === "edit");
                  }}
                  aria-label="报告显示方式"
                >
                  <ToggleGroupItem value="preview">预览</ToggleGroupItem>
                  <ToggleGroupItem value="edit">编辑</ToggleGroupItem>
                </ToggleGroup>
              </div>
              <div className="flex items-center gap-2">
                {dirty && (
                  <Button size="sm" disabled={saving} onClick={() => void save()}>
                    {saving ? "保存中…" : "保存修改"}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!onSendToNarrator}
                  onClick={() => sendSummaryToNarrator(document.title, draft)}
                >
                  <MessageSquare className="mr-1.5 size-3.5" />
                  和叙述者讨论此篇
                </Button>
              </div>
            </div>
            <div className="min-h-0 flex-1">
              {editing ? (
                <Textarea
                  aria-label="拆书报告正文"
                  className="h-full resize-none rounded-none border-0 px-10 py-7 font-serif text-base leading-loose focus-visible:ring-0"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                />
              ) : (
                <DissectMarkdown key={document.path} content={draft} />
              )}
            </div>
          </>
        )}
      </main>

      {/* 导入与分章校准抽屉 */}
      <Sheet
        open={drawer}
        onOpenChange={(value) => {
          if (!busy) setDrawer(value);
        }}
      >
        <SheetContent className="overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>导入参考书 / 增量拆解</SheetTitle>
            <SheetDescription>
              支持直接上传本地 .txt（自动兼容 UTF-8 / GBK）、.md、.epub、.docx 或章节文件夹。建议先点「预览分章」核对章节边界再建库。
            </SheetDescription>
          </SheetHeader>

          <form
            className="flex flex-col gap-4 px-5 pb-6 pt-2"
            onSubmit={(event) => {
              event.preventDefault();
              void build();
            }}
          >
            {/* 书名与题材 */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="dissect-title">参考书名</Label>
                <Input
                  id="dissect-title"
                  value={title}
                  required
                  maxLength={120}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="例如：没钱修什么仙"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="dissect-category">题材分类</Label>
                <Input
                  id="dissect-category"
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  placeholder="例如：仙侠 / 都市 / 悬疑"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {CATEGORY_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setCategory(preset)}
                  className={`rounded-md border px-2 py-0.5 text-2xs transition-colors ${
                    category === preset
                      ? "border-primary bg-primary/10 font-medium text-primary"
                      : "border-border bg-background text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>

            {/* 原文来源切换 */}
            <div className="space-y-2">
              <Label>原文来源</Label>
              <ToggleGroup
                value={[sourceKind]}
                onValueChange={(value) => {
                  if (value[0]) {
                    setSourceKind(value[0] as ImportSourceKind);
                    setPreview(null);
                  }
                }}
                aria-label="选择原文导入方式"
              >
                <ToggleGroupItem value="upload">上传本地文件 / 文件夹</ToggleGroupItem>
                <ToggleGroupItem value="workspace">本书目录文件</ToggleGroupItem>
                <ToggleGroupItem value="paste">粘贴原文</ToggleGroupItem>
              </ToggleGroup>

              {sourceKind === "upload" && (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  className={`rounded-xl border border-dashed p-4 text-center transition-colors ${
                    dragOver ? "border-primary bg-primary/8" : "border-border bg-muted/25"
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.md,.markdown,.text,.epub,.docx,text/plain,text/markdown,application/epub+zip,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    multiple
                    className="hidden"
                    aria-label="选择本地小说文件"
                    onChange={handleFileChange}
                  />
                  <input
                    ref={(el) => {
                      folderInputRef.current = el;
                      el?.setAttribute("webkitdirectory", "");
                    }}
                    type="file"
                    multiple
                    className="hidden"
                    aria-label="选择章节文件夹"
                    onChange={handleFileChange}
                  />
                  <FileUp className="mx-auto size-6 text-primary/80" />
                  <p className="mt-2 text-xs font-medium text-foreground">
                    拖入小说文件到此处，或点击下方按钮选择
                  </p>
                  <p className="mt-0.5 text-2xs text-muted-foreground">
                    支持单本 TXT / MD / EPUB / DOCX（上限 60MB），或包含多章文本的文件夹
                  </p>
                  <div className="mt-3 flex flex-wrap justify-center gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                      选择本地文件
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => folderInputRef.current?.click()}>
                      选择章节文件夹
                    </Button>
                  </div>
                  {uploadedFiles.length > 0 && (
                    <p className="mt-2.5 text-xs text-primary">
                      {uploadedFiles.length === 1
                        ? `已选：${uploadedFiles[0]!.name}（${formatSize(uploadedFiles[0]!.size)}）`
                        : `已选 ${uploadedFiles.length} 个文件（总计 ${formatSize(uploadedFiles.reduce((s, f) => s + f.size, 0))}）`}
                    </p>
                  )}
                </div>
              )}

              {sourceKind === "workspace" && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="dissect-source" className="text-xs text-muted-foreground">
                    选择当前作品目录下的参考原文
                  </Label>
                  <select
                    id="dissect-source"
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                    value={source}
                    onChange={(event) => {
                      setSource(event.target.value);
                      setPreview(null);
                      if (!title.trim() && event.target.value) {
                        setTitle(stripExt(event.target.value.split("/").pop() ?? event.target.value));
                      }
                    }}
                  >
                    <option value="">请选择本书目录下的文件…</option>
                    {library?.referenceFiles.map((file) => (
                      <option key={file.path} value={file.path}>
                        {file.title}（{formatSize(file.bytes)}）
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {sourceKind === "paste" && (
                <Textarea
                  aria-label="粘贴参考原文"
                  rows={6}
                  value={text}
                  onChange={(event) => {
                    setText(event.target.value);
                    setPreview(null);
                  }}
                  placeholder="粘贴带「第 N 章」或「Chapter N」标题的原文…"
                />
              )}
            </div>

            {/* 分章规则与实时预览校准 */}
            <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-44 flex-1">
                  <Label htmlFor="dissect-split-pattern" className="text-xs">
                    分章正则（留空自动识别「第N章 / 第N回 / Chapter N」）
                  </Label>
                  <Input
                    id="dissect-split-pattern"
                    className="mt-1 h-8 text-xs"
                    value={splitPattern}
                    onChange={(e) => setSplitPattern(e.target.value)}
                    placeholder="例如：^【第.+?章】.*$"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8"
                  disabled={previewBusy || (sourceKind === "upload" ? uploadedFiles.length === 0 : sourceKind === "workspace" ? !source : !text.trim())}
                  onClick={() => void runPreview()}
                >
                  {previewBusy ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : <Eye className="mr-1 size-3.5" />}
                  预览分章
                </Button>
              </div>

              {preview && (
                <div className="space-y-2 pt-1">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-medium text-foreground">
                      共切出 {preview.totalChapters} 章 · {preview.totalWords.toLocaleString("zh-CN")} 字（{encodingLabel(preview.encoding)}）
                    </span>
                  </div>
                  {preview.warnings.map((w) => (
                    <p key={w} className="rounded bg-destructive/10 px-2.5 py-1.5 text-2xs text-destructive">
                      {w}
                    </p>
                  ))}
                  <div className="max-h-40 divide-y divide-border/50 overflow-y-auto rounded-md border border-border bg-background">
                    {preview.chapters.slice(0, 30).map((ch) => (
                      <div key={ch.number} className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-2xs">
                        <span className="truncate font-medium text-foreground">
                          第{ch.number}章 · {ch.title}
                        </span>
                        <span className={`shrink-0 ${ch.empty ? "text-destructive" : "text-muted-foreground"}`}>
                          {ch.words} 字
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 选章范围与模型深度设置 */}
            <fieldset className="flex flex-col gap-2.5 rounded-lg border border-border p-3">
              <legend className="px-1 text-xs font-medium">精拆范围与模式</legend>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-pressed={selection.preset === "first3"}
                  onClick={() => setSelection({ preset: "first3" })}
                >
                  黄金 3 章
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-pressed={selection.preset === "first5"}
                  onClick={() => setSelection({ preset: "first5" })}
                >
                  前 5 章
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-pressed={selection.preset === "first10"}
                  onClick={() => setSelection({ preset: "first10" })}
                >
                  前 10 章
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSelection(nextDissectSelection(selection))}
                >
                  向后增选 10 章
                </Button>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">区间：第</span>
                <Input
                  aria-label="起始章"
                  className="h-8 w-20 text-xs"
                  type="number"
                  min={1}
                  value={selection.preset === "range" ? selection.from ?? 1 : 1}
                  onChange={(event) =>
                    setSelection({ preset: "range", from: Number(event.target.value), to: selection.to ?? 10 })
                  }
                />
                <span>—</span>
                <Input
                  aria-label="结束章"
                  className="h-8 w-20 text-xs"
                  type="number"
                  min={1}
                  value={
                    selection.preset === "first3"
                      ? 3
                      : selection.preset === "first5"
                        ? 5
                        : selection.preset === "first10"
                          ? 10
                          : selection.to ?? 10
                  }
                  onChange={(event) =>
                    setSelection({
                      preset: "range",
                      from: selection.from ?? 1,
                      to: Number(event.target.value),
                    })
                  }
                />
                <span className="text-muted-foreground">章</span>
              </div>

              <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="dissect-template" className="text-xs">
                    拆书模板
                  </Label>
                  <select
                    id="dissect-template"
                    value={template}
                    onChange={(event) => setTemplate(event.target.value as typeof template)}
                    className="h-8 rounded-md border border-input bg-background px-2.5 text-xs"
                  >
                    <option value="full">黄金拆书全套（结构+章纲+技法）</option>
                    <option value="chapter-outline">拆细纲章纲</option>
                    <option value="opening">黄金开篇点评</option>
                    <option value="rhythm-hooks">节奏与钩子评估</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">精拆粒度</Label>
                  <ToggleGroup
                    value={[mode]}
                    onValueChange={(value) => {
                      if (value[0]) setMode(value[0] as typeof mode);
                    }}
                    aria-label="拆书模式"
                  >
                    <ToggleGroupItem value="per-chapter" className="h-8 flex-1 text-xs">
                      逐章细拆
                    </ToggleGroupItem>
                    <ToggleGroupItem value="merged" className="h-8 flex-1 text-xs">
                      合并整批
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>
              </div>

              <label className="mt-1 flex items-center gap-2 text-xs text-foreground">
                <input
                  type="checkbox"
                  checked={useModel}
                  onChange={(event) => setUseModel(event.target.checked)}
                />
                <span>同时调用设置中的默认模型，对选中章节做深度语义精拆</span>
              </label>
            </fieldset>

            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" className="flex-1" disabled={busy || !canSubmitBuild}>
                {busy && <Loader2 className="mr-1.5 size-4 animate-spin" />}
                {busy ? "正在建库拆解…" : useModel ? "建库并模型精拆" : "建立完整拆书工作台"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy || !canSubmitBuild}
                onClick={() => void build(true)}
              >
                全书秒建扫描库
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
    </section>
  );
}
