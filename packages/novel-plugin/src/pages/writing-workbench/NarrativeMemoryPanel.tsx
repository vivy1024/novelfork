import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Brain, ChevronDown, ChevronRight, ExternalLink, Loader2, RefreshCw, Search } from "lucide-react";

import type { WorkbenchResourceNode } from "./useWorkbenchResources";
// 待审事件的取数与审批与写作视图共用一条通道，避免两处审批语义漂移。
import {
  mutatePendingEvent as mutatePendingEventRequest,
  riskLabel,
  type PendingEvent,
} from "./narrative-pending-events";
// 叙事线审批台账与章后结算历史是同一件事的两半：都要能回答「谁在什么时候
// 批了什么」。共用 narrative-line-proposals 这一条通道。
import {
  fetchNarrativeLineApprovals,
  type NarrativeLineApproval,
} from "./narrative-line-proposals";

type ResourceTreeAction = {
  type: "open-side";
  node: WorkbenchResourceNode;
};

interface ChannelSummary {
  channel: string;
  status: string;
  latencyMs?: number;
  candidateCount?: number;
  returnedCount?: number;
  estimatedTokens?: number;
}

interface DiagnosticsSummary {
  purpose: string;
  chapterNumber?: number;
  totalMs?: number;
  totalEstimatedTokens?: number;
  channels?: ChannelSummary[];
  injectedTokensByChannel?: Record<string, number>;
  droppedCount?: number;
  degradedCount?: number;
  warnings?: string[];
  wave?: Record<string, unknown> | null;
}

interface DiagnosticsResponse {
  summary?: DiagnosticsSummary;
}

interface MemoryStats {
  total: number;
  byKind?: { fact?: number; event?: number; log?: number; vector?: number };
  eventStatus?: Record<string, number>;
  pendingEvents?: number;
  latestUpdatedAt?: string;
}

interface MemoryStatsResponse {
  stats?: MemoryStats;
}

interface MemoryEntry {
  kind: "fact" | "event" | "log" | "vector";
  id: string;
  title?: string;
  summary?: string;
  subject?: string;
  predicate?: string;
  object?: string;
  status?: string;
  category?: string;
  eventType?: string;
  layer?: string;
  sourceType?: string;
  sourceId?: string;
  source?: string;
  sourceChapter?: number;
  evidenceText?: string;
  confidence?: number;
  riskLevel?: string;
  chapterNumber?: number;
  validFromChapter?: number;
  validUntilChapter?: number;
  createdAt?: string;
  updatedAt?: string;
  appliedAt?: string;
}

interface MemorySearchResponse {
  entries?: MemoryEntry[];
}

interface MemoryListResponse {
  entries?: MemoryEntry[];
}

interface CurrentLedgerResponse {
  items?: MemoryEntry[];
  facts?: MemoryEntry[];
  counts?: { byCategory?: Record<string, number> };
}

interface NarrativeMemoryPanelProps {
  bookId: string;
  memoryNodes?: WorkbenchResourceNode[];
  selectedNodeId?: string | null;
  onOpen?: (node: WorkbenchResourceNode) => void;
  onAction?: (action: ResourceTreeAction) => void;
}

interface NarrativeMemoryPanelShellProps {
  diagnostics: DiagnosticsSummary | null;
  events: PendingEvent[];
  historyEvents?: MemoryEntry[];
  /** 叙事线的批准/驳回台账，与章后结算历史并列展示。 */
  lineApprovals?: readonly NarrativeLineApproval[];
  stateFacts?: MemoryEntry[];
  stats?: MemoryStats | null;
  searchResults?: MemoryEntry[];
  searchQuery?: string;
  searchLoading?: boolean;
  actionLoadingId?: string | null;
  actionError?: string | null;
  loading?: boolean;
  empty: boolean;
  error: string | null;
  memoryNodes?: WorkbenchResourceNode[];
  selectedNodeId?: string | null;
  onOpen?: (node: WorkbenchResourceNode) => void;
  onAction?: (action: ResourceTreeAction) => void;
  onSearch?: (query: string) => void;
  onApprove?: (event: PendingEvent) => void;
  onReject?: (event: PendingEvent) => void;
  onSearchEntryOpen?: (entry: MemoryEntry) => void;
  onRefresh: () => void;
}

