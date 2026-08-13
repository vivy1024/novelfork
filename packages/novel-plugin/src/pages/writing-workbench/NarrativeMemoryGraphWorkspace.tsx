import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Brain, Clock, GitBranch, Loader2, Network, RefreshCw, Route, Search, Swords } from "lucide-react";
import { ApiRequestError, fetchJson } from "@/hooks/use-api";

interface NarrativeFact {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  category: string;
  layer: string;
  confidence: number;
  sourceChapter?: number;
  evidenceText?: string;
}

interface NarrativeEvent {
  id: string;
  chapterNumber: number;
  eventType: string;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  status: string;
  riskLevel: string;
  evidenceText: string;
}

/**
 * 伏笔已收敛到唯一入口「伏笔看板」（ForeshadowingBoard，经纬 foreshadowing 为权威源）。
 * 这里不再提供 foreshadowing 视图 —— 图谱只读关系/时间线/角色弧/矛盾/事件链等
 * 无权威源冲突的动态视角，避免作者在两个地方看到互相矛盾的伏笔状态。
 * 后端 /narrative-memory/graph 仍支持 foreshadowing 参数，供其它调用方使用。
 */
type NarrativeMemoryView = "relationship" | "timeline" | "character_arc" | "conflict" | "event_chain" | "wave";

interface NarrativeMemoryGraphResponse {
  view?: NarrativeMemoryView;
  facts?: NarrativeFact[];
  events?: NarrativeEvent[];
}

export interface NarrativeMemoryGraphWorkspaceProps {
  bookId: string;
  onSelectNode?: (nodeId: string) => void;
}

const VIEW_OPTIONS: ReadonlyArray<{ id: NarrativeMemoryView; label: string; icon: typeof Network }> = [
  { id: "relationship", label: "关系图", icon: Network },
  { id: "timeline", label: "时间线", icon: Clock },
  { id: "character_arc", label: "角色弧线", icon: GitBranch },
  { id: "conflict", label: "矛盾地图", icon: Swords },
  { id: "event_chain", label: "事件链", icon: Route },
  { id: "wave", label: "浪潮视图", icon: Brain },
];

const CATEGORY_LABELS: Record<string, string> = {
  relationship: "关系",
  hook: "伏笔",
  timeline: "时间线",
  conflict: "矛盾",
  world_fact: "世界事实",
  character_state: "角色状态",
  location: "地点",
};

const CATEGORY_COLORS: Record<string, string> = {
  relationship: "#e11d48",
  hook: "#6366f1",
  timeline: "#64748b",
  conflict: "#ea580c",
  world_fact: "#059669",
  character_state: "#9333ea",
  location: "#0284c7",
};

function numberLabel(value: number | undefined): string {
  return value === undefined ? "—" : String(value);
}

