/**
 * 「待确认」聚合面板。
 *
 * 六大类「需要作者确认才生效」的产物聚合浏览：
 * - 设定与冲突（人物/设定草稿、机器写入冲突）
 * - 章后事实与关系（本章事件提议、历史事实与关系草案）
 * - 人物与声线（角色声线待审）
 * - 伏笔与剧情线（伏笔草稿、剧情线提议）
 * - 文风与改稿（文风规则、改稿金库）
 *
 * 支持顶部分类筛选胶囊（带计数徽标）、关键词搜索、「按类别分组 / 按章节分组」可折叠抽屉；
 * 剧情线支持就地确认/驳回，其余类型按宿主注入回调跳转对应审阅页。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Loader2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fetchJson } from "@/hooks/use-api";
import {
  PENDING_REVIEW_KINDS,
  PENDING_REVIEW_LABELS,
  type PendingReviewItem,
  type PendingReviewKind,
  type PendingReviewSummary,
  type PendingReviewTarget,
} from "../../routes/pending-review-contract.js";

export type { PendingReviewSummary };
export type PendingReviewFetcher = (bookId: string) => Promise<PendingReviewSummary>;
export type PendingReviewStorylineReviewer = (storylineId: string, decision: "confirmed" | "rejected") => Promise<void>;

export type PendingReviewCategoryId =
  | "all"
  | "lore-conflict"
  | "facts-relations"
  | "voice"
  | "hooks-storyline"
  | "style-revision";

export type PendingReviewGroupMode = "kind" | "chapter";

interface PendingCategoryDef {
  readonly id: Exclude<PendingReviewCategoryId, "all">;
  readonly label: string;
  readonly kinds: readonly PendingReviewKind[];
}

export const PENDING_REVIEW_CATEGORIES: readonly PendingCategoryDef[] = [
  { id: "lore-conflict", label: "设定与冲突", kinds: ["conflict"] },
  { id: "facts-relations", label: "章后事实与关系", kinds: ["event", "fact"] },
  { id: "voice", label: "人物与声线", kinds: ["character", "voice"] },
  { id: "hooks-storyline", label: "伏笔与剧情线", kinds: ["foreshadow", "storyline"] },
  { id: "style-revision", label: "文风与改稿", kinds: ["styleRule", "revision"] },
] as const;

async function fetchPendingReviewSummary(bookId: string): Promise<PendingReviewSummary> {
  return fetchJson<PendingReviewSummary>(`/api/books/${encodeURIComponent(bookId)}/pending-review?limit=20`);
}

async function defaultReviewStoryline(bookId: string, storylineId: string, decision: "confirmed" | "rejected"): Promise<void> {
  await fetchJson(
    `/api/books/${encodeURIComponent(bookId)}/narrative-memory/storylines/${encodeURIComponent(storylineId)}/review`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }) },
  );
}

export interface PendingReviewPanelProps {
  bookId: string;
  /** 测试或宿主替换取数通道；默认走产品 HTTP。 */
  fetchSummary?: PendingReviewFetcher;
  /** 测试或宿主替换剧情线审核通道；默认走产品 HTTP。 */
  reviewStorylineFn?: PendingReviewStorylineReviewer;
  /** 打开经纬条目（角色卡对声线确认、伏笔草稿对条目确认都在条目上）。 */
  onOpenJingweiEntry?: (entryId: string) => void;
  /** 声线确认专用入口；缺省回落到 onOpenJingweiEntry。 */
  onOpenVoiceReview?: (entryId: string) => void;
  /** 文风自动蒸馏工作面（规则逐条审阅）；缺省回落到 onOpenStylePanel。 */
  onOpenDistill?: () => void;
  /** 「技能文风」面板的文风页签。 */
  onOpenStylePanel?: () => void;
  /** 章后事实待确认队列（本章提议、事实与关系草案）。 */
  onOpenEvents?: () => void;
  /** 文风金库（采纳改稿段为范文）；缺省回落到 onOpenChapter。 */
  onOpenVault?: () => void;
  /** 打开指定章节。 */
  onOpenChapter?: (chapterNumber: number) => void;
  /** 嵌入侧栏时的关闭按钮。 */
  onClose?: () => void;
}