const MEMORY_NAV_ITEMS = [
  "故事状态",
  "结算历史",
  "关系图",
  "时间线",
  "角色弧线",
  "伏笔网络",
  "矛盾地图",
  "事件链",
] as const;

type MemoryViewLabel = typeof MEMORY_NAV_ITEMS[number];

const GRAPH_VIEWS = new Set<MemoryViewLabel>(["关系图", "时间线", "角色弧线", "伏笔网络", "矛盾地图", "事件链"]);

const CATEGORY_LABELS: Record<string, string> = {
  character_state: "角色状态",
  relationship: "关系",
  hook: "伏笔",
  timeline: "时间线",
  location: "地点",
  world_fact: "世界事实",
  conflict: "矛盾",
};

const EVENT_CATEGORY_BY_TYPE: Record<string, string> = {
  character_state_changed: "character_state",
  relationship_changed: "relationship",
  hook_planted: "hook",
  hook_triggered: "hook",
  hook_paid_off: "hook",
  timeline_advanced: "timeline",
  location_changed: "location",
  world_fact_changed: "world_fact",
  conflict_changed: "conflict",
};

function entryCategory(entry: MemoryEntry): string | undefined {
  return entry.category ?? (entry.eventType ? EVENT_CATEGORY_BY_TYPE[entry.eventType] : undefined);
}

function entryCategoryLabel(entry: MemoryEntry): string {
  const category = entryCategory(entry);
  return category ? (CATEGORY_LABELS[category] ?? category) : entry.kind;
}

function formatMs(value?: number) {
  return typeof value === "number" ? `${Math.round(value)}ms` : "—";
}

function formatNumber(value?: number) {
  return typeof value === "number" ? String(value) : "—";
}

function entryTitle(entry: MemoryEntry): string {
  if (entry.title?.trim()) return entry.title.trim();
  const triple = `${entry.subject ?? ""} ${entry.predicate ?? ""} ${entry.object ?? ""}`.trim();
  return triple || entry.id;
}

function entryPredicateText(entry: MemoryEntry): string {
  return `${entry.predicate ?? ""} ${entry.object ?? ""}`.trim();
}

function WaveSummary({ wave }: { wave?: Record<string, unknown> | null }) {
  if (!wave) return null;
  const entries = Object.entries(wave).filter(([, value]) => value !== undefined && value !== null);
  if (entries.length === 0) return null;
  return (
    <div className="space-y-1 text-[11px]">
      {entries.slice(0, 8).map(([key, value]) => (
        <div key={key} className="flex justify-between gap-2">
          <span className="text-muted-foreground">{key}</span>
          <span className="truncate text-right">{Array.isArray(value) ? value.join(", ") : String(value)}</span>
        </div>
      ))}
    </div>
  );
}

function MemoryNodeTree({ nodes, selectedNodeId, onOpen }: { nodes: WorkbenchResourceNode[]; selectedNodeId?: string | null; onOpen?: (node: WorkbenchResourceNode) => void }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(nodes.map((node) => node.id)));
  useEffect(() => {
    setExpanded(new Set(nodes.map((node) => node.id)));
  }, [nodes]);
  const toggle = (node: WorkbenchResourceNode) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(node.id)) next.delete(node.id);
      else next.add(node.id);
      return next;
    });
  };
  const renderNode = (node: WorkbenchResourceNode, depth = 0): ReactNode => {
    const hasChildren = (node.children?.length ?? 0) > 0;
    const isExpanded = expanded.has(node.id);
    const selected = selectedNodeId === node.id;
    return (
      <div key={node.id}>
        <button
          type="button"
          className={`flex w-full items-center gap-1 rounded px-2 py-1 text-left text-[11px] hover:bg-muted ${selected ? "bg-primary/10 text-primary" : ""}`}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          onClick={() => {
            if (hasChildren) toggle(node);
            else onOpen?.(node);
          }}
        >
          {hasChildren ? (isExpanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />) : <span className="w-3" />}
          <span className="truncate">{node.title}</span>
          {node.capabilities.readonly ? <span className="ml-auto rounded bg-muted px-1 text-[9px] text-muted-foreground">只读</span> : null}
        </button>
        {hasChildren && isExpanded ? node.children!.map((child) => renderNode(child, depth + 1)) : null}
      </div>
    );
  };
  return <div className="space-y-0.5">{nodes.map((node) => renderNode(node))}</div>;
}

