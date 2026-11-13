/**
 * 书卷编年史时间线（ChronicleEditorialTimeline）
 *
 * 替代原有的「发展历程」思维导图树枝视图：
 * - 顶部工具条：关键词搜索（搜人物/事件/原文）、事件类型筛选胶囊（全部 / 剧情转折 / 状态跃迁 / 伏笔线索 / 人物关系）、
 *   出场高频人物快捷筛选标签、展开/收起全部章节。
 * - 双栏书卷年表排版（max-w-4xl mx-auto 居中阅读宽 + 左侧贯穿细线时间轴）：
 *   每个章节为清晰的纪事锚点段（粘性章号徽章 + 章节标题/故事时间 + 事件数 + 右上角极克制查看原章小图标）；
 *   章内事件智能清洗机器拼串（人物胶囊高亮 + 连续重复词自动去重 + 完整可读叙述句不截断），
 *   右侧配柔和语义小标签，点击带证据/详情的卡片优雅展开引用块。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  ExternalLink,
  Quote,
  ScrollText,
  Search,
  UserRound,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TimelineEventInput, WrittenChapterInput } from "../../engine/narrative-taxonomy/canonical-trees";
import type { TreeEntryInput } from "../../engine/narrative-taxonomy/story-tree";

export type EditorialEventBucket = "all" | "turning" | "state" | "hook" | "relation";

export interface EditorialFilterDef {
  readonly id: EditorialEventBucket;
  readonly label: string;
}

export const EDITORIAL_EVENT_FILTERS: readonly EditorialFilterDef[] = [
  { id: "all", label: "全部" },
  { id: "turning", label: "剧情转折" },
  { id: "state", label: "状态跃迁" },
  { id: "hook", label: "伏笔线索" },
  { id: "relation", label: "人物关系" },
] as const;

export interface ChronicleEditorialTimelineProps {
  readonly events: readonly TimelineEventInput[];
  readonly entries?: readonly TreeEntryInput[];
  readonly writtenChapters?: readonly WrittenChapterInput[];
  /** 外部联动搜索词（可选，若不传则内部自管）。 */
  readonly initialQuery?: string;
  readonly onOpenChapter?: (chapterNumber: number) => void;
  readonly onOpenEntry?: (entryId: string, label: string) => void;
  readonly className?: string;
}

export interface CleanedEditorialEvent {
  readonly id: string;
  readonly chapterNumber: number;
  readonly subject: string;
  readonly subjectEntryId?: string;
  readonly narrativeText: string;
  readonly bucket: Exclude<EditorialEventBucket, "all">;
  readonly badgeLabel: string;
  readonly evidenceText?: string;
  readonly highRisk: boolean;
}

interface ChapterSection {
  readonly chapterNumber: number;
  readonly title?: string;
  readonly storyTime?: string;
  readonly summaryText?: string;
  readonly events: readonly CleanedEditorialEvent[];
}

function cleanStr(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
}

function parseChapterNumber(value: unknown): number | undefined {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isInteger(num) && num > 0 ? num : undefined;
}

function chapterFromEntryTitle(title: string | undefined): number | undefined {
  if (!title) return undefined;
  const match = /第\s*(\d+)\s*章/u.exec(title);
  return match ? parseChapterNumber(match[1]) : undefined;
}

/**
 * 智能清理机器三元组拼串中的连续重复词与冗余主语前缀：
 * 例如 predicate="决定" + object="决定用修真炉炼丹" → "决定用修真炉炼丹"
 * 例如 subject="薛行之" + predicate="薛行之接手" + object="异常档案" → subject="薛行之", narrative="接手异常档案"
 * 例如末尾带机器孤立章号后缀 "… · 1" 自动剥离。
 */