function GraphSvg({ facts, onSelectNode }: { facts: NarrativeFact[]; onSelectNode?: (nodeId: string) => void }) {
  const entities = useMemo(() => {
    const result: string[] = [];
    const seen = new Set<string>();
    for (const fact of facts) {
      for (const entity of [fact.subject, fact.object]) {
        if (!entity || seen.has(entity)) continue;
        seen.add(entity);
        result.push(entity);
      }
    }
    return result;
  }, [facts]);
  const width = 760;
  const height = Math.max(300, Math.ceil(Math.max(entities.length, 1) / 4) * 120 + 80);
  const positions = useMemo(() => {
    const result = new Map<string, { x: number; y: number }>();
    const columns = Math.max(1, Math.min(4, entities.length));
    entities.forEach((entity, index) => {
      result.set(entity, {
        x: 100 + (index % columns) * ((width - 200) / Math.max(columns - 1, 1)),
        y: 70 + Math.floor(index / columns) * 120,
      });
    });
    return result;
  }, [entities]);

  if (entities.length === 0) return null;

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card p-2">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-[min(58vh,520px)] min-h-[300px] w-full min-w-[600px]" role="img" aria-label="Narrative Memory 动态事实图谱">
        <defs>
          <marker id="narrative-memory-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L0,6 L8,3 z" fill="currentColor" />
          </marker>
        </defs>
        {facts.map((fact) => {
          const source = positions.get(fact.subject);
          const target = positions.get(fact.object);
          if (!source || !target || fact.subject === fact.object) return null;
          return (
            <g key={fact.id} className="text-muted-foreground">
              <line x1={source.x} y1={source.y} x2={target.x} y2={target.y} stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.5" markerEnd="url(#narrative-memory-arrow)" />
              <text x={(source.x + target.x) / 2} y={(source.y + target.y) / 2 - 5} textAnchor="middle" className="fill-current text-[10px]">{fact.predicate}</text>
            </g>
          );
        })}
        {entities.map((entity) => {
          const position = positions.get(entity)!;
          const fact = facts.find((item) => item.subject === entity || item.object === entity);
          return (
            <g key={entity} transform={`translate(${position.x}, ${position.y})`} className={onSelectNode && fact ? "cursor-pointer" : undefined} onClick={() => fact && onSelectNode?.(fact.id)}>
              <circle r="28" fill={CATEGORY_COLORS[fact?.category ?? ""] ?? "#64748b"} fillOpacity="0.16" stroke={CATEGORY_COLORS[fact?.category ?? ""] ?? "#64748b"} strokeWidth="2" />
              <text textAnchor="middle" y="4" className="fill-foreground text-[12px] font-medium">{entity.length > 9 ? `${entity.slice(0, 8)}…` : entity}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function MemoryRows({ facts, events, view, onSelectNode }: { facts: NarrativeFact[]; events: NarrativeEvent[]; view: NarrativeMemoryView; onSelectNode?: (nodeId: string) => void }) {
  const showEvents = view === "timeline" || view === "event_chain" || view === "wave" || (facts.length === 0 && events.length > 0);
  const showFacts = !showEvents || view === "wave";
  const sortedEvents = [...events].sort((a, b) => b.chapterNumber - a.chapterNumber || a.id.localeCompare(b.id));
  if (showEvents && sortedEvents.length > 0) {
    return (
      <div className="space-y-2">
        {sortedEvents.map((event) => (
          <button key={event.id} type="button" onClick={() => onSelectNode?.(event.id)} className="w-full rounded-lg border border-border bg-card p-3 text-left hover:border-primary/50">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">第 {event.chapterNumber} 章 · {event.eventType}</span>
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{event.status} / {event.riskLevel}</span>
            </div>
            <div className="mt-1 text-muted-foreground">{event.subject} {event.predicate} {event.object}</div>
            <div className="mt-1 text-[10px] text-muted-foreground">置信度 {event.confidence} · {event.evidenceText}</div>
          </button>
        ))}
      </div>
    );
  }
  if (showFacts && facts.length > 0) {
    return (
      <div className="grid gap-2 md:grid-cols-2">
        {facts.map((fact) => (
          <button key={fact.id} type="button" onClick={() => onSelectNode?.(fact.id)} className="rounded-lg border border-border bg-card p-3 text-left hover:border-primary/50">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{fact.subject} · {fact.predicate}</span>
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{CATEGORY_LABELS[fact.category] ?? fact.category}</span>
            </div>
            <div className="mt-1 text-muted-foreground">{fact.object}</div>
            <div className="mt-1 text-[10px] text-muted-foreground">第 {numberLabel(fact.sourceChapter)} 章 · {fact.layer} · 置信度 {fact.confidence}</div>
          </button>
        ))}
      </div>
    );
  }
  return <div className="rounded-lg border border-dashed border-border p-8 text-center text-xs text-muted-foreground">当前视图暂无 Narrative Memory 动态事实或事件。</div>;
}

export function NarrativeMemoryGraphWorkspace({ bookId, onSelectNode }: NarrativeMemoryGraphWorkspaceProps) {
  const [view, setView] = useState<NarrativeMemoryView>("relationship");
  const [focusEntity, setFocusEntity] = useState("");
  const [focusInput, setFocusInput] = useState("");
  const [payload, setPayload] = useState<NarrativeMemoryGraphResponse>({ facts: [], events: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ view });
      if (focusEntity.trim()) params.set("focusEntity", focusEntity.trim());
      const next = await fetchJson<NarrativeMemoryGraphResponse>(
        `/api/books/${encodeURIComponent(bookId)}/narrative-memory/graph?${params.toString()}`,
      );
      setPayload({ facts: Array.isArray(next.facts) ? next.facts : [], events: Array.isArray(next.events) ? next.events : [], view: next.view });
    } catch (cause) {
      const status = cause instanceof ApiRequestError ? cause.status : undefined;
      setError(status ? `加载 Narrative Memory 图谱失败（${status}）` : cause instanceof Error ? cause.message : "加载 Narrative Memory 图谱失败");
      setPayload({ facts: [], events: [] });
    } finally {
      setLoading(false);
    }
  }, [bookId, focusEntity, view]);

  useEffect(() => { void load(); }, [load]);

  const facts = payload.facts ?? [];
  const events = payload.events ?? [];
  const selectedOption = VIEW_OPTIONS.find((option) => option.id === view);
  const isGraphView = view === "relationship" || view === "conflict" || view === "wave";

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-xs" data-testid="narrative-memory-graph-workspace">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
        <div className="flex items-center gap-2">
          <Brain className="size-4 text-primary" />
          <span className="font-semibold">叙事记忆图谱</span>
          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">Narrative Memory 动态数据</span>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="rounded p-1.5 hover:bg-muted disabled:opacity-50" title="刷新">
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </header>

      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border bg-muted/20 px-3 py-2">
        {VIEW_OPTIONS.map((option) => {
          const Icon = option.icon;
          return <button key={option.id} type="button" onClick={() => setView(option.id)} aria-pressed={view === option.id} className={`flex items-center gap-1 rounded px-2 py-1 ${view === option.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"}`}><Icon className="size-3" />{option.label}</button>;
        })}
        <div className="ml-auto flex items-center gap-1">
          <Search className="size-3 text-muted-foreground" />
          <input value={focusInput} onChange={(event) => setFocusInput(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") setFocusEntity(focusInput); }} placeholder="聚焦实体" className="h-6 w-24 rounded border border-border bg-background px-2 text-[11px] outline-none focus:border-primary" />
          <button type="button" onClick={() => setFocusEntity(focusInput)} className="rounded bg-muted px-2 py-1 text-[10px] hover:bg-muted/80">筛选</button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        <div className="mb-3 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>{selectedOption?.label ?? "图谱"} · {facts.length} 条事实 · {events.length} 个事件</span>
          <span>经纬仅维护静态 Lore；此处只读动态事实与事件</span>
        </div>
        {loading ? (
          <div className="flex h-full min-h-[240px] items-center justify-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" />正在读取 Narrative Memory…</div>
        ) : error ? (
          <div className="flex min-h-[240px] flex-col items-center justify-center gap-2 text-center"><AlertTriangle className="size-6 text-destructive" /><p className="text-muted-foreground">{error}</p><button type="button" onClick={() => void load()} className="rounded bg-primary px-3 py-1.5 text-primary-foreground">重试</button></div>
        ) : (
          <>
            {isGraphView && facts.length > 0 ? <GraphSvg facts={facts} onSelectNode={onSelectNode} /> : null}
            <div className={isGraphView && facts.length > 0 ? "mt-3" : ""}>
              <MemoryRows facts={facts} events={events} view={view} onSelectNode={onSelectNode} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