function StoryStatusSummary({
  stateFacts,
  events,
  historyEvents,
  onOpenFact,
}: {
  stateFacts: MemoryEntry[];
  events: PendingEvent[];
  historyEvents: MemoryEntry[];
  onOpenFact?: (entry: MemoryEntry) => void;
}) {
  const highRiskCount = events.filter((event) => event.risk === "high").length;
  const factPreview = stateFacts.slice(0, 8);
  const grouped = useMemo(() => {
    const buckets = new Map<string, MemoryEntry[]>();
    for (const fact of factPreview) {
      const key = fact.category ?? "other";
      const list = buckets.get(key) ?? [];
      list.push(fact);
      buckets.set(key, list);
    }
    return [...buckets.entries()];
  }, [factPreview]);

  return (
    <section className="rounded-lg border border-border bg-card p-3 space-y-3" data-testid="narrative-memory-story-status">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold">当前故事状态</h3>
        <span className="text-[10px] text-muted-foreground">自动结算 · 作者回看</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded border border-border/60 p-2">
          <div className="text-sm font-semibold tabular-nums">{stateFacts.length}</div>
          <div className="text-[10px] text-muted-foreground">当前事实</div>
        </div>
        <div className="rounded border border-border/60 p-2">
          <div className="text-sm font-semibold tabular-nums">{historyEvents.length}</div>
          <div className="text-[10px] text-muted-foreground">已结算</div>
        </div>
        <div className="rounded border border-border/60 p-2">
          <div className={`text-sm font-semibold tabular-nums ${highRiskCount > 0 ? "text-amber-600" : ""}`}>{highRiskCount}</div>
          <div className="text-[10px] text-muted-foreground">高风险待审</div>
        </div>
      </div>

      {factPreview.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">还没有沉淀动态事实。写完一章后会自动出现角色状态、关系、伏笔等。</p>
      ) : (
        <div className="space-y-2">
          {grouped.map(([category, items]) => (
            <div key={category} className="space-y-1">
              <div className="text-[10px] font-medium text-muted-foreground">{CATEGORY_LABELS[category] ?? category}</div>
              {items.map((fact) => (
                <button
                  key={fact.id}
                  type="button"
                  onClick={() => onOpenFact?.(fact)}
                  className="block w-full rounded border border-border/50 px-2 py-1.5 text-left hover:bg-muted"
                >
                  <div className="truncate text-[11px] font-medium">{entryTitle(fact)}</div>
                  {fact.summary ? <div className="truncate text-[10px] text-muted-foreground">{fact.summary}</div> : null}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function SearchResults({ results, query, loading, onOpen }: { results: MemoryEntry[]; query: string; loading?: boolean; onOpen?: (entry: MemoryEntry) => void }) {
  if (!query) return null;
  return (
    <section className="rounded-lg border border-border bg-card p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-muted-foreground">搜索结果</h3>
        {loading ? <Loader2 className="size-3 animate-spin" /> : <span className="text-[10px] text-muted-foreground">{results.length} 条</span>}
      </div>
      {results.length === 0 && !loading ? (
        <p className="text-[11px] text-muted-foreground">没有匹配的叙事记忆。</p>
      ) : results.map((entry) => (
        <button key={`${entry.kind}:${entry.id}`} type="button" onClick={() => onOpen?.(entry)} className="block w-full rounded border border-border/60 p-2 text-left hover:bg-muted">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{entryTitle(entry)}</span>
            <span className="text-[10px] text-muted-foreground">{entry.kind}</span>
          </div>
          <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{entry.summary ?? entryPredicateText(entry)}</div>
        </button>
      ))}
    </section>
  );
}

function DiagnosticsAdvanced({ diagnostics }: { diagnostics: DiagnosticsSummary }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-lg border border-dashed border-border bg-card/50 p-3 space-y-2" data-testid="narrative-memory-diagnostics">
      <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setOpen((value) => !value)}>
        <span className="text-xs font-semibold text-muted-foreground">高级：召回诊断</span>
        <span className="text-[10px] text-muted-foreground">{open ? "收起" : "展开"}</span>
      </button>
      {!open ? (
        <p className="text-[10px] text-muted-foreground">
          最近召回 {diagnostics.purpose} · 第 {formatNumber(diagnostics.chapterNumber)} 章 · {formatMs(diagnostics.totalMs)} · {formatNumber(diagnostics.totalEstimatedTokens)} tokens
          {(diagnostics.warnings?.length ?? 0) > 0 ? ` · ${diagnostics.warnings!.length} 条警告` : ""}
        </p>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <span>目的：{diagnostics.purpose}</span>
            <span>章节：{formatNumber(diagnostics.chapterNumber)}</span>
            <span>耗时：{formatMs(diagnostics.totalMs)}</span>
            <span>Tokens：{formatNumber(diagnostics.totalEstimatedTokens)}</span>
          </div>
          {(diagnostics.warnings?.length ?? 0) > 0 && (
            <div className="space-y-1 text-yellow-700 dark:text-yellow-500">
              {diagnostics.warnings!.map((warning, index) => (
                <div key={index} className="flex gap-1 text-[11px]">
                  <AlertTriangle className="size-3 shrink-0" />
                  {warning}
                </div>
              ))}
            </div>
          )}
          <div className="space-y-1">
            {(diagnostics.channels ?? []).map((channel) => (
              <div key={channel.channel} className="rounded border border-border/60 p-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-medium">{channel.channel}</span>
                  <span className="text-muted-foreground">{channel.status}</span>
                </div>
                <div className="mt-1 grid grid-cols-3 gap-1 text-[10px] text-muted-foreground">
                  <span>{formatMs(channel.latencyMs)}</span>
                  <span>检索 {formatNumber(channel.candidateCount)}</span>
                  <span>返回 {formatNumber(channel.returnedCount)}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-3 text-[11px]">
            <span>降级 {formatNumber(diagnostics.degradedCount)}</span>
            <span>丢弃 {formatNumber(diagnostics.droppedCount)}</span>
          </div>
          <WaveSummary wave={diagnostics.wave} />
        </div>
      )}
    </section>
  );
}

export function NarrativeMemoryPanel({ bookId, memoryNodes, selectedNodeId, onOpen, onAction }: NarrativeMemoryPanelProps) {
  const [diagnostics, setDiagnostics] = useState<DiagnosticsSummary | null>(null);
  const [events, setEvents] = useState<PendingEvent[]>([]);
  const [historyEvents, setHistoryEvents] = useState<MemoryEntry[]>([]);
  const [lineApprovals, setLineApprovals] = useState<readonly NarrativeLineApproval[]>([]);
  const [stateFacts, setStateFacts] = useState<MemoryEntry[]>([]);
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<MemoryEntry[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setActionError(null);
    try {
      const [diagRes, eventsRes, statsRes, historyRes, factsRes] = await Promise.all([
        fetch(`/api/books/${encodeURIComponent(bookId)}/narrative-memory/diagnostics/latest`),
        fetch(`/api/books/${encodeURIComponent(bookId)}/narrative-memory/events/pending`),
        fetch(`/api/books/${encodeURIComponent(bookId)}/narrative-memory/stats`),
        fetch(`/api/books/${encodeURIComponent(bookId)}/narrative-memory/list?kind=event&limit=40`),
        // Story status intentionally reads the same current ledger as memory.read,
        // rather than the historical fact administration list.
        fetch(`/api/books/${encodeURIComponent(bookId)}/narrative-memory/current?limit=40`),
      ]);

      let nextDiagnostics: DiagnosticsSummary | null = null;
      if (diagRes.status === 404) setDiagnostics(null);
      else if (!diagRes.ok) throw new Error(`diagnostics ${diagRes.status}`);
      else {
        nextDiagnostics = (await diagRes.json() as DiagnosticsResponse).summary ?? null;
        setDiagnostics(nextDiagnostics);
      }

      if (!eventsRes.ok) throw new Error(`events ${eventsRes.status}`);
      const nextEvents = (await eventsRes.json() as { events?: PendingEvent[] }).events ?? [];
      setEvents(nextEvents);

      let nextStats: MemoryStats | null = null;
      if (statsRes.status === 404) setStats(null);
      else if (!statsRes.ok) throw new Error(`stats ${statsRes.status}`);
      else {
        nextStats = (await statsRes.json() as MemoryStatsResponse).stats ?? null;
        setStats(nextStats);
      }

      let nextHistory: MemoryEntry[] = [];
      if (historyRes.ok) {
        const payload = await historyRes.json() as MemoryListResponse;
        nextHistory = (payload.entries ?? []).filter((entry) => entry.status === "applied" || entry.status === "rejected");
        setHistoryEvents(nextHistory);
      } else {
        setHistoryEvents([]);
      }

      let nextFacts: MemoryEntry[] = [];
      if (factsRes.ok) {
        const payload = await factsRes.json() as CurrentLedgerResponse;
        nextFacts = payload.items ?? payload.facts ?? [];
        setStateFacts(nextFacts);
      } else {
        setStateFacts([]);
      }

      // 审批台账是附加视图：读不到不应让整个叙事记忆面板报错。
      const nextApprovals = await fetchNarrativeLineApprovals(bookId, { limit: 40 }).catch(() => []);
      setLineApprovals(nextApprovals);

      setEmpty(
        nextEvents.length === 0
        && nextHistory.length === 0
        && nextFacts.length === 0
        && nextApprovals.length === 0
        && !nextDiagnostics
        && (nextStats?.total ?? 0) === 0,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加载叙事记忆失败");
    } finally {
      setLoading(false);
    }
  }, [bookId]);

  useEffect(() => {
    void load();
  }, [load]);

  const search = useCallback(async (query: string) => {
    const normalized = query.trim();
    setSearchQuery(normalized);
    if (!normalized) {
      setSearchResults([]);
      return;
    }
    setSearchLoading(true);
    try {
      const response = await fetch(`/api/books/${encodeURIComponent(bookId)}/narrative-memory/search?q=${encodeURIComponent(normalized)}&limit=30`);
      if (!response.ok) throw new Error(`search ${response.status}`);
      setSearchResults((await response.json() as MemorySearchResponse).entries ?? []);
    } catch {
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, [bookId]);

  const mutateEvent = useCallback(async (event: PendingEvent, action: "approve" | "reject") => {
    if (!event.id) return;
    setActionLoadingId(event.id);
    setActionError(null);
    try {
      await mutatePendingEventRequest(bookId, event.id, action);
      await load();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "事件操作失败");
    } finally {
      setActionLoadingId(null);
    }
  }, [bookId, load]);

  const openSearchEntry = useCallback(async (entry: MemoryEntry) => {
    let detailed = entry;
    let detailError: string | undefined;
    try {
      const response = await fetch(
        `/api/books/${encodeURIComponent(bookId)}/narrative-memory/entries/${encodeURIComponent(entry.kind)}/${encodeURIComponent(entry.id)}`,
      );
      if (!response.ok) throw new Error(`详情请求失败（${response.status}）`);
      const payload = await response.json() as { entry?: MemoryEntry };
      if (payload.entry) detailed = { ...entry, ...payload.entry, kind: entry.kind, id: entry.id };
    } catch (cause) {
      detailError = cause instanceof Error ? cause.message : "详情请求失败";
    }

    onOpen?.({
      id: `memory-${detailed.kind}:${detailed.id}`,
      kind: "file",
      title: entryTitle(detailed),
      content: detailed.summary ?? entryPredicateText(detailed),
      capabilities: { open: true, readonly: true, unsupported: false, edit: false, delete: false, apply: false },
      metadata: {
        ...detailed,
        isNarrativeMemoryEntry: true,
        entryKind: detailed.kind,
        entryId: detailed.id,
        displayCategory: entryCategory(detailed),
        ...(detailError ? { detailError } : {}),
      },
    });
  }, [bookId, onOpen]);

  return (
    <NarrativeMemoryPanelShell
      diagnostics={diagnostics}
      events={events}
      historyEvents={historyEvents}
      lineApprovals={lineApprovals}
      stateFacts={stateFacts}
      stats={stats}
      searchResults={searchResults}
      searchQuery={searchQuery}
      searchLoading={searchLoading}
      actionLoadingId={actionLoadingId}
      actionError={actionError}
      loading={loading}
      empty={empty}
      error={error}
      memoryNodes={memoryNodes}
      selectedNodeId={selectedNodeId}
      onOpen={onOpen}
      onAction={onAction}
      onSearch={(query) => void search(query)}
      onApprove={(event) => void mutateEvent(event, "approve")}
      onReject={(event) => void mutateEvent(event, "reject")}
      onRefresh={() => void load()}
      onSearchEntryOpen={openSearchEntry}
    />
  );
}

export function NarrativeMemoryPanelShell({
  diagnostics,
  events,
  historyEvents = [],
  lineApprovals = [],
  stateFacts = [],
  stats,
  searchResults = [],
  searchQuery = "",
  searchLoading,
  actionLoadingId,
  actionError,
  loading,
  empty,
  error,
  memoryNodes = [],
  selectedNodeId = null,
  onOpen,
  onSearch,
  onApprove,
  onReject,
  onRefresh,
  onSearchEntryOpen,
}: NarrativeMemoryPanelShellProps) {
  const [activeView, setActiveView] = useState<MemoryViewLabel>("故事状态");
  const [queryInput, setQueryInput] = useState(searchQuery);
  const [pendingOpen, setPendingOpen] = useState(false);

  const highRiskEvents = events.filter((event) => event.risk === "high");
  const otherPending = events.filter((event) => event.risk !== "high");
  const pendingToShow = pendingOpen ? events : highRiskEvents.length > 0 ? highRiskEvents : events.slice(0, 3);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        加载叙事记忆...
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-3 space-y-3 text-xs" data-testid="narrative-memory-panel">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2 font-medium">
            <Brain className="size-4 text-primary" />
            叙事记忆
          </div>
          <p className="text-[10px] text-muted-foreground">看当前状态与结算历史；不编辑经纬静态设定。</p>
        </div>
        <button type="button" onClick={onRefresh} className="rounded p-1 hover:bg-muted" title="刷新">
          <RefreshCw className="size-3.5" />
        </button>
      </div>

      <nav className="flex flex-wrap gap-1" aria-label="叙事记忆视图">
        {MEMORY_NAV_ITEMS.map((label) => (
          <button
            key={label}
            type="button"
            aria-pressed={activeView === label}
            onClick={() => setActiveView(label)}
            className={`rounded-full px-2.5 py-1 text-[11px] transition-colors ${
              activeView === label ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {error && <div className="rounded border border-destructive/30 bg-destructive/10 p-3 text-destructive">加载失败：{error}</div>}
      {empty && (
        <div className="rounded-lg border border-dashed border-border p-4 text-muted-foreground">
          还没有叙事记忆。写完一章后会自动结算；这里只展示动态状态，不读写经纬。
        </div>
      )}

      {GRAPH_VIEWS.has(activeView) && (
        <section className="rounded-lg border border-border bg-card p-3 space-y-2" data-testid="narrative-memory-active-view">
          <h3 className="text-xs font-semibold">{activeView}</h3>
          <p className="text-[11px] text-muted-foreground">从动态事实/事件读取，不混入经纬静态设定。</p>
          <button
            type="button"
            onClick={() => onOpen?.({
              id: "narrative-memory-graph",
              kind: "file",
              title: "叙事记忆图谱",
              capabilities: { open: true, readonly: true, unsupported: false, edit: false, delete: false, apply: false },
              metadata: { isNarrativeMemoryEntry: true, isNarrativeMemoryGraph: true, preferredView: activeView },
            })}
            className="flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-center text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <ExternalLink className="size-3.5" />
            打开 {activeView}
          </button>
        </section>
      )}

      {(activeView === "故事状态" || activeView === "结算历史") && (
        <>
          <section className="rounded-lg border border-border bg-card p-3 space-y-2">
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                onSearch?.(queryInput);
              }}
            >
              <div className="flex min-w-0 flex-1 items-center gap-1 rounded border border-border px-2">
                <Search className="size-3 text-muted-foreground" />
                <input
                  value={queryInput}
                  onChange={(event) => setQueryInput(event.currentTarget.value)}
                  placeholder="搜索角色、关系、伏笔、证据..."
                  className="h-7 min-w-0 flex-1 bg-transparent text-[11px] outline-none"
                />
              </div>
              <button type="submit" className="rounded bg-primary px-3 py-1 text-[11px] text-primary-foreground">搜索</button>
            </form>
          </section>
          <SearchResults results={searchResults} query={searchQuery} loading={searchLoading} onOpen={onSearchEntryOpen} />
        </>
      )}

      {activeView === "故事状态" && (
        <>
          <StoryStatusSummary
            stateFacts={stateFacts}
            events={events}
            historyEvents={historyEvents}
            onOpenFact={onSearchEntryOpen}
          />

          {memoryNodes.length > 0 && (
            <section className="rounded-lg border border-border bg-card p-2 space-y-2">
              <h3 className="px-1 text-xs font-semibold text-muted-foreground">状态树（只读）</h3>
              <MemoryNodeTree nodes={memoryNodes} selectedNodeId={selectedNodeId} onOpen={onOpen} />
            </section>
          )}

          <section className="rounded-lg border border-border bg-card p-3 space-y-2" data-testid="narrative-memory-history">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold">最近结算</h3>
              <button type="button" className="text-[10px] text-primary hover:underline" onClick={() => setActiveView("结算历史")}>
                查看全部
              </button>
            </div>
            {historyEvents.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">暂无结算历史。</p>
            ) : historyEvents.slice(0, 5).map((entry) => (
              <button
                key={`${entry.kind}:${entry.id}`}
                type="button"
                onClick={() => onSearchEntryOpen?.(entry)}
                className="block w-full rounded border border-border/60 p-2 text-left hover:bg-muted"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{entryTitle(entry)}</span>
                  <span className="text-[10px] text-muted-foreground">{entry.status === "applied" ? "已应用" : entry.status === "rejected" ? "已拒绝" : entry.status}</span>
                </div>
                <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                  第 {entry.chapterNumber ?? "—"} 章 · {entryCategoryLabel(entry)}
                </div>
              </button>
            ))}
          </section>

          <section className="rounded-lg border border-border bg-card p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-muted-foreground">
                待审事项 ({events.length})
                {highRiskEvents.length > 0 ? ` · 高风险 ${highRiskEvents.length}` : ""}
              </h3>
              {events.length > 3 && (
                <button type="button" className="text-[10px] text-muted-foreground hover:text-foreground" onClick={() => setPendingOpen((value) => !value)}>
                  {pendingOpen ? "收起" : "展开全部"}
                </button>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground">章后默认自动结算；这里通常只剩高风险/低置信度项，可不处理也不阻断写作。</p>
            {actionError && <div className="rounded border border-destructive/30 bg-destructive/10 p-2 text-destructive">{actionError}</div>}
            {events.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">没有待审事件。</p>
            ) : pendingToShow.map((event, index) => (
              <div key={event.id ?? index} className="rounded border border-border/60 p-2 space-y-1">
                <div className="flex justify-between gap-2">
                  <span className="font-medium">{event.eventType ?? "event"}</span>
                  <span className={`text-[10px] ${event.risk === "high" ? "text-amber-600" : "text-muted-foreground"}`}>{riskLabel(event.risk)}</span>
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {event.entity ?? "未命名实体"} · 置信度 {event.confidence ?? "—"} · 第 {event.chapterNumber ?? "—"} 章
                </div>
                {event.evidence ? <div className="text-[11px]">{event.evidence}</div> : null}
                {event.id ? (
                  <div className="flex justify-end gap-1.5 pt-1">
                    <button
                      type="button"
                      disabled={actionLoadingId === event.id}
                      onClick={() => onReject?.(event)}
                      className="rounded border border-border px-2 py-1 text-[10px] hover:bg-muted disabled:opacity-50"
                    >
                      {actionLoadingId === event.id ? "处理中…" : "拒绝"}
                    </button>
                    <button
                      type="button"
                      disabled={actionLoadingId === event.id}
                      onClick={() => onApprove?.(event)}
                      className="rounded bg-primary px-2 py-1 text-[10px] text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    >
                      {actionLoadingId === event.id ? "处理中…" : "批准并写入动态事实"}
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
            {!pendingOpen && otherPending.length > 0 && highRiskEvents.length > 0 && (
              <p className="text-[10px] text-muted-foreground">另有 {otherPending.length} 条非高风险待审，已折叠。</p>
            )}
          </section>

          {diagnostics && <DiagnosticsAdvanced diagnostics={diagnostics} />}
        </>
      )}

      {activeView === "结算历史" && (
        <section className="rounded-lg border border-border bg-card p-3 space-y-2" data-testid="narrative-memory-history">
          <h3 className="text-xs font-semibold">结算历史 ({historyEvents.length})</h3>
          <p className="text-[10px] text-muted-foreground">已自动应用或已拒绝的章后事件，按最近优先展示。</p>
          {historyEvents.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">暂无结算历史。写下一章后会自动出现。</p>
          ) : historyEvents.slice(0, 40).map((entry) => (
            <button
              key={`${entry.kind}:${entry.id}`}
              type="button"
              onClick={() => onSearchEntryOpen?.(entry)}
              className="block w-full rounded border border-border/60 p-2 text-left hover:bg-muted"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{entryTitle(entry)}</span>
                <span className="text-[10px] text-muted-foreground">
                  {entry.status === "applied" ? "已应用" : entry.status === "rejected" ? "已拒绝" : entry.status ?? "history"}
                </span>
              </div>
              <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                第 {entry.chapterNumber ?? "—"} 章 · {entryCategoryLabel(entry)}
                {entry.summary ? ` · ${entry.summary}` : ""}
              </div>
            </button>
          ))}
        </section>
      )}

      {/*
        叙事线审批台账。
        服务端从 propose → apply 起就在记录每次批准与驳回，但此前界面上没有
        任何入口 —— 作者无法回答「这个节点是谁改的、什么时候批的、理由是什么」。
        与章后结算历史并列，因为两者回答的是同一类问题。
      */}
      {activeView === "结算历史" && (
        <section className="rounded-lg border border-border bg-card p-3 space-y-2" data-testid="narrative-line-approvals">
          <h3 className="text-xs font-semibold">叙事线审批 ({lineApprovals.length})</h3>
          <p className="text-[10px] text-muted-foreground">叙事线节点与关系的变更审批记录，批准与驳回都会留痕。</p>
          {lineApprovals.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">暂无叙事线审批记录。在叙事线视图增删节点后会出现。</p>
          ) : lineApprovals.slice(0, 40).map((approval) => (
            <div
              key={approval.previewId}
              className="rounded border border-border/60 p-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">{approval.summary}</span>
                <span className={`shrink-0 text-[10px] ${approval.decision === "rejected" ? "text-muted-foreground" : "text-primary"}`}>
                  {approval.decision === "rejected" ? "已驳回" : "已批准"}
                </span>
              </div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">
                {formatApprovalTime(approval.approvedAt)}
                {approvalScopeText(approval)}
              </div>
              {approval.reason && (
                <p className="mt-0.5 text-[10px] text-muted-foreground">理由：{approval.reason}</p>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function formatApprovalTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

/** 用「新增/删除了几个节点或边」描述这次审批的范围。 */
function approvalScopeText(approval: NarrativeLineApproval): string {
  const parts = [
    (approval.targetNodeIds?.length ?? 0) > 0 ? `节点 ${approval.targetNodeIds!.length}` : "",
    (approval.targetEdgeIds?.length ?? 0) > 0 ? `关系 ${approval.targetEdgeIds!.length}` : "",
    (approval.removedNodeIds?.length ?? 0) > 0 ? `删除节点 ${approval.removedNodeIds!.length}` : "",
    (approval.removedEdgeIds?.length ?? 0) > 0 ? `删除关系 ${approval.removedEdgeIds!.length}` : "",
  ].filter(Boolean);
  return parts.length > 0 ? ` · ${parts.join(" / ")}` : "";
}