export function cleanEventNarrative(input: {
  readonly subject?: string;
  readonly predicate?: string;
  readonly object?: string;
  readonly eventType?: string;
}): { readonly subject: string; readonly narrativeText: string } {
  const subject = cleanStr(input.subject);
  let predicate = cleanStr(input.predicate).replace(/\s*·\s*\d+$/u, "");
  let object = cleanStr(input.object).replace(/\s*·\s*\d+$/u, "");

  // 若 predicate 开头重复了 subject，剥掉重复主语
  if (subject && predicate.startsWith(subject) && predicate.length > subject.length) {
    predicate = predicate.slice(subject.length).trim();
  }
  // 若 object 开头重复了 subject（且没有 predicate 或紧跟主语），剥掉重复主语
  if (subject && !predicate && object.startsWith(subject) && object.length > subject.length) {
    object = object.slice(subject.length).trim();
  }

  // 去重连续重复谓词：如 predicate="决定", object="决定用修为压制" -> 只留 object
  if (predicate && object) {
    if (object === predicate) {
      object = "";
    } else if (object.startsWith(predicate)) {
      predicate = "";
    } else if (predicate.endsWith(object)) {
      object = "";
    } else {
      // 处理相邻重复词（如 predicate="前往 灵科院", object="灵科院西京分院"）
      const maxOverlap = Math.min(predicate.length, object.length);
      for (let len = maxOverlap; len >= 2; len -= 1) {
        if (predicate.endsWith(object.slice(0, len))) {
          object = object.slice(len).trim();
          break;
        }
      }
    }
  }

  // 组装自然可读叙述句：中文词组间如果是纯汉字动词短语，用极轻空格或直接自然衔接，避免生硬乱码符号
  let combined = "";
  if (predicate && object) {
    const needsSpace = /[a-zA-Z0-9]$/u.test(predicate) && /^[a-zA-Z0-9]/u.test(object);
    combined = needsSpace ? `${predicate} ${object}` : `${predicate}${object.startsWith("：") || object.startsWith(":") ? object : ` ${object}`}`;
  } else {
    combined = predicate || object;
  }

  // 进一步清理连续完全相同的词组（如 "决定 决定用" 或 "突破 突破筑基"）
  combined = combined
    .replace(/([\p{Script=Han}]{1,6})\s+\1/gu, "$1")
    .replace(/([\p{Script=Han}]{2,6})\1/gu, "$1")
    .trim();

  if (!combined) {
    combined = humanizeEventTypeFallback(input.eventType);
  }

  return { subject, narrativeText: combined };
}

function humanizeEventTypeFallback(eventType?: string): string {
  switch (cleanStr(eventType)) {
    case "character_state_changed":
      return "人物状态发生变化";
    case "relationship_changed":
      return "人物关系发生变化";
    case "hook_planted":
      return "埋下新伏笔线索";
    case "hook_progressed":
      return "伏笔线索有所推进";
    case "hook_resolved":
    case "hook_paid_off":
      return "伏笔线索得以回收";
    case "location_changed":
      return "所处位置发生转移";
    case "timeline_advanced":
      return "故事时间向前推进";
    case "conflict_changed":
      return "核心矛盾局势变化";
    case "world_fact_changed":
      return "世界局势或规则变动";
    default:
      return "发生关键叙事推进";
  }
}

export function classifyEditorialEvent(event: TimelineEventInput): {
  readonly bucket: Exclude<EditorialEventBucket, "all">;
  readonly badgeLabel: string;
} {
  const type = cleanStr(event.eventType).toLowerCase();
  const risk = cleanStr(event.riskLevel).toLowerCase();
  if (type === "relationship_changed") {
    return { bucket: "relation", badgeLabel: "关系" };
  }
  if (type.startsWith("hook_")) {
    return { bucket: "hook", badgeLabel: "伏笔" };
  }
  if (type === "character_state_changed" || type === "location_changed") {
    return { bucket: "state", badgeLabel: "状态" };
  }
  if (risk === "high" || type === "conflict_changed" || type === "turning_point") {
    return { bucket: "turning", badgeLabel: "事件" };
  }
  return { bucket: "turning", badgeLabel: "事件" };
}

