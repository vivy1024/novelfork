/**
 * 人物关系网（作品基础 › 设定图谱 › 人物关系）：焦点人物的 1–2 跳自我网络。
 *
 * 数据只来自实体索引（按实体 id 连边，经纬条目是身份唯一权威），按「截至第 N 章」切片。
 * 取代原来的共现生成树：生成树会丢环、丢多余关系，同场出现也不等于有关系。
 *
 * 交互：选焦点、切 1 / 2 跳、选截至第几章；点边看两人的关系史、证据与趋势，
 * 点人物看资料（可设为焦点、打开经纬条目或实体资料卡），双击人物直接换焦点。
 * 布局由数据确定（焦点居中、一跳内圈、二跳外圈），不用力导向；视口按作品记住。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AlertCircle, BookOpen, Crosshair, ExternalLink, Loader2, RefreshCw, UserRound, Users, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fetchJson } from "@/hooks/use-api";
import { useColorScheme } from "@/hooks/use-color-scheme";

import type { GraphExplanation, RelationPolarityLabel } from "../../../engine/narrative-entity/relation-graph";
import { readSavedViewport, saveViewport } from "../canvas-viewport";
import { useWritingProgressRefresh } from "../use-writing-progress-refresh";
import {
  toRelationFlow,
  type NetworkEdgeInput,
  type NetworkNodeInput,
  type NetworkSelection,
  type RelationFlowEdge,
  type RelationFlowNode,
} from "./relation-network-layout";
import {
  ENTITY_TYPE_LABEL,
  POLARITY_STROKE,
  relationEdgeTypes,
  relationNodeTypes,
} from "./RelationNetworkNodes";

export interface RelationNetworkPanelProps {
  readonly bookId: string;
  /** 打开经纬条目；返回 false 表示条目未载入。 */
  readonly onOpenEntry?: (entryId: string, label: string) => void;
  /** 打开实体资料卡（实体抽屉）。 */
  readonly onOpenEntity?: (name: string, entryId?: string) => void;
  readonly onOpenChapter?: (chapterNumber: number) => void;
  readonly className?: string;
}

interface GraphEntityRow {
  readonly id: string;
  readonly entryId: string | null;
  readonly name: string;
  readonly type: string;
  readonly relationCount: number;
}

interface GraphStats {
  readonly entities: number;
  readonly relations: number;
  readonly participations: number;
  readonly latestChapter: number | null;
}

interface EntitiesResponse {
  readonly status: "ok" | "empty";
  readonly reason?: string;
  readonly explanation?: GraphExplanation;
  readonly stats: GraphStats;
  readonly defaultFocusId: string | null;
  readonly entities: readonly GraphEntityRow[];
}

interface NetworkResponse {
  readonly status: "ok" | "empty";
  readonly reason?: string;
  readonly explanation?: GraphExplanation;
  readonly notice?: GraphExplanation;
  readonly defaultFocusId?: string | null;
  readonly network?: {
    readonly focusId: string;
    readonly hops: 1 | 2;
    readonly chapter: number | null;
    readonly nodes: readonly NetworkNodeInput[];
    readonly edges: readonly NetworkEdgeInput[];
    readonly omitted: number;
  };
}

interface HistoryItem {
  readonly relationId: string;
  readonly subjectId: string;
  readonly objectId: string;
  readonly predicate: string;
  readonly validFrom: number | null;
  readonly validTo: number | null;
  readonly active: boolean;
  readonly evidence: string | null;
  readonly polarity: { readonly score: number | null; readonly label: RelationPolarityLabel; readonly keyword: string | null };
}

interface PairResponse {
  readonly history: readonly HistoryItem[];
  readonly trend: { readonly kind: string; readonly label: string; readonly explanation: string };
  readonly sharedEvents: number;
  readonly common: readonly { readonly entity: { readonly id: string; readonly name: string }; readonly withA: readonly string[]; readonly withB: readonly string[] }[];
}