interface ResolveAction {
  readonly label: string;
  readonly ariaLabel?: string;
  readonly run?: () => void;
}

function actionLabelForKind(kind: PendingReviewKind): string {
  switch (kind) {
    case "conflict":
    case "character":
    case "foreshadow":
      return "审阅设定";
    case "voice":
      return "审阅声线";
    case "event":
    case "fact":
      return "核对事实";
    case "styleRule":
      return "审阅规则";
    case "revision":
      return "采纳改稿";
    default:
      return "去处理";
  }
}

/** 每行的动作：宿主给哪个回调就走哪个入口；给不了的只展示去哪决定，不伪造可点按钮。 */
function resolveAction(item: PendingReviewItem, props: PendingReviewPanelProps): ResolveAction {
  const buttonText = actionLabelForKind(item.kind);
  const hint = (handler?: () => void): ResolveAction => handler
    ? { label: buttonText, ariaLabel: `去处理：${buttonText}（${item.typeLabel}）`, run: handler }
    : { label: item.resolveAt };
  const target: PendingReviewTarget = item.target;
  switch (target.kind) {
    case "jingwei-entry": {
      const open = item.kind === "voice" && props.onOpenVoiceReview
        ? () => props.onOpenVoiceReview?.(target.entryId)
        : props.onOpenJingweiEntry
          ? () => props.onOpenJingweiEntry?.(target.entryId)
          : undefined;
      return hint(open);
    }
    case "style-panel": {
      const open = props.onOpenDistill ?? props.onOpenStylePanel;
      return hint(open);
    }
    case "events":
      return hint(props.onOpenEvents);
    case "ledger-conflict": {
      const open = props.onOpenJingweiEntry
        ? () => props.onOpenJingweiEntry?.(target.entryId)
        : undefined;
      return hint(open);
    }
    case "vault": {
      const open = props.onOpenVault
        ? props.onOpenVault
        : props.onOpenChapter
          ? () => props.onOpenChapter?.(target.chapterNumber)
          : undefined;
      return hint(open);
    }
    default:
      return { label: item.resolveAt };
  }
}

