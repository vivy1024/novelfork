import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, Brain, ChevronDown, ChevronRight, ExternalLink, Loader2, RefreshCw, Search } from "lucide-react";

import type { WorkbenchResourceNode } from "./useWorkbenchResources";

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

interface PendingEvent {
  id?: string;
  eventType?: string;
  entity?: string;
  confidence?: number;
  risk?: string;
  evidence?: string;
  chapterNumber?: number;
}

interface PendingEventsResponse {
  events?: PendingEvent[];
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
  chapterNumber?: number;
}

interface MemorySearchResponse {
  entries?: MemoryEntry[];
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
  "记忆总览",
  "关系图",
  "时间线",
  "角色弧线",
  "伏笔网络",
  "矛盾地图",
  "事件链",
] as const;

type MemoryViewLabel = typeof MEMORY_NAV_ITEMS[number];

function formatMs(value?: number) {
  return typeof value === "number" ? `${Math.round(value)}ms` : "—";
}

function formatNumber(value?: number) {
  return typeof value === "number" ? String(value) : "—";
}

function WaveSummary({ wave }: { wave?: Record<string, unknown> | null }) {
  if (!wave) return null;
  const entries = Object.entries(wave).filter(([, value]) => value !== undefined && value !== null);
  if (entries.length === 0) return null;
  return (
    <section className="rounded-lg border border-border bg-card p-3 space-y-2">
      <h3 className="text-xs font-semibold text-muted-foreground">Wave 摘要</h3>
      <div className="space-y-1 text-[11px]">
        {entries.slice(0, 8).map(([key, value]) => (
          <div key={key} className="flex justify-between gap-2">
            <span className="text-muted-foreground">{key}</span>
            <span className="truncate text-right">{Array.isArray(value) ? value.join(", ") : String(value)}</span>
          </div>
        ))}
      </div>
    </section>
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

function StatsSummary({ stats }: { stats: MemoryStats | null | undefined }) {
  if (!stats) return <div className="rounded border border-dashed border-border p-3 text-[11px] text-muted-foreground">暂无统计数据；Narrative Memory 可能尚未产生记录。</div>;
  return (
    <section className="rounded-lg border border-border bg-card p-3 space-y-2">
      <div className="flex items-center justify-between"><h3 className="text-xs font-semibold text-muted-foreground">存储概览</h3><span className="text-[10px] text-muted-foreground">共 {stats.total} 条</span></div>
      <div className="grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
        <span>事实 {stats.byKind?.fact ?? 0}</span>
        <span>事件 {stats.byKind?.event ?? 0}</span>
        <span>召回日志 {stats.byKind?.log ?? 0}</span>
        <span>向量 {stats.byKind?.vector ?? 0}</span>
      </div>
      <div className="text-[10px] text-muted-foreground">Pending 事件 {stats.pendingEvents ?? stats.eventStatus?.pending ?? 0} · 最近更新 {stats.latestUpdatedAt ?? "—"}</div>
    </section>
  );
}

function SearchResults({ results, query, loading, onOpen }: { results: MemoryEntry[]; query: string; loading?: boolean; onOpen?: (entry: MemoryEntry) => void }) {
  if (!query) return null;
  return (
    <section className="rounded-lg border border-border bg-card p-3 space-y-2">
      <div className="flex items-center justify-between"><h3 className="text-xs font-semibold text-muted-foreground">搜索结果</h3>{loading ? <Loader2 className="size-3 animate-spin" /> : <span className="text-[10px] text-muted-foreground">{results.length} 条</span>}</div>
      {results.length === 0 && !loading ? <p className="text-[11px] text-muted-foreground">没有匹配的 Narrative Memory 条目。</p> : results.map((entry) => (
        <button key={`${entry.kind}:${entry.id}`} type="button" onClick={() => onOpen?.(entry)} className="block w-full rounded border border-border/60 p-2 text-left hover:bg-muted">
          <div className="flex items-center justify-between gap-2"><span className="font-medium">{entry.title ?? entry.id}</span><span className="text-[10px] text-muted-foreground">{entry.kind}</span></div>
          <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{entry.summary ?? `${entry.subject ?? ""} ${entry.predicate ?? ""} ${entry.object ?? ""}`}</div>
        </button>
      ))}
    </section>
  );
}

export function NarrativeMemoryPanel({ bookId, memoryNodes, selectedNodeId, onOpen, onAction }: NarrativeMemoryPanelProps) {
  const [diagnostics, setDiagnostics] = useState<DiagnosticsSummary | null>(null);
  const [events, setEvents] = useState<PendingEvent[]>([]);
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
      const [diagRes, eventsRes, statsRes] = await Promise.all([
        fetch(`/api/books/${encodeURIComponent(bookId)}/narrative-memory/diagnostics/latest`),
        fetch(`/api/books/${encodeURIComponent(bookId)}/narrative-memory/events/pending`),
        fetch(`/api/books/${encodeURIComponent(bookId)}/narrative-memory/stats`),
      ]);
      let nextDiagnostics: DiagnosticsSummary | null = null;
      if (diagRes.status === 404) setDiagnostics(null);
      else if (!diagRes.ok) throw new Error(`diagnostics ${diagRes.status}`);
      else {
        nextDiagnostics = (await diagRes.json() as DiagnosticsResponse).summary ?? null;
        setDiagnostics(nextDiagnostics);
      }
      if (!eventsRes.ok) throw new Error(`events ${eventsRes.status}`);
      const nextEvents = (await eventsRes.json() as PendingEventsResponse).events ?? [];
      setEvents(nextEvents);
      let nextStats: MemoryStats | null = null;
      if (statsRes.status === 404) setStats(null);
      else if (!statsRes.ok) throw new Error(`stats ${statsRes.status}`);
      else {
        nextStats = (await statsRes.json() as MemoryStatsResponse).stats ?? null;
        setStats(nextStats);
      }
      setEmpty(nextEvents.length === 0 && !nextDiagnostics && (nextStats?.total ?? 0) === 0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加载叙事记忆失败");
    } finally {
      setLoading(false);
    }
  }, [bookId]);

  useEffect(() => { void load(); }, [load]);

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
      const response = await fetch(`/api/books/${encodeURIComponent(bookId)}/narrative-memory/events/${encodeURIComponent(event.id)}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: action === "approve" ? "工作台确认 Narrative Memory 事件" : "工作台拒绝 Narrative Memory 事件" }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { summary?: string; error?: string };
        throw new Error(payload.summary ?? payload.error ?? `事件操作失败（${response.status}）`);
      }
      await load();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "事件操作失败");
    } finally {
      setActionLoadingId(null);
    }
  }, [bookId, load]);

  const openSearchEntry = useCallback((entry: MemoryEntry) => {
    onOpen?.({
      id: `memory-${entry.kind}:${entry.id}`,
      kind: "file",
      title: entry.title ?? entry.id,
      content: entry.summary ?? `${entry.subject ?? ""} ${entryPredicateText(entry)}`,
      capabilities: { open: true, readonly: true, unsupported: false, edit: false, delete: false, apply: false },
      metadata: { isNarrativeMemoryEntry: true, entryKind: entry.kind, entryId: entry.id, category: entry.category, subject: entry.subject, predicate: entry.predicate, object: entry.object },
    });
  }, [onOpen]);

  return (
    <NarrativeMemoryPanelShell
      diagnostics={diagnostics}
      events={events}
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

function entryPredicateText(entry: MemoryEntry): string {
  return `${entry.predicate ?? ""} ${entry.object ?? ""}`.trim();
}

export function NarrativeMemoryPanelShell({ diagnostics, events, stats, searchResults = [], searchQuery = "", searchLoading, actionLoadingId, actionError, loading, empty, error, memoryNodes = [], selectedNodeId = null, onOpen, onAction, onSearch, onApprove, onReject, onRefresh, onSearchEntryOpen }: NarrativeMemoryPanelShellProps) {
  const [activeView, setActiveView] = useState<MemoryViewLabel>("记忆总览");
  const [queryInput, setQueryInput] = useState(searchQuery);

  if (loading) {
    return <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-4 animate-spin" />加载叙事记忆...</div>;
  }

  return (
    <div className="h-full overflow-y-auto p-3 space-y-3 text-xs" data-testid="narrative-memory-panel">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-medium"><Brain className="size-4 text-primary" />叙事记忆</div>
        <button type="button" onClick={onRefresh} className="rounded p-1 hover:bg-muted" title="刷新"><RefreshCw className="size-3.5" /></button>
      </div>

      <nav className="rounded-lg border border-border bg-card p-2 space-y-1" aria-label="叙事记忆视图">
        {MEMORY_NAV_ITEMS.map((label) => (
          <button key={label} type="button" aria-pressed={activeView === label} onClick={() => setActiveView(label)} className={`block w-full rounded px-2 py-1 text-left text-[11px] hover:bg-muted ${activeView === label ? "bg-primary/10 text-primary" : ""}`}>{label}</button>
        ))}
      </nav>

      {memoryNodes.length > 0 && (
        <section className="rounded-lg border border-border bg-card p-2 space-y-2">
          <h3 className="px-1 text-xs font-semibold text-muted-foreground">动态事实（只读）</h3>
          <MemoryNodeTree nodes={memoryNodes} selectedNodeId={selectedNodeId} onOpen={onOpen} />
        </section>
      )}

      {activeView !== "记忆总览" && (
        <section className="rounded-lg border border-border bg-card p-3 space-y-2" data-testid="narrative-memory-active-view">
          <h3 className="text-xs font-semibold text-muted-foreground">Narrative Memory / {activeView}</h3>
          <p className="text-[11px] text-muted-foreground">此视图读取 NarrativeFact / NarrativeEvent 动态数据；经纬静态 Lore 不会混入。点击下方入口查看真实图谱。</p>
          <button type="button" onClick={() => onOpen?.({ id: "narrative-memory-graph", kind: "file", title: "叙事记忆图谱", capabilities: { open: true, readonly: true, unsupported: false, edit: false, delete: false, apply: false }, metadata: { isNarrativeMemoryEntry: true, isNarrativeMemoryGraph: true } })} className="flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-center text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"><ExternalLink className="size-3.5" />打开真实记忆图谱</button>
        </section>
      )}

      {error && <div className="rounded border border-destructive/30 bg-destructive/10 p-3 text-destructive">加载失败：{error}</div>}
      {empty && !diagnostics && <div className="rounded-lg border border-dashed border-border p-4 text-muted-foreground">还没有叙事记忆记录，请先运行一次写作。此处不会读取或创建经纬资料。</div>}

      {activeView === "记忆总览" && (
        <>
          <StatsSummary stats={stats} />
          <section className="rounded-lg border border-border bg-card p-3 space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground">搜索 Narrative Memory</h3>
            <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); onSearch?.(queryInput); }}>
              <div className="flex min-w-0 flex-1 items-center gap-1 rounded border border-border px-2"><Search className="size-3 text-muted-foreground" /><input value={queryInput} onChange={(event) => setQueryInput(event.currentTarget.value)} placeholder="搜索实体、谓词、事件或证据" className="h-7 min-w-0 flex-1 bg-transparent text-[11px] outline-none" /></div>
              <button type="submit" className="rounded bg-primary px-3 py-1 text-[11px] text-primary-foreground">搜索</button>
            </form>
          </section>
          <SearchResults results={searchResults} query={searchQuery} loading={searchLoading} onOpen={onSearchEntryOpen} />
        </>
      )}

      {diagnostics && (
        <>
          <section className="rounded-lg border border-border bg-card p-3 space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground">最近召回</h3>
            <div className="grid grid-cols-2 gap-2 text-[11px]"><span>目的：{diagnostics.purpose}</span><span>章节：{formatNumber(diagnostics.chapterNumber)}</span><span>耗时：{formatMs(diagnostics.totalMs)}</span><span>Tokens：{formatNumber(diagnostics.totalEstimatedTokens)}</span></div>
            {(diagnostics.warnings?.length ?? 0) > 0 && <div className="space-y-1 text-yellow-700">{diagnostics.warnings!.map((warning, index) => <div key={index} className="flex gap-1"><AlertTriangle className="size-3 shrink-0" />{warning}</div>)}</div>}
          </section>
          <section className="rounded-lg border border-border bg-card p-3 space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground">通道状态</h3>
            <div className="space-y-1">{(diagnostics.channels ?? []).map((channel) => <div key={channel.channel} className="rounded border border-border/60 p-2"><div className="flex items-center justify-between"><span className="font-medium">{channel.channel}</span><span className="text-muted-foreground">{channel.status}</span></div><div className="mt-1 grid grid-cols-3 gap-1 text-[10px] text-muted-foreground"><span>{formatMs(channel.latencyMs)}</span><span>检索项 {formatNumber(channel.candidateCount)}</span><span>返回 {formatNumber(channel.returnedCount)}</span><span>tokens {formatNumber(channel.estimatedTokens)}</span></div></div>)}</div>
          </section>
          <section className="rounded-lg border border-border bg-card p-3 space-y-2"><h3 className="text-xs font-semibold text-muted-foreground">预算结果</h3><div className="flex gap-3 text-[11px]"><span>降级 {formatNumber(diagnostics.degradedCount)}</span><span>丢弃 {formatNumber(diagnostics.droppedCount)}</span></div><div className="space-y-1 text-[10px] text-muted-foreground">{Object.entries(diagnostics.injectedTokensByChannel ?? {}).map(([channel, tokens]) => <div key={channel} className="flex justify-between"><span>{channel}</span><span>{tokens}</span></div>)}</div></section>
          <WaveSummary wave={diagnostics.wave} />
        </>
      )}

      <section className="rounded-lg border border-border bg-card p-3 space-y-2">
        <h3 className="text-xs font-semibold text-muted-foreground">待确认事件 ({events.length})</h3>
        {actionError && <div className="rounded border border-destructive/30 bg-destructive/10 p-2 text-destructive">{actionError}</div>}
        {events.length === 0 ? <p className="text-[11px] text-muted-foreground">暂无 pending NarrativeEvents</p> : events.map((event, index) => (
          <div key={event.id ?? index} className="rounded border border-border/60 p-2 space-y-1">
            <div className="flex justify-between"><span className="font-medium">{event.eventType ?? "event"}</span><span className="text-muted-foreground">{event.risk ?? "risk"}</span></div>
            <div className="text-[10px] text-muted-foreground">{event.entity ?? "未命名实体"} · 置信度 {event.confidence ?? "—"} · 第 {event.chapterNumber ?? "—"} 章</div>
            {event.evidence ? <div className="text-[11px]">{event.evidence}</div> : null}
            {event.id ? <div className="flex justify-end gap-1.5 pt-1"><button type="button" disabled={actionLoadingId === event.id} onClick={() => onReject?.(event)} className="rounded border border-border px-2 py-1 text-[10px] hover:bg-muted disabled:opacity-50">{actionLoadingId === event.id ? "处理中…" : "拒绝"}</button><button type="button" disabled={actionLoadingId === event.id} onClick={() => onApprove?.(event)} className="rounded bg-primary px-2 py-1 text-[10px] text-primary-foreground hover:bg-primary/90 disabled:opacity-50">{actionLoadingId === event.id ? "处理中…" : "批准并写入动态事实"}</button></div> : null}
          </div>
        ))}
      </section>
    </div>
  );
}