const BADGE_TONE_CLASSES: Record<string, string> = {
  状态: "bg-chart-2/10 text-[color:color-mix(in_srgb,var(--chart-2)_70%,var(--foreground))] border-chart-2/25",
  关系: "bg-chart-3/10 text-[color:color-mix(in_srgb,var(--chart-3)_70%,var(--foreground))] border-chart-3/25",
  伏笔: "bg-chart-4/10 text-[color:color-mix(in_srgb,var(--chart-4)_70%,var(--foreground))] border-chart-4/25",
  事件: "bg-chart-1/10 text-[color:color-mix(in_srgb,var(--chart-1)_70%,var(--foreground))] border-chart-1/25",
};

function stripDuplicateChapterPrefix(rawTitle: string, chapterNumber: number): string {
  return rawTitle
    .replace(new RegExp(`^第\\s*0*${chapterNumber}\\s*章[\\s：:·—\\-]*`, "u"), "")
    .replace(/^摘要$/u, "")
    .trim();
}

export function ChronicleEditorialTimeline({
  events,
  entries = [],
  writtenChapters = [],
  initialQuery = "",
  onOpenChapter,
  onOpenEntry,
  className,
}: ChronicleEditorialTimelineProps) {
  const [query, setQuery] = useState(initialQuery);
  const [bucketFilter, setBucketFilter] = useState<EditorialEventBucket>("all");
  const [characterFilter, setCharacterFilter] = useState<string | null>(null);
  const [collapsedChapters, setCollapsedChapters] = useState<Set<number>>(() => new Set());
  const [expandedCards, setExpandedCards] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  // 提取章节标题、故事时间与章摘要
  const chapterMetaMap = useMemo(() => {
    const map = new Map<number, { title?: string; storyTime?: string; summaryText?: string }>();
    for (const ch of writtenChapters) {
      const num = parseChapterNumber(ch.number);
      if (!num) continue;
      const cleanedTitle = stripDuplicateChapterPrefix(cleanStr(ch.title), num);
      map.set(num, { ...(cleanedTitle ? { title: cleanedTitle } : {}) });
    }
    for (const entry of entries) {
      const cat = cleanStr(entry.category);
      const fields = entry.fields ?? {};
      if (cat === "chapter-summaries") {
        const num = parseChapterNumber(fields.chapterNumber)
          ?? parseChapterNumber(fields.chapter_number)
          ?? chapterFromEntryTitle(entry.title);
        if (!num) continue;
        const prev = map.get(num) ?? {};
        const entryTitleClean = stripDuplicateChapterPrefix(cleanStr(fields.title) || cleanStr(entry.title), num);
        const storyTime = cleanStr(fields.storyTime) || cleanStr(fields.story_time) || cleanStr(fields.timeAnchor);
        const summaryText = cleanStr(entry.summaryMd) || cleanStr(entry.contentMd) || cleanStr(fields.summary);
        map.set(num, {
          title: prev.title || entryTitleClean || undefined,
          ...(storyTime ? { storyTime } : prev.storyTime ? { storyTime: prev.storyTime } : {}),
          ...(summaryText ? { summaryText } : prev.summaryText ? { summaryText: prev.summaryText } : {}),
        });
      } else if (cat === "timeline") {
        const num = parseChapterNumber(fields.chapterNumber) ?? chapterFromEntryTitle(entry.title);
        if (!num) continue;
        const prev = map.get(num) ?? {};
        const anchor = cleanStr(fields.storyTime) || cleanStr(entry.title);
        if (anchor && !prev.storyTime) {
          map.set(num, { ...prev, storyTime: anchor });
        }
      }
    }
    return map;
  }, [entries, writtenChapters]);

  // 清洗全部合法章内事件
  const allCleanedEvents: readonly CleanedEditorialEvent[] = useMemo(() => {
    const list: CleanedEditorialEvent[] = [];
    events.forEach((ev, index) => {
      const chapterNumber = parseChapterNumber(ev.chapterNumber);
      if (!chapterNumber) return;
      const { subject, narrativeText } = cleanEventNarrative(ev);
      const { bucket, badgeLabel } = classifyEditorialEvent(ev);
      const evidenceText = cleanStr(ev.evidenceText);
      const id = cleanStr(ev.id) || `ch-${chapterNumber}-ev-${index}`;
      list.push({
        id,
        chapterNumber,
        subject,
        ...(cleanStr(ev.subjectEntryId) ? { subjectEntryId: cleanStr(ev.subjectEntryId) } : {}),
        narrativeText,
        bucket,
        badgeLabel,
        ...(evidenceText ? { evidenceText } : {}),
        highRisk: cleanStr(ev.riskLevel).toLowerCase() === "high",
      });
    });
    return list;
  }, [events]);

  // 分类计数（用于胶囊）
  const bucketCounts = useMemo(() => {
    const counts = new Map<EditorialEventBucket, number>();
    counts.set("all", allCleanedEvents.length);
    for (const f of EDITORIAL_EVENT_FILTERS) {
      if (f.id !== "all") counts.set(f.id, 0);
    }
    for (const ev of allCleanedEvents) {
      counts.set(ev.bucket, (counts.get(ev.bucket) ?? 0) + 1);
    }
    return counts;
  }, [allCleanedEvents]);

  // 出场高频人物快捷标签（取前 6 位有名字的主体）
  const topCharacters = useMemo(() => {
    const freq = new Map<string, number>();
    for (const ev of allCleanedEvents) {
      if (!ev.subject || ev.subject.length > 10) continue;
      freq.set(ev.subject, (freq.get(ev.subject) ?? 0) + 1);
    }
    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"))
      .slice(0, 6)
      .map(([name, count]) => ({ name, count }));
  }, [allCleanedEvents]);

  // 筛选并按章组装编年史段落
  const chapterSections: readonly ChapterSection[] = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = allCleanedEvents.filter((ev) => {
      if (bucketFilter !== "all" && ev.bucket !== bucketFilter) return false;
      if (characterFilter && ev.subject !== characterFilter && !ev.narrativeText.includes(characterFilter)) return false;
      if (needle) {
        const hitSubject = ev.subject.toLowerCase().includes(needle);
        const hitNarrative = ev.narrativeText.toLowerCase().includes(needle);
        const hitEvidence = ev.evidenceText?.toLowerCase().includes(needle) ?? false;
        const chapterTitle = chapterMetaMap.get(ev.chapterNumber)?.title?.toLowerCase() ?? "";
        if (!hitSubject && !hitNarrative && !hitEvidence && !chapterTitle.includes(needle)) return false;
      }
      return true;
    });

    const byChapter = new Map<number, CleanedEditorialEvent[]>();
    for (const ev of filtered) {
      const bucket = byChapter.get(ev.chapterNumber) ?? [];
      bucket.push(ev);
      byChapter.set(ev.chapterNumber, bucket);
    }

    // 若没有任何事件但有章摘要，仅在未启用事件细分筛选时把带摘要的章作为轻量纪事锚点展示
    const hasFilter = bucketFilter !== "all" || characterFilter !== null || needle.length > 0;
    if (allCleanedEvents.length === 0 && !hasFilter) {
      const summaryChapters = [...chapterMetaMap.entries()]
        .filter(([, meta]) => Boolean(meta.summaryText))
        .sort((a, b) => a[0] - b[0]);
      return summaryChapters.map(([chapterNumber, meta]) => ({
        chapterNumber,
        ...(meta.title ? { title: meta.title } : {}),
        ...(meta.storyTime ? { storyTime: meta.storyTime } : {}),
        ...(meta.summaryText ? { summaryText: meta.summaryText } : {}),
        events: [],
      }));
    }

    return [...byChapter.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([chapterNumber, chEvents]) => {
        const meta = chapterMetaMap.get(chapterNumber);
        return {
          chapterNumber,
          ...(meta?.title ? { title: meta.title } : {}),
          ...(meta?.storyTime ? { storyTime: meta.storyTime } : {}),
          ...(meta?.summaryText ? { summaryText: meta.summaryText } : {}),
          events: chEvents,
        };
      });
  }, [allCleanedEvents, bucketFilter, characterFilter, query, chapterMetaMap]);

  const allChapterNumbers = useMemo(() => chapterSections.map((s) => s.chapterNumber), [chapterSections]);
  const allCollapsed = allChapterNumbers.length > 0 && allChapterNumbers.every((n) => collapsedChapters.has(n));

  const toggleAllChapters = useCallback(() => {
    if (allCollapsed) {
      setCollapsedChapters(new Set());
    } else {
      setCollapsedChapters(new Set(allChapterNumbers));
    }
  }, [allCollapsed, allChapterNumbers]);

  const toggleChapter = useCallback((chapterNumber: number) => {
    setCollapsedChapters((prev) => {
      const next = new Set(prev);
      if (next.has(chapterNumber)) next.delete(chapterNumber);
      else next.add(chapterNumber);
      return next;
    });
  }, []);

  const toggleCardDetail = useCallback((id: string) => {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const isTrulyEmpty = allCleanedEvents.length === 0 && chapterSections.length === 0;

  return (
    <div
      className={`flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-border/70 bg-background ${className ?? ""}`}
      data-testid="chronicle-editorial-timeline"
    >
      {/* 顶部工具条：搜索框 + 事件类型胶囊 + 高频人物标签 + 展开/收起全部 */}
      <div className="shrink-0 space-y-2 border-b border-border/70 bg-card/70 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1 max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" strokeWidth={1.65} />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索人物、事件或原文证据…"
              aria-label="搜索发展历程"
              className="h-7 pl-8 pr-7 text-xs bg-background"
            />
            {query && (
              <button
                type="button"
                aria-label="清空发展历程搜索"
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="发展历程事件类型筛选">
            {EDITORIAL_EVENT_FILTERS.map((filter) => {
              const active = bucketFilter === filter.id;
              const count = bucketCounts.get(filter.id) ?? 0;
              const dimmed = filter.id !== "all" && count === 0;
              return (
                <button
                  key={filter.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  data-testid={`chronicle-filter-${filter.id}`}
                  onClick={() => setBucketFilter(filter.id)}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs transition-colors ${
                    active
                      ? "bg-primary font-medium text-primary-foreground shadow-xs"
                      : dimmed
                        ? "text-muted-foreground/45 hover:text-muted-foreground"
                        : "border border-border/60 bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  }`}
                >
                  <span>{filter.label}</span>
                  <span className="text-2xs tabular-nums opacity-80">{count}</span>
                </button>
              );
            })}
          </div>

          {chapterSections.length > 0 && (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              onClick={toggleAllChapters}
              data-testid="chronicle-toggle-all"
              className="ml-auto h-7 gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {allCollapsed ? <ChevronsUpDown className="size-3.5" strokeWidth={1.65} /> : <ChevronsDownUp className="size-3.5" strokeWidth={1.65} />}
              {allCollapsed ? "展开全部章节" : "收起全部章节"}
            </Button>
          )}
        </div>

        {topCharacters.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5" aria-label="高频出场人物筛选">
            <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground">
              <UserRound className="size-3" strokeWidth={1.6} />
              焦点人物：
            </span>
            {topCharacters.map((char) => {
              const active = characterFilter === char.name;
              return (
                <button
                  key={char.name}
                  type="button"
                  aria-pressed={active}
                  data-testid={`chronicle-char-${char.name}`}
                  onClick={() => setCharacterFilter((cur) => (cur === char.name ? null : char.name))}
                  className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-2xs transition-colors ${
                    active
                      ? "bg-primary/15 font-medium text-primary ring-1 ring-primary/30"
                      : "bg-muted/60 text-foreground/80 hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <span>{char.name}</span>
                  <span className="text-muted-foreground tabular-nums">{char.count}</span>
                </button>
              );
            })}
            {characterFilter && (
              <button
                type="button"
                onClick={() => setCharacterFilter(null)}
                className="text-2xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
              >
                清除人物
              </button>
            )}
          </div>
        )}
      </div>

      {/* 主体编年史滚动视口 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        {isTrulyEmpty ? (
          <div className="mx-auto flex max-w-md flex-col items-center justify-center py-20 text-center" data-testid="chronicle-empty">
            <span className="mb-3 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <ScrollText className="size-5" strokeWidth={1.6} />
            </span>
            <p className="text-sm font-medium text-foreground">尚无编年纪事</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              写完章节并完成章后结算后，关键剧情、人物变迁与伏笔脉络将按章编纂于此。
            </p>
          </div>
        ) : chapterSections.length === 0 ? (
          <div className="mx-auto max-w-md py-16 text-center" data-testid="chronicle-no-match">
            <p className="text-xs text-muted-foreground">当前筛选条件下没有匹配的纪事条目。</p>
          </div>
        ) : (
          <div className="mx-auto max-w-4xl space-y-6">
            {chapterSections.map((section, sectionIdx) => {
              const isCollapsed = collapsedChapters.has(section.chapterNumber);
              const isLastSection = sectionIdx === chapterSections.length - 1;
              return (
                <section
                  key={section.chapterNumber}
                  aria-label={`第 ${section.chapterNumber} 章纪事`}
                  data-testid={`chronicle-chapter-${section.chapterNumber}`}
                  className="relative grid grid-cols-1 gap-3 md:grid-cols-[156px_minmax(0,1fr)] md:gap-6"
                >
                  {/* 左栏：粘性章号徽章 + 章节名 + 故事时间 */}
                  <div className="md:sticky md:top-2 md:self-start">
                    <div className="flex items-center justify-between gap-2 md:flex-col md:items-start md:gap-1">
                      <button
                        type="button"
                        aria-expanded={!isCollapsed}
                        onClick={() => toggleChapter(section.chapterNumber)}
                        className="group inline-flex items-center gap-1.5 text-left"
                      >
                        {isCollapsed ? (
                          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" strokeWidth={1.65} />
                        ) : (
                          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" strokeWidth={1.65} />
                        )}
                        <span className="rounded-md border border-primary/25 bg-primary/[0.08] px-2 py-0.5 text-xs font-semibold tabular-nums text-primary">
                          第 {section.chapterNumber} 章
                        </span>
                        <span className="text-2xs tabular-nums text-muted-foreground">
                          {section.events.length > 0 ? `${section.events.length} 则纪事` : "章面摘要"}
                        </span>
                      </button>

                      {section.title && (
                        <p className="truncate pl-5 text-xs font-medium text-foreground/90 md:w-full" title={section.title}>
                          {section.title}
                        </p>
                      )}
                      {section.storyTime && (
                        <p className="truncate pl-5 text-2xs text-muted-foreground md:w-full" title={section.storyTime}>
                          {section.storyTime}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* 右栏：左侧贯穿细线时间轴 + 暖白纸面卡片列表 */}
                  <div className="relative pl-5">
                    {/* 贯穿细线 */}
                    <span
                      aria-hidden="true"
                      className={`absolute left-1.5 top-2 w-px bg-border ${isLastSection ? "bottom-2" : "-bottom-6"}`}
                    />
                    {/* 章节锚点圆珠 */}
                    <span
                      aria-hidden="true"
                      className="absolute left-[3px] top-2 size-2 rounded-full border-2 border-primary bg-background"
                    />

                    {/* 章节头辅助栏（章摘要导语 + 右上角极克制看原章图标按钮） */}
                    {(section.summaryText || onOpenChapter) && !isCollapsed && (
                      <div className="mb-2.5 flex items-start justify-between gap-2">
                        {section.summaryText ? (
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            {section.summaryText}
                          </p>
                        ) : <span />}
                        {onOpenChapter && (
                          <button
                            type="button"
                            onClick={() => onOpenChapter(section.chapterNumber)}
                            title={`打开第 ${section.chapterNumber} 章原文`}
                            aria-label={`打开第 ${section.chapterNumber} 章原文`}
                            data-testid={`chronicle-open-chapter-${section.chapterNumber}`}
                            className="shrink-0 rounded p-1 text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
                          >
                            <BookOpen className="size-3.5" strokeWidth={1.6} />
                          </button>
                        )}
                      </div>
                    )}

                    {isCollapsed ? (
                      <button
                        type="button"
                        onClick={() => toggleChapter(section.chapterNumber)}
                        className="w-full rounded-lg border border-dashed border-border/70 bg-card/40 px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted/30 hover:text-foreground"
                      >
                        已收起本章 {section.events.length} 则纪事，点击展开
                      </button>
                    ) : (
                      <ol className="space-y-2">
                        {section.events.map((ev) => {
                          const hasEvidence = Boolean(ev.evidenceText);
                          const detailOpen = expandedCards.has(ev.id);
                          const badgeTone = BADGE_TONE_CLASSES[ev.badgeLabel] ?? BADGE_TONE_CLASSES.事件;
                          return (
                            <li key={ev.id} data-testid={`chronicle-event-${ev.id}`} className="relative">
                              <div
                                onClick={hasEvidence ? () => toggleCardDetail(ev.id) : undefined}
                                role={hasEvidence ? "button" : undefined}
                                tabIndex={hasEvidence ? 0 : undefined}
                                onKeyDown={hasEvidence ? (e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    toggleCardDetail(ev.id);
                                  }
                                } : undefined}
                                className={`group rounded-lg border border-border/75 bg-card px-3.5 py-2.5 shadow-2xs transition-colors ${
                                  hasEvidence ? "cursor-pointer hover:border-primary/35 hover:bg-card/95" : ""
                                }`}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0 flex-1 text-sm leading-relaxed text-foreground">
                                    {ev.subject && (
                                      ev.subjectEntryId && onOpenEntry ? (
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            onOpenEntry(ev.subjectEntryId!, ev.subject);
                                          }}
                                          className="mr-1.5 inline-flex items-center gap-0.5 rounded-md border border-primary/25 bg-primary/[0.08] px-1.5 py-0.5 text-xs font-medium text-primary hover:bg-primary/15"
                                        >
                                          {ev.subject}
                                          <ExternalLink className="size-2.5 opacity-70" strokeWidth={1.6} />
                                        </button>
                                      ) : (
                                        <span className="mr-1.5 inline-block rounded-md border border-primary/20 bg-primary/[0.07] px-1.5 py-0.5 text-xs font-medium text-primary">
                                          {ev.subject}
                                        </span>
                                      )
                                    )}
                                    <span className="break-words">{ev.narrativeText}</span>
                                  </div>

                                  <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
                                    {ev.highRisk && (
                                      <Badge variant="outline" className="h-4 border-warning/40 bg-warning/10 px-1.5 text-2xs font-normal text-warning">
                                        关键冲突
                                      </Badge>
                                    )}
                                    <span className={`inline-flex h-5 items-center rounded border px-1.5 text-2xs font-medium ${badgeTone}`}>
                                      {ev.badgeLabel}
                                    </span>
                                    {hasEvidence && (
                                      <Quote
                                        className={`size-3 transition-colors ${detailOpen ? "text-primary" : "text-muted-foreground/55 group-hover:text-muted-foreground"}`}
                                        strokeWidth={1.6}
                                        aria-label="含原文出处"
                                      />
                                    )}
                                  </div>
                                </div>

                                {hasEvidence && detailOpen && (
                                  <blockquote
                                    className="mt-2 border-l-2 border-primary/35 bg-muted/35 px-3 py-2 text-xs leading-relaxed text-muted-foreground"
                                    data-testid={`chronicle-evidence-${ev.id}`}
                                  >
                                    {ev.evidenceText}
                                  </blockquote>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default ChronicleEditorialTimeline;