type Remote<T> = { readonly status: "loading" } | { readonly status: "error"; readonly message: string } | { readonly status: "ready"; readonly data: T };

const TREND_BADGE: Record<string, string> = {
  warming: "border-primary/50 text-primary",
  worsening: "border-destructive/50 text-destructive",
  fluctuating: "border-border text-foreground",
  stable: "border-border text-muted-foreground",
  insufficient: "border-dashed text-muted-foreground",
};

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

function ExplanationBlock({ explanation, testId }: { explanation: GraphExplanation; testId?: string }) {
  return (
    <div className="space-y-1 text-2xs leading-relaxed" data-testid={testId}>
      <p className="text-xs font-medium text-foreground">{explanation.whatHappened}</p>
      <p className="text-muted-foreground">{explanation.whyItMatters}</p>
      <p className="text-muted-foreground">建议：{explanation.suggestedAction}</p>
    </div>
  );
}

function chapterRange(from: number | null, to: number | null): string {
  const start = from === null ? "开篇" : `第 ${from} 章`;
  return to === null ? `${start}起` : `${start}—第 ${to} 章止`;
}

function useRebuildIndex(bookId: string, onDone: () => void) {
  const [state, setState] = useState<{ busy: boolean; message: string | null; failed: boolean }>({ busy: false, message: null, failed: false });
  const rebuild = useCallback(async () => {
    setState({ busy: true, message: null, failed: false });
    try {
      const result = await fetchJson<{ summary?: string }>(
        `/api/books/${encodeURIComponent(bookId)}/narrative-memory/entity-index/rebuild`,
        { method: "POST" },
      );
      setState({ busy: false, message: result.summary ?? "实体索引已重建。", failed: false });
      onDone();
    } catch (cause) {
      setState({ busy: false, message: `重建失败：${errorText(cause, "请稍后重试")}`, failed: true });
    }
  }, [bookId, onDone]);
  return { ...state, rebuild };
}

export function RelationNetworkPanel(props: RelationNetworkPanelProps) {
  // 换一本书就换一个画布实例：视口与选择都从头开始。
  return (
    <ReactFlowProvider key={props.bookId}>
      <RelationNetworkInner {...props} />
    </ReactFlowProvider>
  );
}