/** 规范化展示来源位置，把机器括号改成书卷式「角色 · 陆沉」同时保留可读语义。 */
function extractChapterNumber(item: PendingReviewItem): number | null {
  if (item.target.kind === "vault") return item.target.chapterNumber;
  const match = /第\s*(\d+)\s*章/u.exec(item.location);
  if (match) {
    const parsed = Number(match[1]);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function matchesPendingItemQuery(item: PendingReviewItem, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    item.summary.toLowerCase().includes(needle)
    || item.location.toLowerCase().includes(needle)
    || item.typeLabel.toLowerCase().includes(needle)
    || item.resolveAt.toLowerCase().includes(needle)
  );
}

function PendingReviewRow({
  item,
  panelProps,
  onReviewStoryline,
  busy,
}: {
  item: PendingReviewItem;
  panelProps: PendingReviewPanelProps;
  onReviewStoryline: (storylineId: string, decision: "confirmed" | "rejected") => void;
  busy: boolean;
}) {
  if (item.target.kind === "storyline") {
    return (
      <li className="flex items-start gap-2 rounded-md border border-border/70 bg-card px-2.5 py-2 transition-colors hover:border-border">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary" className="h-4 px-1.5 text-2xs font-normal">{item.typeLabel}</Badge>
            <span className="text-2xs font-medium text-muted-foreground">{item.location}</span>
          </div>
          <p className="break-words text-xs leading-relaxed text-foreground">{item.summary}</p>
        </div>
        <div className="mt-0.5 flex shrink-0 gap-1">
          <Button
            size="xs"
            variant="outline"
            className="h-6 px-2 text-2xs"
            disabled={busy}
            onClick={() => onReviewStoryline((item.target as { storylineId: string }).storylineId, "confirmed")}
          >
            确认
          </Button>
          <Button
            size="xs"
            variant="ghost"
            className="h-6 px-2 text-2xs text-muted-foreground hover:text-destructive"
            disabled={busy}
            onClick={() => onReviewStoryline((item.target as { storylineId: string }).storylineId, "rejected")}
          >
            驳回
          </Button>
        </div>
      </li>
    );
  }
  const action = resolveAction(item, panelProps);
  return (
    <li className="flex items-start gap-2 rounded-md border border-border/70 bg-card px-2.5 py-2 transition-colors hover:border-border">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary" className="h-4 px-1.5 text-2xs font-normal">{item.typeLabel}</Badge>
          <span className="text-2xs font-medium text-muted-foreground">{item.location}</span>
        </div>
        <p className="break-words text-xs leading-relaxed text-foreground">{item.summary}</p>
        <p className="text-2xs text-muted-foreground">去哪决定：{item.resolveAt}</p>
      </div>
      {action.run ? (
        <Button
          size="xs"
          variant="outline"
          aria-label={action.ariaLabel}
          className="mt-0.5 h-6 shrink-0 gap-1 px-2 text-2xs"
          onClick={action.run}
        >
          {action.label}
          <ArrowRight className="size-3" strokeWidth={1.65} />
        </Button>
      ) : (
        <span className="mt-0.5 shrink-0 text-2xs text-muted-foreground" title="这个入口在当前面板里打不开">
          {action.label}
        </span>
      )}
    </li>
  );
}

interface DrawerSection {
  readonly id: string;
  readonly label: string;
  readonly badgeText: string;
  readonly items: readonly PendingReviewItem[];
}

export function PendingReviewPanel(props: PendingReviewPanelProps) {
  const { bookId, onClose } = props;
  const fetchSummary = props.fetchSummary ?? fetchPendingReviewSummary;
  const [data, setData] = useState<PendingReviewSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<PendingReviewCategoryId>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [groupMode, setGroupMode] = useState<PendingReviewGroupMode>("kind");
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => new Set());
  const mounted = useRef(false);
  const requestSeq = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; requestSeq.current += 1; };
  }, []);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const summary = await fetchSummary(bookId);
      if (mounted.current && seq === requestSeq.current) setData(summary);
    } catch (cause) {
      if (mounted.current && seq === requestSeq.current) {
        setError(cause instanceof Error ? cause.message : "读取待确认列表失败");
      }
    } finally {
      if (mounted.current && seq === requestSeq.current) setLoading(false);
    }
  }, [bookId, fetchSummary]);

  useEffect(() => { void load(); }, [load]);

  const [reviewBusy, setReviewBusy] = useState(false);
  const reviewFn = props.reviewStorylineFn;
  const reviewStoryline = useCallback(async (storylineId: string, decision: "confirmed" | "rejected") => {
    if (reviewBusy) return;
    setReviewBusy(true);
    setError(null);
    try {
      if (reviewFn) await reviewFn(storylineId, decision);
      else await defaultReviewStoryline(bookId, storylineId, decision);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "剧情线审核失败");
    } finally {
      setReviewBusy(false);
    }
  }, [bookId, load, reviewBusy, reviewFn]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ bookId?: string }>).detail;
      if (!detail?.bookId || detail.bookId === bookId) void load();
    };
    window.addEventListener("novelfork:style-preset-updated", handler);
    return () => window.removeEventListener("novelfork:style-preset-updated", handler);
  }, [bookId, load]);

  const rawGroups = useMemo(
    () => (data ? PENDING_REVIEW_KINDS
      .map((kind) => data.groups.find((group) => group.kind === kind))
      .filter((group): group is NonNullable<typeof group> => Boolean(group))
    : []),
    [data],
  );
  const total = data?.total ?? 0;

  // 各顶层分类的实时计数（基于 group.count 真实总数）
  const categoryPills = useMemo(() => {
    const countByKind = new Map<PendingReviewKind, number>();
    for (const group of rawGroups) {
      countByKind.set(group.kind, group.count);
    }
    const items = PENDING_REVIEW_CATEGORIES.map((cat) => ({
      id: cat.id as PendingReviewCategoryId,
      label: cat.label,
      count: cat.kinds.reduce((sum, kind) => sum + (countByKind.get(kind) ?? 0), 0),
    }));
    return [
      { id: "all" as PendingReviewCategoryId, label: "全部", count: total },
      ...items,
    ];
  }, [rawGroups, total]);

  const allowedKinds = useMemo(() => {
    if (activeCategory === "all") return null;
    const found = PENDING_REVIEW_CATEGORIES.find((cat) => cat.id === activeCategory);
    return found ? new Set<PendingReviewKind>(found.kinds) : null;
  }, [activeCategory]);

  // 过滤后的可折叠抽屉分段（按类别分组 vs 按章节分组）
  const sections: readonly DrawerSection[] = useMemo(() => {
    const filteredGroups = rawGroups
      .filter((group) => group.count > 0 && (!allowedKinds || allowedKinds.has(group.kind)))
      .map((group) => ({
        ...group,
        filteredItems: group.items.filter((item) => matchesPendingItemQuery(item, searchQuery)),
      }))
      .filter((group) => group.filteredItems.length > 0 || (!searchQuery.trim() && group.count > 0));

    if (groupMode === "kind") {
      return filteredGroups.map((group) => ({
        id: `kind:${group.kind}`,
        label: PENDING_REVIEW_LABELS[group.kind],
        badgeText: !searchQuery.trim() && group.filteredItems.length < group.count
          ? `${group.filteredItems.length}/${group.count}`
          : String(searchQuery.trim() ? group.filteredItems.length : group.count),
        items: group.filteredItems,
      }));
    }

    // 按章节分组：带章号的归入「第 N 章」（新章靠前或按章号升序），无章号的归入「全书设定与声线」
    const byChapter = new Map<number, PendingReviewItem[]>();
    const unchaptered: PendingReviewItem[] = [];
    for (const group of filteredGroups) {
      for (const item of group.filteredItems) {
        const chapter = extractChapterNumber(item);
        if (chapter !== null) {
          const bucket = byChapter.get(chapter) ?? [];
          bucket.push(item);
          byChapter.set(chapter, bucket);
        } else {
          unchaptered.push(item);
        }
      }
    }
    const chapterSections: DrawerSection[] = [...byChapter.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([chapter, items]) => ({
        id: `chapter:${chapter}`,
        label: `第 ${chapter} 章`,
        badgeText: String(items.length),
        items,
      }));
    if (unchaptered.length > 0) {
      chapterSections.push({
        id: "chapter:global",
        label: "全书设定与通用项",
        badgeText: String(unchaptered.length),
        items: unchaptered,
      });
    }
    return chapterSections;
  }, [rawGroups, allowedKinds, searchQuery, groupMode]);

  const toggleSection = useCallback((sectionId: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  }, []);

  return (
    <section className="flex h-full flex-col overflow-hidden text-xs" aria-label="待确认聚合面板" data-testid="pending-review-panel">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-2.5 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5 font-medium">
          <ClipboardList className="size-3.5 shrink-0 text-primary" strokeWidth={1.65} />
          <span className="truncate">待确认{data ? ` ${total} 项` : ""}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="xs" onClick={() => void load()} disabled={loading} aria-label="刷新待确认列表">
            <RefreshCw className={`size-3 ${loading ? "animate-spin" : ""}`} strokeWidth={1.65} />
          </Button>
          {onClose && (
            <Button variant="ghost" size="xs" className="text-2xs" onClick={onClose}>收起</Button>
          )}
        </div>
      </div>

      {/* 顶部分类胶囊 + 搜索与分组切换（仅当存在待确认数据时呈现） */}
      {data && total > 0 && (
        <div className="shrink-0 space-y-1.5 border-b border-border/70 bg-muted/20 px-2.5 py-2">
          <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="待确认分类筛选">
            {categoryPills.map((pill) => {
              const active = activeCategory === pill.id;
              const emptyPill = pill.id !== "all" && pill.count === 0;
              return (
                <button
                  key={pill.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveCategory(pill.id)}
                  data-testid={`pending-category-${pill.id}`}
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs transition-colors ${
                    active
                      ? "bg-primary font-medium text-primary-foreground shadow-xs"
                      : emptyPill
                        ? "bg-transparent text-muted-foreground/45 hover:text-muted-foreground"
                        : "bg-background/80 text-muted-foreground hover:bg-muted hover:text-foreground border border-border/60"
                  }`}
                >
                  <span>{pill.label}</span>
                  <span className={`tabular-nums ${active ? "text-primary-foreground/90" : emptyPill ? "text-muted-foreground/40" : "text-foreground/75"}`}>
                    {pill.count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <div className="flex h-6 min-w-[120px] flex-1 items-center gap-1 rounded-md border border-border/80 bg-background px-2">
              <Search className="size-3 shrink-0 text-muted-foreground" strokeWidth={1.65} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.currentTarget.value)}
                placeholder="搜人物、章节或关键词…"
                aria-label="搜索待确认项"
                className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/60"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  aria-label="清空待确认搜索"
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>

            <div className="inline-flex shrink-0 items-center rounded-md border border-border/70 bg-background p-0.5" role="group" aria-label="待确认分组方式">
              <button
                type="button"
                aria-pressed={groupMode === "kind"}
                onClick={() => setGroupMode("kind")}
                className={`rounded px-1.5 py-0.5 text-2xs transition-colors ${
                  groupMode === "kind" ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                按类别分组
              </button>
              <button
                type="button"
                aria-pressed={groupMode === "chapter"}
                onClick={() => setGroupMode("chapter")}
                className={`rounded px-1.5 py-0.5 text-2xs transition-colors ${
                  groupMode === "chapter" ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                按章节分组
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-2.5">
        {error && (
          <p role="alert" className="rounded border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">{error}</p>
        )}

        {loading && !data && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
            <Loader2 className="size-3 animate-spin" />
            正在汇总 {PENDING_REVIEW_KINDS.length} 类待确认来源…
          </p>
        )}

        {data && total === 0 && (
          <div className="space-y-1.5 rounded-md border border-success/20 bg-success/5 p-2.5">
            <p className="flex items-center gap-1 text-xs font-medium text-success">
              <CheckCircle2 className="size-3.5" strokeWidth={1.65} />
              全部确认完
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">{data.explanation}</p>
          </div>
        )}

        {data && data.warnings.length > 0 && (
          <div className="space-y-0.5 rounded-md border border-warning/30 bg-warning/5 p-2">
            {data.warnings.map((warning, index) => (
              <p key={`${warning.code}-${index}`} className="text-xs leading-relaxed text-warning">
                {warning.message}
              </p>
            ))}
          </div>
        )}

        {data && total > 0 && sections.length === 0 && (
          <p className="py-6 text-center text-xs text-muted-foreground">
            当前筛选条件下没有匹配的待确认项。
          </p>
        )}

        {sections.map((section) => {
          const isCollapsed = collapsedSections.has(section.id);
          return (
            <div key={section.id} className="rounded-md border border-border/60 bg-card/40">
              <button
                type="button"
                aria-expanded={!isCollapsed}
                onClick={() => toggleSection(section.id)}
                data-testid={`pending-section-toggle-${section.id}`}
                className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left transition-colors hover:bg-muted/40"
              >
                <span className="flex min-w-0 items-center gap-1 text-2xs font-semibold text-foreground/85">
                  {isCollapsed ? (
                    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.65} />
                  ) : (
                    <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.65} />
                  )}
                  <span className="truncate">{section.label}</span>
                </span>
                <Badge variant="outline" className="h-4 px-1.5 text-2xs tabular-nums">
                  {section.badgeText}
                </Badge>
              </button>
              {!isCollapsed && (
                <ul className="space-y-1.5 border-t border-border/40 p-2">
                  {section.items.map((item) => (
                    <PendingReviewRow
                      key={item.id}
                      item={item}
                      panelProps={props}
                      onReviewStoryline={reviewStoryline}
                      busy={reviewBusy}
                    />
                  ))}
                </ul>
              )}
            </div>
          );
        })}

        {data && total > 0 && (
          <p className="px-0.5 text-2xs leading-relaxed text-muted-foreground">{data.explanation}</p>
        )}
      </div>
    </section>
  );
}
