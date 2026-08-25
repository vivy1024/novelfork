import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Crosshair,
  GitFork,
  History,
  ListTree,
  Loader2,
  RefreshCw,
  ScrollText,
  X,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchJson } from "@/hooks/use-api";
import { normalizeCategory } from "../../engine/jingwei/unified-categories.js";

import { JingweiEntryEditor } from "./JingweiEntryEditor";
import type { JingweiEntryData, JingweiEntrySavePayload } from "./JingweiEntryEditor";
import { DevelopmentTimelineView } from "./development-timeline";
import type { StoryMapNodeData } from "./StoryMapCanvas";

/** 故事地图体量大（React Flow），懒加载避免拖慢画布首帧。 */
const StoryMapCanvas = lazy(() =>
  import("./StoryMapCanvas").then((m) => ({ default: m.StoryMapCanvas })),
);

// ─── 视图定义 ─────────────────────────────────────────────────────────────

/**
 * 故事推进大屏画布的三种视图：
 * - outline   大纲总览：静态设定（卷纲条目）全屏主从编辑
 * - map       故事地图：剧情节点关系 DAG 全屏缩放/拖拽
 * - evolution 发展历程：动态已发生事件 + 关系演化五主题图谱
 */
export type StoryProgressionView = "outline" | "map" | "evolution";

export interface StoryProgressionViewDef {
  readonly id: StoryProgressionView;
  readonly label: string;
  readonly description: string;
  readonly icon: LucideIcon;
}

export const STORY_PROGRESSION_VIEWS: readonly StoryProgressionViewDef[] = [
  { id: "outline", label: "大纲总览", description: "静态大纲设定 · 全屏编辑", icon: ListTree },
  { id: "map", label: "故事地图", description: "剧情节点关系图 · 自由缩放拖拽", icon: GitFork },
  { id: "evolution", label: "发展历程", description: "动态事件与角色演化图谱", icon: History },
] as const;

export function isStoryProgressionView(value: unknown): value is StoryProgressionView {
  return value === "outline" || value === "map" || value === "evolution";
}

// ─── Props ────────────────────────────────────────────────────────────────

export interface StoryProgressionCanvasProps {
  readonly bookId: string;
  /** 初始视图；外部再次变更时会同步切换内部视图（侧栏跳转入口）。 */
  readonly initialView?: StoryProgressionView;
  /** 当前写作章节号（由宿主透传，用于徽标与发展历程定位）。 */
  readonly currentChapter?: number;
  readonly runtimeFetch?: (input: string, init?: RequestInit) => Promise<unknown>;
  /** 地图节点点击 → 跳转打开对应章节（与写作主面板协同）。 */
  readonly onOpenChapter?: (chapterNumber: number) => void;
  /** 地图大纲节点 → 提升为正式大纲条目。 */
  readonly onPromoteOutlineNode?: (node: StoryMapNodeData) => void;
  /** 发展历程节点点击 → 打开实体详情抽屉；带 entryId 时宿主可直接跳角色卡。 */
  readonly onOpenEntityDetail?: (entity: string, entryId?: string) => void;
  /**
   * 大纲条目保存通道。宿主（WorkbenchCanvas）传入 jingweiActions.onSave，
   * 会同时刷新资源树；未提供时回落到内置 REST PUT。
   */
  readonly onSaveEntry?: (entryId: string, payload: JingweiEntrySavePayload) => Promise<void>;
}

// ─── 大纲数据装载 ─────────────────────────────────────────────────────────

interface OutlineApiRecord {
  id?: string;
  title?: string;
  contentMd?: string;
  content_md?: string;
  category?: string;
  fields?: Record<string, unknown>;
  priorityTier?: string;
  priority_tier?: string;
  status?: string;
  layer?: string;
  version?: number;
  aliases?: unknown;
  visibility?: string;
  visibleAfterChapter?: number | null;
  visibleUntilChapter?: number | null;
  parentId?: string | null;
  relatedEntryIds?: unknown;
  updatedAt?: string;
  updated_at?: string;
  sectionId?: string;
}

