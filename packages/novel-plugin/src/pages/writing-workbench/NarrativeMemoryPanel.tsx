import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, Brain, ChevronDown, ChevronRight, Loader2, RefreshCw, ExternalLink } from "lucide-react";

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
  loading?: boolean;
  empty: boolean;
  error: string | null;
  memoryNodes?: WorkbenchResourceNode[];
  selectedNodeId?: string | null;
  onOpen?: (node: WorkbenchResourceNode) => void;
  onAction?: (action: ResourceTreeAction) => void;
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

export function NarrativeMemoryPanel({ bookId, memoryNodes, selectedNodeId, onOpen, onAction }: NarrativeMemoryPanelProps) {
  const [diagnostics, setDiagnostics] = useState<DiagnosticsSummary | null>(null);
  const [events, setEvents] = useState<PendingEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setEmpty(false);
    try {
      const [diagRes, eventsRes] = await Promise.all([
        fetch(`/api/books/${encodeURIComponent(bookId)}/narrative-memory/diagnostics/latest`),
        fetch(`/api/books/${encodeURIComponent(bookId)}/narrative-memory/events/pending`),
      ]);
      if (diagRes.status === 404) {
        setDiagnostics(null);
        setEmpty(true);
      } else if (!diagRes.ok) {
        throw new Error(`diagnostics ${diagRes.status}`);
      } else {
        const payload = await diagRes.json() as DiagnosticsResponse;
        setDiagnostics(payload.summary ?? null);
      }
      if (!eventsRes.ok) {
        throw new Error(`events ${eventsRes.status}`);
      }
      const payload = await eventsRes.json() as PendingEventsResponse;
      setEvents(payload.events ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加载叙事记忆失败");
    } finally {
      setLoading(false);
    }
  }, [bookId]);

  useEffect(() => { void load(); }, [load]);

  return (
    <NarrativeMemoryPanelShell
      diagnostics={diagnostics}
      events={events}
      loading={loading}
      empty={empty}
      error={error}
      memoryNodes={memoryNodes}
      selectedNodeId={selectedNodeId}
      onOpen={onOpen}
      onAction={onAction}
      onRefresh={() => void load()}
    />
  );
}

export function NarrativeMemoryPanelShell({ diagnostics, events, loading, empty, error, memoryNodes = [], selectedNodeId = null, onOpen, onAction, onRefresh }: NarrativeMemoryPanelShellProps) {
  const [activeView, setActiveView] = useState<MemoryViewLabel>("记忆总览");

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
          <button
            key={label}
            type="button"
            aria-pressed={activeView === label}
            onClick={() => setActiveView(label)}
            className={`block w-full rounded px-2 py-1 text-left text-[11px] hover:bg-muted ${activeView === label ? "bg-primary/10 text-primary" : ""}`}
          >
            {label}
          </button>
        ))}
      </nav>

      {memoryNodes.length > 0 && (
        <section className="rounded-lg border border-border bg-card p-2 space-y-2">
          <h3 className="px-1 text-xs font-semibold text-muted-foreground">动态条目</h3>
          <MemoryNodeTree nodes={memoryNodes} selectedNodeId={selectedNodeId} onOpen={onOpen} />
        </section>
      )}

      {activeView !== "记忆总览" && (
        <section className="rounded-lg border border-border bg-card p-3 space-y-2" data-testid="narrative-memory-active-view">
          <h3 className="text-xs font-semibold text-muted-foreground">记忆图谱 / {activeView}</h3>
          <div className="rounded border border-dashed border-border p-3 text-[11px] text-muted-foreground space-y-2">
            <div>暂无内置的侧栏{activeView}视图。</div>
            <button
              type="button"
              onClick={() => {
                onOpen?.({
                  id: "narrative-memory-graph",
                  kind: "jingwei",
                  title: "叙事记忆图谱",
                  capabilities: { open: true, readonly: true, unsupported: false, edit: false, delete: false, apply: false },
                });
              }}
              className="flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-center text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <ExternalLink className="size-3.5" />
              打开完整记忆图谱
            </button>
          </div>
        </section>
      )}

      {error && (
        <div className="rounded border border-destructive/30 bg-destructive/10 p-3 text-destructive">加载失败：{error}</div>
      )}

      {empty && !diagnostics && (
        <div className="rounded-lg border border-dashed border-border p-4 text-muted-foreground">
          还没有叙事记忆记录，请先运行一次写作。
        </div>
      )}

      {diagnostics && (
        <>
          <section className="rounded-lg border border-border bg-card p-3 space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground">最近召回</h3>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <span>目的：{diagnostics.purpose}</span>
              <span>章节：{formatNumber(diagnostics.chapterNumber)}</span>
              <span>耗时：{formatMs(diagnostics.totalMs)}</span>
              <span>Tokens：{formatNumber(diagnostics.totalEstimatedTokens)}</span>
            </div>
            {(diagnostics.warnings?.length ?? 0) > 0 && (
              <div className="space-y-1 text-yellow-700">
                {diagnostics.warnings!.map((warning, index) => <div key={index} className="flex gap-1"><AlertTriangle className="size-3 shrink-0" />{warning}</div>)}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-border bg-card p-3 space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground">通道状态</h3>
            <div className="space-y-1">
              {(diagnostics.channels ?? []).map((channel) => (
                <div key={channel.channel} className="rounded border border-border/60 p-2">
                  <div className="flex items-center justify-between"><span className="font-medium">{channel.channel}</span><span className="text-muted-foreground">{channel.status}</span></div>
                  <div className="mt-1 grid grid-cols-3 gap-1 text-[10px] text-muted-foreground">
                    <span>{formatMs(channel.latencyMs)}</span>
                    <span>检索项 {formatNumber(channel.candidateCount)}</span>
                    <span>返回 {formatNumber(channel.returnedCount)}</span>
                    <span>tokens {formatNumber(channel.estimatedTokens)}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-3 space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground">预算结果</h3>
            <div className="flex gap-3 text-[11px]"><span>降级 {formatNumber(diagnostics.degradedCount)}</span><span>丢弃 {formatNumber(diagnostics.droppedCount)}</span></div>
            <div className="space-y-1 text-[10px] text-muted-foreground">
              {Object.entries(diagnostics.injectedTokensByChannel ?? {}).map(([channel, tokens]) => <div key={channel} className="flex justify-between"><span>{channel}</span><span>{tokens}</span></div>)}
            </div>
          </section>

          <WaveSummary wave={diagnostics.wave} />
        </>
      )}

      <section className="rounded-lg border border-border bg-card p-3 space-y-2">
        <h3 className="text-xs font-semibold text-muted-foreground">待确认事件 ({events.length})</h3>
        {events.length === 0 ? <p className="text-[11px] text-muted-foreground">暂无 pending NarrativeEvents</p> : events.map((event, index) => (
          <div key={event.id ?? index} className="rounded border border-border/60 p-2 space-y-1">
            <div className="flex justify-between"><span className="font-medium">{event.eventType ?? "event"}</span><span className="text-muted-foreground">{event.risk ?? "risk"}</span></div>
            <div className="text-[10px] text-muted-foreground">{event.entity ?? "未命名实体"} · 置信度 {event.confidence ?? "—"} · 第 {event.chapterNumber ?? "—"} 章</div>
            {event.evidence ? <div className="text-[11px]">{event.evidence}</div> : null}
          </div>
        ))}
      </section>
    </div>
  );
}