function RelationNetworkInner({ bookId, onOpenEntry, onOpenEntity, onOpenChapter, className }: RelationNetworkPanelProps) {
  const base = `/api/books/${encodeURIComponent(bookId)}/narrative-memory/entity-graph`;
  const [overview, setOverview] = useState<Remote<EntitiesResponse>>({ status: "loading" });
  const [network, setNetwork] = useState<Remote<NetworkResponse>>({ status: "loading" });
  const [focusId, setFocusId] = useState<string | null>(null);
  const [hops, setHops] = useState<1 | 2>(1);
  const [chapter, setChapter] = useState<number | undefined>(undefined);
  const [selection, setSelection] = useState<NetworkSelection>(null);
  const [pair, setPair] = useState<Remote<PairResponse> | null>(null);
  const [nonce, setNonce] = useState(0);
  const flow = useReactFlow<RelationFlowNode, RelationFlowEdge>();
  const colorMode = useColorScheme();
  const viewportKey = `${bookId}:relations`;
  const restoredRef = useRef(false);
  const lastClickRef = useRef<{ id: string; at: number } | null>(null);

  const reload = useCallback(() => setNonce((value) => value + 1), []);
  useWritingProgressRefresh(bookId, reload);
  const rebuild = useRebuildIndex(bookId, reload);

  useEffect(() => {
    let cancelled = false;
    setOverview((current) => (current.status === "ready" ? current : { status: "loading" }));
    const query = chapter !== undefined ? `?chapter=${chapter}` : "";
    fetchJson<EntitiesResponse>(`${base}/entities${query}`)
      .then((data) => { if (!cancelled) setOverview({ status: "ready", data }); })
      .catch((cause) => { if (!cancelled) setOverview({ status: "error", message: errorText(cause, "读取实体索引失败。") }); });
    return () => { cancelled = true; };
  }, [base, chapter, nonce]);

  const ready = overview.status === "ready" && overview.data.status === "ok" ? overview.data : null;
  const hasIndex = ready !== null;
  const effectiveFocus = focusId ?? ready?.defaultFocusId ?? null;

  useEffect(() => {
    if (!hasIndex) return;
    let cancelled = false;
    setNetwork({ status: "loading" });
    const params = new URLSearchParams({ hops: String(hops) });
    if (effectiveFocus) params.set("focus", effectiveFocus);
    if (chapter !== undefined) params.set("chapter", String(chapter));
    fetchJson<NetworkResponse>(`${base}/network?${params.toString()}`)
      .then((data) => {
        if (cancelled) return;
        // 焦点在重建索引后失效：退回默认焦点，而不是停在空白画布上。
        if (data.reason === "entity-not-found" && focusId) {
          setFocusId(null);
          return;
        }
        setNetwork({ status: "ready", data });
      })
      .catch((cause) => { if (!cancelled) setNetwork({ status: "error", message: errorText(cause, "读取关系网失败。") }); });
    return () => { cancelled = true; };
  }, [base, hasIndex, effectiveFocus, focusId, hops, chapter, nonce]);

  const graph = network.status === "ready" ? network.data.network ?? null : null;
  const flowData = useMemo(() => (graph ? toRelationFlow(graph, selection) : { nodes: [], edges: [] }), [graph, selection]);

  // 换焦点 / 跳数 / 截止章后把整张网放进视口；第一次打开优先回到上次看的位置。
  useEffect(() => {
    if (!graph) return;
    if (!restoredRef.current) {
      restoredRef.current = true;
      const saved = readSavedViewport(viewportKey);
      if (saved) {
        void flow.setViewport(saved);
        return;
      }
    }
    const timer = window.setTimeout(() => void flow.fitView({ padding: 0.2, maxZoom: 1, duration: 200 }), 0);
    return () => window.clearTimeout(timer);
  }, [graph, flow, viewportKey]);

  const selectedEdge = selection?.kind === "edge" && graph ? graph.edges.find((edge) => edge.id === selection.id) ?? null : null;
  const selectedNode = selection?.kind === "node" && graph ? graph.nodes.find((node) => node.id === selection.id) ?? null : null;
  const nameOf = useCallback((id: string) => graph?.nodes.find((node) => node.id === id)?.name ?? ready?.entities.find((entity) => entity.id === id)?.name ?? id, [graph, ready]);

  useEffect(() => {
    if (!selectedEdge) {
      setPair(null);
      return;
    }
    let cancelled = false;
    setPair({ status: "loading" });
    const params = new URLSearchParams({ a: selectedEdge.source, b: selectedEdge.target });
    if (chapter !== undefined) params.set("chapter", String(chapter));
    fetchJson<PairResponse>(`${base}/pair?${params.toString()}`)
      .then((data) => { if (!cancelled) setPair({ status: "ready", data }); })
      .catch((cause) => { if (!cancelled) setPair({ status: "error", message: errorText(cause, "读取关系史失败。") }); });
    return () => { cancelled = true; };
  }, [base, selectedEdge, chapter]);

  const changeFocus = useCallback((id: string) => {
    setFocusId(id);
    setSelection(null);
  }, []);

  const focusOptions = useMemo(() => [...(overview.status === "ready" ? overview.data.entities : [])]
    .sort((left, right) => right.relationCount - left.relationCount || left.name.localeCompare(right.name, "zh")), [overview]);
  const latestChapter = overview.status === "ready" ? overview.data.stats.latestChapter : null;
  const chapterOptions = useMemo(() => {
    if (!latestChapter) return [];
    return Array.from({ length: latestChapter }, (_, index) => latestChapter - index);
  }, [latestChapter]);

  const fieldClass = "h-6 rounded border bg-background px-1.5 text-2xs outline-none focus:border-primary";

  if (overview.status === "loading") {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground" data-testid="relation-network-loading">
        <Loader2 className="size-4 animate-spin" /> 正在读实体索引…
      </div>
    );
  }
  if (overview.status === "error") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center" data-testid="relation-network-error">
        <AlertCircle className="size-5 text-destructive" />
        <p className="max-w-sm text-2xs text-muted-foreground">{overview.message}</p>
        <Button size="xs" variant="outline" className="h-6 gap-1 text-2xs" onClick={reload}>
          <RefreshCw className="size-3" /> 重试
        </Button>
      </div>
    );
  }

  if (overview.data.status === "empty" && overview.data.explanation) {
    const canRebuild = overview.data.reason !== "schema-missing";
    return (
      <div className="flex h-full min-h-[16rem] flex-col items-center justify-center gap-3 p-6" data-testid="relation-network-empty">
        <Users className="size-6 text-muted-foreground" />
        <div className="max-w-md rounded-md border border-dashed p-3">
          <ExplanationBlock explanation={overview.data.explanation} testId="relation-network-empty-explanation" />
        </div>
        {canRebuild ? (
          <Button size="xs" variant="outline" className="h-7 gap-1 text-xs" disabled={rebuild.busy} onClick={() => void rebuild.rebuild()} data-testid="relation-network-rebuild">
            {rebuild.busy ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
            重建索引
          </Button>
        ) : null}
        {rebuild.message ? (
          <p className={`max-w-md text-center text-2xs ${rebuild.failed ? "text-destructive" : "text-muted-foreground"}`} data-testid="relation-network-rebuild-message">{rebuild.message}</p>
        ) : null}
      </div>
    );
  }

  const omitted = graph?.omitted ?? 0;
  const networkEmpty = network.status === "ready" && network.data.status === "empty" ? network.data.explanation ?? null : null;
  const notice = network.status === "ready" ? network.data.notice ?? null : null;

  return (
    <div className={className ?? "flex h-full min-h-0 flex-col gap-1.5"} data-testid="relation-network">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-2xs text-muted-foreground">
        <label className="flex items-center gap-1">
          焦点
          <select
            aria-label="焦点人物"
            className={`${fieldClass} max-w-40`}
            value={effectiveFocus ?? ""}
            onChange={(event) => changeFocus(event.target.value)}
            data-testid="relation-network-focus"
          >
            {focusOptions.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.name}{entity.relationCount > 0 ? `（${entity.relationCount}）` : ""}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-0.5 rounded-md bg-muted/60 p-0.5" role="group" aria-label="跳数">
          {([1, 2] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={hops === value}
              onClick={() => { setHops(value); setSelection(null); }}
              className={`rounded px-2 py-0.5 text-2xs ${hops === value ? "bg-background font-medium text-foreground shadow-sm" : "hover:text-foreground"}`}
              data-testid={`relation-network-hops-${value}`}
            >
              {value} 跳
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1">
          截至
          <select
            aria-label="截至第几章"
            className={fieldClass}
            value={chapter === undefined ? "latest" : String(chapter)}
            onChange={(event) => { setChapter(event.target.value === "latest" ? undefined : Number(event.target.value)); setSelection(null); }}
            data-testid="relation-network-chapter"
          >
            <option value="latest">至今</option>
            {chapterOptions.map((value) => <option key={value} value={value}>第 {value} 章</option>)}
          </select>
        </label>
        <span>
          {graph ? `${graph.nodes.length} 人 · ${graph.edges.length} 条关系` : ""}
          {omitted > 0 ? ` · 另有 ${omitted} 人未画出` : ""}
        </span>
        {network.status === "loading" ? <Loader2 className="size-3 animate-spin" /> : null}
        <div className="ml-auto flex items-center gap-1">
          <Button size="xs" variant="ghost" className="h-6 gap-1 px-1.5 text-2xs" disabled={rebuild.busy} title="按经纬条目与章后事实整本重建实体索引" onClick={() => void rebuild.rebuild()} data-testid="relation-network-rebuild">
            {rebuild.busy ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
            重建索引
          </Button>
        </div>
      </div>
      {rebuild.message ? (
        <p className={`shrink-0 px-0.5 text-2xs ${rebuild.failed ? "text-destructive" : "text-muted-foreground"}`} data-testid="relation-network-rebuild-message">{rebuild.message}</p>
      ) : null}

      <div className="flex min-h-0 flex-1 gap-2">
        <div className="relative min-h-[16rem] min-w-0 flex-1 overflow-hidden rounded-md border" data-testid="relation-network-canvas">
            <ReactFlow<RelationFlowNode, RelationFlowEdge>
              nodes={flowData.nodes}
              edges={flowData.edges}
              nodeTypes={relationNodeTypes}
              edgeTypes={relationEdgeTypes}
              onNodeClick={(_, node) => {
                // 双击换焦点按「同一人物 350ms 内点两下」判断：点第一下会重绘选中态，
                // 浏览器的 dblclick 事件在画布里不一定落回节点上，两次 click 则总能收到。
                const last = lastClickRef.current;
                const now = Date.now();
                lastClickRef.current = { id: node.id, at: now };
                if (last && last.id === node.id && now - last.at < 350 && node.id !== graph?.focusId) {
                  lastClickRef.current = null;
                  changeFocus(node.id);
                  return;
                }
                setSelection({ kind: "node", id: node.id });
              }}
              onEdgeClick={(_, edge) => setSelection({ kind: "edge", id: edge.id })}
              onPaneClick={() => setSelection(null)}
              onMoveEnd={(_, viewport) => saveViewport(viewportKey, viewport)}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              deleteKeyCode={null}
              zoomOnDoubleClick={false}
              minZoom={0.2}
              maxZoom={1.8}
              colorMode={colorMode}
            >
              <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
              <Controls showInteractive={false} position="bottom-left" />
            </ReactFlow>
          {network.status === "error" ? (
            <div className="absolute inset-x-2 top-2 flex items-center gap-1.5 rounded border border-destructive/40 bg-background px-2 py-1 text-2xs text-destructive" role="alert">
              <AlertCircle className="size-3 shrink-0" />
              <span className="flex-1">{network.message}</span>
              <button type="button" className="underline-offset-2 hover:underline" onClick={reload}>重试</button>
            </div>
          ) : null}
          {networkEmpty || notice ? (
            <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center px-4" data-testid="relation-network-notice">
              <div className="pointer-events-auto max-w-md rounded-md border bg-background/95 p-2.5 shadow-sm">
                <ExplanationBlock explanation={(networkEmpty ?? notice)!} />
              </div>
            </div>
          ) : null}
        </div>

        <aside className="relative w-72 shrink-0 space-y-3 overflow-y-auto rounded-md border p-2.5 text-xs" data-testid="relation-network-inspector">
          {selection ? (
            <button type="button" aria-label="收起" className="absolute right-1.5 top-1.5 rounded p-0.5 text-muted-foreground hover:bg-muted" onClick={() => setSelection(null)}>
              <X className="size-3" />
            </button>
          ) : null}
          {selectedEdge ? (
            <EdgeInspector
              edge={selectedEdge}
              nameOf={nameOf}
              pair={pair}
              chapter={chapter}
              onFocus={changeFocus}
              {...(onOpenChapter ? { onOpenChapter } : {})}
            />
          ) : selectedNode ? (
            <NodeInspector
              node={selectedNode}
              edges={graph?.edges ?? []}
              nameOf={nameOf}
              onFocus={changeFocus}
              onSelectEdge={(id) => setSelection({ kind: "edge", id })}
              {...(onOpenEntry ? { onOpenEntry } : {})}
              {...(onOpenEntity ? { onOpenEntity } : {})}
            />
          ) : (
            <Legend />
          )}
        </aside>
      </div>
    </div>
  );
}

function Legend() {
  const rows: RelationPolarityLabel[] = ["紧密", "友好", "中性", "紧张", "敌对"];
  return (
    <div className="space-y-2 text-2xs text-muted-foreground" data-testid="relation-network-legend">
      <div className="text-xs font-medium text-foreground">怎么看</div>
      <p>焦点人物居中，内圈是与 TA 直接有关系的人，外圈是二跳（关系人的关系人）。只画截至所选章节仍成立的关系；同场出现不算关系。</p>
      <p>点连线看两人的关系史、证据与走向；点人物看资料，双击人物换成焦点。</p>
      <div className="space-y-1">
        <div className="font-medium text-foreground">连线颜色 = 最近一条看得出亲疏的关系</div>
        {rows.map((label) => (
          <div key={label} className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-6 rounded" style={{ background: POLARITY_STROKE[label] }} />
            {label}
          </div>
        ))}
        <p>连线越粗，两人共同经历的事件越多。亲疏按关系名里的关键词判断（如「同盟」「协作」「猜忌」「背叛」），看不出倾向的算中性。</p>
      </div>
    </div>
  );
}

function NodeInspector({ node, edges, nameOf, onFocus, onSelectEdge, onOpenEntry, onOpenEntity }: {
  node: NetworkNodeInput;
  edges: readonly NetworkEdgeInput[];
  nameOf: (id: string) => string;
  onFocus: (id: string) => void;
  onSelectEdge: (edgeId: string) => void;
  onOpenEntry?: (entryId: string, label: string) => void;
  onOpenEntity?: (name: string, entryId?: string) => void;
}) {
  const touching = edges.filter((edge) => edge.source === node.id || edge.target === node.id);
  return (
    <div className="space-y-2.5" data-testid="relation-node-inspector">
      <div className="space-y-0.5 pr-5">
        <div className="flex items-center gap-1.5 font-semibold">
          <UserRound className="size-3.5 text-primary" />
          {node.name}
        </div>
        <div className="text-2xs text-muted-foreground">
          {ENTITY_TYPE_LABEL[node.type] ?? node.type} · {node.hop === 0 ? "焦点" : `${node.hop} 跳`} · 共 {node.degree} 条有效关系
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {node.hop !== 0 ? (
          <Button size="xs" variant="outline" className="h-6 gap-1 px-1.5 text-2xs" onClick={() => onFocus(node.id)} data-testid="relation-node-set-focus">
            <Crosshair className="size-3" /> 设为焦点
          </Button>
        ) : null}
        {onOpenEntity ? (
          <Button size="xs" variant="outline" className="h-6 gap-1 px-1.5 text-2xs" onClick={() => onOpenEntity(node.name, node.entryId ?? undefined)} data-testid="relation-node-open-entity">
            <Users className="size-3" /> 资料卡
          </Button>
        ) : null}
        {onOpenEntry && node.entryId ? (
          <Button size="xs" variant="ghost" className="h-6 gap-1 px-1.5 text-2xs" onClick={() => onOpenEntry(node.entryId!, node.name)} data-testid="relation-node-open-entry">
            <ExternalLink className="size-3" /> 经纬条目
          </Button>
        ) : null}
      </div>
      <div className="space-y-1">
        <div className="text-2xs font-medium text-muted-foreground">图上的关系（点一条看关系史）</div>
        {touching.length === 0 ? <p className="text-2xs text-muted-foreground">图上没有与 TA 相连的关系。</p> : null}
        {touching.map((edge) => {
          const other = edge.source === node.id ? edge.target : edge.source;
          return (
            <button
              key={edge.id}
              type="button"
              className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-2xs hover:bg-muted"
              onClick={() => onSelectEdge(edge.id)}
              data-testid={`relation-node-edge-${other}`}
            >
              <span className="inline-block size-2 shrink-0 rounded-full" style={{ background: POLARITY_STROKE[edge.latestPolarity.label] }} />
              <span className="font-medium">{nameOf(other)}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground" title={edge.predicates.join("、")}>{edge.predicates.join("、")}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EdgeInspector({ edge, nameOf, pair, chapter, onFocus, onOpenChapter }: {
  edge: NetworkEdgeInput;
  nameOf: (id: string) => string;
  pair: Remote<PairResponse> | null;
  chapter: number | undefined;
  onFocus: (id: string) => void;
  onOpenChapter?: (chapterNumber: number) => void;
}) {
  return (
    <div className="space-y-2.5" data-testid="relation-edge-inspector">
      <div className="space-y-0.5 pr-5">
        <div className="font-semibold">{nameOf(edge.source)} ↔ {nameOf(edge.target)}</div>
        <div className="text-2xs text-muted-foreground">
          {chapter === undefined ? "至今" : `截至第 ${chapter} 章`}仍成立 {edge.relationCount} 条 · 共同事件 {edge.sharedEvents} 次
        </div>
      </div>
      {!pair || pair.status === "loading" ? (
        <div className="flex items-center gap-1.5 text-2xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> 正在读关系史…</div>
      ) : pair.status === "error" ? (
        <p className="text-2xs text-destructive">{pair.message}</p>
      ) : (
        <>
          <div className="space-y-1 rounded-md border bg-muted/30 p-2" data-testid="relation-trend">
            <div className="flex items-center gap-1.5">
              <span className="text-2xs text-muted-foreground">走向</span>
              <Badge variant="outline" className={`h-4 px-1 text-2xs ${TREND_BADGE[pair.data.trend.kind] ?? ""}`}>{pair.data.trend.label}</Badge>
            </div>
            <p className="text-2xs leading-relaxed text-muted-foreground">{pair.data.trend.explanation}</p>
          </div>
          <div className="space-y-1.5">
            <div className="text-2xs font-medium text-muted-foreground">关系史（{pair.data.history.length} 条）</div>
            {pair.data.history.map((item) => (
              <article key={item.relationId} className={`space-y-1 rounded-md border p-2 ${item.active ? "border-primary/40" : "opacity-80"}`} data-testid="relation-history-item">
                <div className="flex flex-wrap items-center gap-1 text-2xs text-muted-foreground">
                  {onOpenChapter && item.validFrom !== null ? (
                    <button type="button" className="inline-flex items-center gap-0.5 text-primary hover:underline" onClick={() => onOpenChapter(item.validFrom!)} title={`打开第 ${item.validFrom} 章`}>
                      <BookOpen className="size-3" />{chapterRange(item.validFrom, item.validTo)}
                    </button>
                  ) : <span>{chapterRange(item.validFrom, item.validTo)}</span>}
                  <Badge variant="outline" className="h-4 px-1 text-2xs">{item.polarity.label}</Badge>
                  {item.active ? <Badge variant="secondary" className="h-4 px-1 text-2xs">仍成立</Badge> : <span>已结束</span>}
                </div>
                <div className="text-xs">
                  <span className="text-muted-foreground">{nameOf(item.subjectId)} → {nameOf(item.objectId)}：</span>
                  <span className="font-medium">{item.predicate}</span>
                </div>
                {item.evidence ? <p className="line-clamp-3 rounded bg-muted/40 p-1.5 text-2xs text-muted-foreground">依据：{item.evidence}</p> : null}
              </article>
            ))}
          </div>
          <div className="space-y-1">
            <div className="text-2xs font-medium text-muted-foreground">共同关系人</div>
            {pair.data.common.length === 0 ? <p className="text-2xs text-muted-foreground">没有同时与两人有关系的人。</p> : null}
            {pair.data.common.map((item) => (
              <button
                key={item.entity.id}
                type="button"
                className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-2xs hover:bg-muted"
                title="设为焦点"
                onClick={() => onFocus(item.entity.id)}
              >
                <span className="font-medium">{item.entity.name}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{item.withA.join("、")} / {item.withB.join("、")}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default RelationNetworkPanel;