function unwrapRows(payload: unknown): OutlineApiRecord[] {
  if (Array.isArray(payload)) return payload as OutlineApiRecord[];
  if (!payload || typeof payload !== "object") return [];
  const obj = payload as Record<string, unknown>;
  for (const key of ["data", "entries", "items", "rows"]) {
    const value = obj[key];
    if (Array.isArray(value)) return value as OutlineApiRecord[];
  }
  return [];
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function normalizeOutlineEntry(row: OutlineApiRecord): JingweiEntryData {
  const normalized = normalizeCategory(String(row.category ?? ""));
  return {
    id: String(row.id ?? ""),
    title: String(row.title ?? "未命名大纲"),
    contentMd: String(row.contentMd ?? row.content_md ?? ""),
    category: normalized?.category ?? "outline",
    fields: row.fields ?? {},
    priorityTier: (row.priorityTier ?? row.priority_tier) as JingweiEntryData["priorityTier"],
    status: row.status,
    layer: row.layer,
    version: row.version,
    aliases: toStringArray(row.aliases),
    visibility: (row.visibility as JingweiEntryData["visibility"]) ?? "global",
    visibleAfterChapter: row.visibleAfterChapter ?? null,
    visibleUntilChapter: row.visibleUntilChapter ?? null,
    parentId: row.parentId ?? null,
    relatedEntryIds: toStringArray(row.relatedEntryIds),
    updatedAt: row.updatedAt,
    sectionId: row.sectionId,
  };
}

function volumeNumberOf(entry: JingweiEntryData): number {
  const raw = entry.fields?.["volumeNumber"];
  const num = typeof raw === "string" ? Number(raw) : raw;
  return typeof num === "number" && Number.isFinite(num) ? num : Number.MAX_SAFE_INTEGER;
}

function byVolumeThenTitle(a: JingweiEntryData, b: JingweiEntryData): number {
  const diff = volumeNumberOf(a) - volumeNumberOf(b);
  if (diff !== 0) return diff;
  return a.title.localeCompare(b.title, "zh-Hans-CN");
}

function entryMatchesFocus(entry: JingweiEntryData, focus: string): boolean {
  const haystack = [entry.title, entry.contentMd, ...(entry.aliases ?? [])].join("\n");
  return haystack.includes(focus);
}

// ─── 主组件 ───────────────────────────────────────────────────────────────

export function StoryProgressionCanvas({
  bookId,
  initialView = "outline",
  currentChapter,
  runtimeFetch,
  onOpenChapter,
  onPromoteOutlineNode,
  onOpenEntityDetail,
  onSaveEntry,
}: StoryProgressionCanvasProps) {
  // 顶层状态管理当前视图；initialView 变化时同步（侧栏跳转同一 tab 换视图）。
  const [view, setView] = useState<StoryProgressionView>(
    isStoryProgressionView(initialView) ? initialView : "outline",
  );
  useEffect(() => {
    if (isStoryProgressionView(initialView)) setView(initialView);
  }, [initialView]);

  // 聚焦实体（标签栏）：作用于大纲过滤与发展历程图谱聚焦。
  const [focusInput, setFocusInput] = useState("");
  const [appliedFocus, setAppliedFocus] = useState("");
  const applyFocus = useCallback(() => {
    setAppliedFocus(focusInput.trim());
  }, [focusInput]);

  // 大纲条目数据。
  const [outlineEntries, setOutlineEntries] = useState<JingweiEntryData[]>([]);
  const [outlineLoading, setOutlineLoading] = useState(false);
  const [outlineError, setOutlineError] = useState<string | null>(null);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);

  const loadOutline = useCallback(async () => {
    if (!bookId) return;
    setOutlineLoading(true);
    setOutlineError(null);
    try {
      const endpoint = `/api/books/${encodeURIComponent(bookId)}/jingwei/entries`;
      const payload = runtimeFetch
        ? await runtimeFetch(endpoint, { method: "GET" })
        : await fetchJson<unknown>(endpoint);
      const outlines = unwrapRows(payload)
        .filter((row) => normalizeCategory(String(row.category ?? ""))?.category === "outline")
        .map(normalizeOutlineEntry)
        .filter((entry) => entry.id);
      outlines.sort(byVolumeThenTitle);
      setOutlineEntries(outlines);
    } catch (error) {
      setOutlineError(error instanceof Error ? error.message : "加载大纲列表失败");
    } finally {
      setOutlineLoading(false);
    }
  }, [bookId, runtimeFetch]);

  useEffect(() => {
    void loadOutline();
  }, [loadOutline]);

  /** 过滤逻辑 useMemo：聚焦实体命中标题/正文/别名才保留。 */
  const filteredOutline = useMemo(
    () => (appliedFocus ? outlineEntries.filter((e) => entryMatchesFocus(e, appliedFocus)) : outlineEntries),
    [appliedFocus, outlineEntries],
  );

  const selectedEntry = useMemo(
    () => filteredOutline.find((entry) => entry.id === selectedEntryId) ?? filteredOutline[0] ?? null,
    [filteredOutline, selectedEntryId],
  );

  /** 快捷预设 chips：取前若干条大纲标题，一键聚焦。 */
  const focusPresets = useMemo(
    () => outlineEntries.slice(0, 5).map((entry) => ({ id: entry.id, title: entry.title })),
    [outlineEntries],
  );

  /** 大纲保存：优先走宿主通道（会刷新资源树），否则内置 REST 回落；成功后重载列表。 */
  const saveOutlineEntry = useCallback(
    async (entryId: string, payload: JingweiEntrySavePayload) => {
      if (onSaveEntry) {
        await onSaveEntry(entryId, payload);
      } else {
        await fetchJson(
          `/api/books/${encodeURIComponent(bookId)}/jingwei/entries/${encodeURIComponent(entryId)}`,
          { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
        );
      }
      await loadOutline();
    },
    [bookId, loadOutline, onSaveEntry],
  );

  const relatedTitles = useMemo(() => {
    if (!selectedEntry) return [] as { id: string; title: string }[];
    return (selectedEntry.relatedEntryIds ?? [])
      .map((id) => outlineEntries.find((entry) => entry.id === id))
      .filter((entry): entry is JingweiEntryData => Boolean(entry))
      .map((entry) => ({ id: entry.id, title: entry.title }));
  }, [outlineEntries, selectedEntry]);

  // ── 视图渲染 ────────────────────────────────────────────────────────────

  if (!bookId) {
    return (
      <div className="flex h-full min-h-[80vh] flex-col items-center justify-center gap-2 text-sm text-muted-foreground" data-testid="story-progression-canvas">
        <AlertCircle className="h-8 w-8 text-muted-foreground/60" />
        <p>尚未绑定书籍，无法打开故事推进画布。</p>
        <p className="text-xs">请先在左侧选择一本书籍。</p>
      </div>
    );
  }

  const renderOutlineView = () => (
    <div className="flex h-full min-h-[80vh] gap-2" data-testid="story-progression-outline">
      <aside className="flex w-64 shrink-0 flex-col rounded-md border bg-card" aria-label="大纲条目列表">
        <div className="flex items-center justify-between border-b px-3 py-2 text-xs font-medium text-muted-foreground">
          <span>大纲条目</span>
          <Badge variant="outline">{filteredOutline.length}</Badge>
        </div>
        <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
          {outlineLoading && (
            <li className="flex items-center gap-2 px-2 py-4 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> 正在加载大纲…
            </li>
          )}
          {!outlineLoading && outlineError && (
            <li className="space-y-2 px-2 py-4 text-xs">
              <p className="flex items-start gap-1 text-destructive">
                <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" /> {outlineError}
              </p>
              <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => void loadOutline()}>
                <RefreshCw className="mr-1 h-3 w-3" /> 重试
              </Button>
            </li>
          )}
          {!outlineLoading && !outlineError && filteredOutline.length === 0 && (
            <li className="px-2 py-6 text-center text-xs leading-relaxed text-muted-foreground">
              {appliedFocus ? (
                <>没有匹配「{appliedFocus}」的大纲条目。<br /></>
              ) : null}
              本书还没有卷纲条目。可在侧栏「章节与大纲」中新建，
              或让叙述者通过 lore.write 生成。
            </li>
          )}
          {filteredOutline.map((entry) => {
            const volumeNumber = entry.fields?.["volumeNumber"];
            const goal = entry.fields?.["goal"];
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => setSelectedEntryId(entry.id)}
                  aria-current={selectedEntry?.id === entry.id}
                  className={
                    "w-full rounded px-2 py-1.5 text-left transition-colors " +
                    (selectedEntry?.id === entry.id
                      ? "bg-emerald-600/10 ring-1 ring-emerald-600/40"
                      : "hover:bg-muted/70")
                  }
                >
                  <span className="block truncate text-xs font-medium">{entry.title}</span>
                  {(volumeNumber !== undefined || typeof goal === "string") && (
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {volumeNumber !== undefined ? `第 ${String(volumeNumber)} 卷` : ""}
                      {typeof goal === "string" ? `${volumeNumber !== undefined ? " · " : ""}${goal}` : ""}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </aside>
      <div className="min-w-0 flex-1 overflow-y-auto rounded-md border bg-card p-3">
        {selectedEntry ? (
          <JingweiEntryEditor
            key={selectedEntry.id}
            entry={selectedEntry}
            bookId={bookId}
            sectionLabel="卷纲"
            sourceLabel="故事画布 · 大纲总览"
            onSave={saveOutlineEntry}
            relatedEntries={relatedTitles}
          />
        ) : (
          !outlineLoading &&
          !outlineError && (
            <div className="flex h-full flex-col items-center justify-center gap-1 text-xs text-muted-foreground">
              <ListTree className="mb-1 h-6 w-6 opacity-50" />
              从左侧选择一条大纲开始全屏编辑。
            </div>
          )
        )}
      </div>
    </div>
  );

  const renderMapView = () => (
    <div className="h-full min-h-[80vh]" data-testid="story-progression-map">
      <Suspense
        fallback={
          <div className="flex h-full min-h-[80vh] items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> 正在加载故事地图…
          </div>
        }
      >
        {/* 只读画布：节点可拖拽/缩放/点击跳章，但停用连线手柄等写操作 */}
        <StoryMapCanvas
          bookId={bookId}
          runtimeFetch={runtimeFetch}
          onOpenChapter={onOpenChapter}
          onPromote={onPromoteOutlineNode}
        />
      </Suspense>
    </div>
  );

  const renderEvolutionView = () => (
    <div className="h-full min-h-[80vh]" data-testid="story-progression-evolution">
      {/* key 绑定聚焦实体：切换聚焦时重建工作区以应用 initialFocusEntity */}
      <DevelopmentTimelineView
        key={`evolution:${appliedFocus || "all"}`}
        bookId={bookId}
        currentChapter={currentChapter}
        frameClassName="h-full min-h-[80vh]"
        initialFocusEntity={appliedFocus || undefined}
        onOpenEntityDetail={onOpenEntityDetail}
      />
    </div>
  );

  return (
    <section className="flex h-full min-h-0 flex-col" data-testid="story-progression-canvas">
      <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <ScrollText className="h-4 w-4 text-emerald-600" />
          <span className="text-sm font-semibold">故事画布</span>
          <Badge variant="outline" data-testid="story-progression-chapter-badge">
            第 {currentChapter ?? "?"} 章
          </Badge>
        </div>
        <nav
          className="flex items-center gap-1 rounded-md bg-muted/60 p-1"
          role="tablist"
          aria-label="故事画布视图切换"
        >
          {STORY_PROGRESSION_VIEWS.map((def) => {
            const Icon = def.icon;
            const active = view === def.id;
            return (
              <button
                key={def.id}
                type="button"
                role="tab"
                aria-selected={active}
                title={def.description}
                onClick={() => setView(def.id)}
                className={
                  "flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors " +
                  (active ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground")
                }
              >
                <Icon className="h-3 w-3" /> {def.label}
              </button>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <Input
            value={focusInput}
            onChange={(event) => setFocusInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") applyFocus();
            }}
            placeholder="聚焦实体（角色 / 卷）"
            aria-label="聚焦实体"
            className="h-7 w-44 text-xs"
          />
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={applyFocus} disabled={!focusInput.trim()}>
            <Crosshair className="mr-1 h-3 w-3" /> 聚焦
          </Button>
          {appliedFocus && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => {
                setAppliedFocus("");
                setFocusInput("");
              }}
            >
              <X className="mr-1 h-3 w-3" /> 清除
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            title="刷新大纲列表"
            aria-label="刷新大纲列表"
            onClick={() => void loadOutline()}
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
      </header>

      {view !== "map" && focusPresets.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 border-b px-3 py-1.5" aria-label="快速聚焦预设">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">快捷聚焦</span>
          {focusPresets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                setFocusInput(preset.title);
                setAppliedFocus(preset.title);
              }}
              className={
                "rounded-full border px-2 py-0.5 text-[10px] transition-colors " +
                (appliedFocus === preset.title
                  ? "border-emerald-600/50 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400"
                  : "text-muted-foreground hover:bg-muted")
              }
            >
              {preset.title}
            </button>
          ))}
        </div>
      )}

      {/* 流视图高度标准：各视图统一 h-full + 80vh 下限；滚动收敛在视图体内 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {view === "outline" ? renderOutlineView() : view === "map" ? renderMapView() : renderEvolutionView()}
      </div>
    </section>
  );
}

export default StoryProgressionCanvas;
