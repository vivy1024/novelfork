/**
 * 因果画布：剧情线 × 场景（故事树 › 因果树）。
 *
 * 横轴按章，纵轴按剧情线分泳道；每个场景只画一次，住在主剧情线的泳道里，
 * 同时服务的其他线跨泳道经过它。伏笔回收画成虚线。
 * 左侧泳道名与顶部章号冻结，平移缩放时始终看得见。
 *
 * 编辑：把场景上下拖到另一条泳道 = 改主剧情线（拖进「未挂线」= 摘下全部挂载）；
 * 右侧面板加 / 摘辅助挂载、新建剧情线。每次改动后重读场景图，画布以服务端为准。
 * 场景本身（章、次序、内容）不在这里改：它们归承载树与正文。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  useViewport,
  type NodeChange,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AlertCircle, BookOpen, Info, Loader2, Plus, RefreshCw, Trash2, X } from "lucide-react";

import {
  buildCausalGraph,
  SCENE_FUNCTION_LABEL,
  STORYLINE_KIND_LABEL,
  UNMOUNTED_LANE_ID,
  type CausalGraph,
  type CausalLane,
} from "../../../engine/narrative-taxonomy/causal-graph";
import type { NarrativeStructurePayload } from "../../../engine/narrative-taxonomy/narrative-structure";
import { STALLED_LANE_GAP } from "../story-progress-board";
import { useWritingProgressRefresh } from "../use-writing-progress-refresh";
import {
  LANE_HEIGHT,
  initialViewport,
  laneAtY,
  laneColor,
  layoutCausalGraph,
  RAIL_SCREEN_WIDTH,
  RULER_SCREEN_HEIGHT,
  toCausalFlow,
  type CausalCanvasEdge,
  type CausalCanvasNode,
  type CausalLayout,
} from "./causal-canvas-layout";
import { causalEdgeTypes, causalNodeTypes } from "./CausalCanvasNodes";

type SceneGraphData = Pick<NarrativeStructurePayload, "scenes" | "storylines" | "mounts">;
type Mount = NarrativeStructurePayload["mounts"][number];

export interface CausalCanvasProps {
  readonly bookId: string;
  readonly structure: NarrativeStructurePayload;
  /** 面板顶部的搜索词：命中的场景描边高亮。 */
  readonly query?: string;
  readonly onOpenChapter?: (chapterNumber: number) => void;
  readonly className?: string;
}

type Selection = { readonly kind: "scene" | "lane"; readonly id: string } | null;

/** 适配视图时给冻结的泳道名栏（左）与章号栏（上）留出位置，场景不会藏在它们下面。 */
const FIT_PADDING = { left: `${RAIL_SCREEN_WIDTH + 8}px`, top: `${RULER_SCREEN_HEIGHT + 16}px`, right: "24px", bottom: "24px" } as const;

async function send<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const json = (await res.json().catch(() => null)) as ({ ok?: boolean; summary?: string; error?: string } & T) | null;
  if (!res.ok || json?.ok === false) throw new Error(json?.summary || json?.error || `请求失败：HTTP ${res.status}`);
  return json as T;
}

/** 与服务端 setScenePrimaryStoryline 同一规则的本地预演：拖放后立刻看到结果，重读后以服务端为准。 */
function moveLocally(mounts: readonly Mount[], sceneId: string, storylineId: string | null): Mount[] {
  const others = mounts.filter((mount) => mount.sceneId !== sceneId);
  if (storylineId === null) return others;
  const own = mounts
    .filter((mount) => mount.sceneId === sceneId && mount.storylineId !== storylineId && mount.role === "supporting");
  return [...others, ...own, { sceneId, storylineId, role: "primary", createdAt: Date.now() }];
}

/** 冻结的泳道名栏与章号栏：跟着视口的平移缩放走，但固定贴在左边和上边。 */
function FrozenRulers({ graph, layout, selectedLaneId, onSelectLane }: {
  graph: CausalGraph;
  layout: CausalLayout;
  selectedLaneId: string | null;
  onSelectLane: (laneId: string) => void;
}) {
  const { x, y, zoom } = useViewport();
  return (
    <>
      <div className="pointer-events-none absolute inset-y-0 left-0 z-[5]" style={{ width: RAIL_SCREEN_WIDTH }} data-testid="causal-lane-rail">
        {graph.lanes.map((lane) => {
          const top = y + layout.laneTops.get(lane.id)! * zoom;
          const height = LANE_HEIGHT * zoom;
          const color = laneColor(graph, lane.id);
          return (
            <button
              key={lane.id}
              type="button"
              onClick={() => onSelectLane(lane.id)}
              className={`pointer-events-auto absolute left-0 flex flex-col justify-center gap-0.5 overflow-hidden border-r bg-background/90 px-2 text-left backdrop-blur-sm ${selectedLaneId === lane.id ? "ring-2 ring-inset ring-primary" : ""}`}
              style={{ top, height, width: RAIL_SCREEN_WIDTH, borderLeft: `4px solid ${color}` }}
              data-testid={`causal-lane-label-${lane.id}`}
            >
              <span className="truncate text-xs font-medium">{lane.label}</span>
              {height > 40 ? (
                <span className="truncate text-2xs text-muted-foreground">
                  {lane.storyline ? `${lane.kindLabel} · ` : ""}{lane.sceneCount} 场{lane.lastChapter !== undefined ? ` · 至第 ${lane.lastChapter} 章` : ""}
                </span>
              ) : null}
              {lane.stalledChapters !== undefined && height > 56 ? (
                <span className="truncate text-2xs text-amber-600">已 {lane.stalledChapters} 章没推进</span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[4] overflow-hidden border-b bg-background/90 backdrop-blur-sm" style={{ height: RULER_SCREEN_HEIGHT }} data-testid="causal-chapter-ruler">
        {layout.columns.map((column) => (
          <span
            key={column.chapterNumber}
            className="absolute top-1.5 truncate text-center text-2xs font-medium text-muted-foreground"
            style={{ left: x + column.x * zoom, width: column.width * zoom }}
          >
            第 {column.chapterNumber} 章
          </span>
        ))}
      </div>
    </>
  );
}

function laneSummary(lane: CausalLane): string {
  const parts = [lane.kindLabel, lane.storyline?.lifecycle ? LIFECYCLE_LABEL[lane.storyline.lifecycle] ?? lane.storyline.lifecycle : ""].filter(Boolean);
  return parts.join(" · ");
}

const LIFECYCLE_LABEL: Record<string, string> = {
  planned: "计划中",
  active: "进行中",
  paused: "暂停",
  resolved: "已收束",
  abandoned: "已放弃",
};

export function CausalCanvas({ bookId, structure, query, onOpenChapter, className }: CausalCanvasProps) {
  const base = `/api/books/${encodeURIComponent(bookId)}/narrative-memory`;
  const [data, setData] = useState<SceneGraphData>(structure);
  const [selection, setSelection] = useState<Selection>(null);
  const [dropLaneId, setDropLaneId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHooks, setShowHooks] = useState(true);
  // 右侧面板平时收起，把宽度让给画布；选中场景 / 泳道时展开，也可手动打开看说明、新建剧情线。
  const [panelOpen, setPanelOpen] = useState(false);
  const [newLineName, setNewLineName] = useState("");
  const [newLineKind, setNewLineKind] = useState("sub");
  const [addLineId, setAddLineId] = useState("");
  const [instance, setInstance] = useState<ReactFlowInstance<CausalCanvasNode, CausalCanvasEdge> | null>(null);
  const paneRef = useRef<HTMLDivElement>(null);

  useEffect(() => setData(structure), [structure]);

  const refresh = useCallback(async () => {
    try {
      const next = await send<SceneGraphData>(`${base}/scene-graph`, "GET");
      setData({ scenes: next.scenes, storylines: next.storylines, mounts: next.mounts });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [base]);
  // 写章、结算落盘场景后自动重读，不必手动刷新。
  useWritingProgressRefresh(bookId, () => void refresh());

  const graph = useMemo(() => buildCausalGraph({
    storylines: data.storylines,
    scenes: data.scenes,
    mounts: data.mounts,
    foreshadows: structure.foreshadows,
    currentChapter: structure.currentChapter,
    stalledGap: STALLED_LANE_GAP,
  }), [data, structure.foreshadows, structure.currentChapter]);
  const layout = useMemo(() => layoutCausalGraph(graph), [graph]);
  const flow = useMemo(() => toCausalFlow(graph, layout, {
    selectedSceneId: selection?.kind === "scene" ? selection.id : null,
    focusLaneId: selection?.kind === "lane" ? selection.id : null,
    query: query ?? "",
    dropLaneId,
    showHooks,
  }), [graph, layout, selection, query, dropLaneId, showHooks]);

  const [nodes, setNodes] = useState<CausalCanvasNode[]>(flow.nodes);
  useEffect(() => setNodes(flow.nodes), [flow.nodes]);

  // 拖动只改纵向：场景的 x 由章决定，横向拖动没有意义。
  const onNodesChange = useCallback((changes: NodeChange<CausalCanvasNode>[]) => {
    setNodes((current) => applyNodeChanges(
      changes
        .filter((change) => change.type !== "remove")
        .map((change) => {
          if (change.type !== "position" || !change.position) return change;
          const home = layout.scenePositions.get(change.id);
          return home ? { ...change, position: { x: home.x, y: change.position.y } } : change;
        }),
      current,
    ));
  }, [layout]);

  const mutate = useCallback(async (optimistic: ((current: SceneGraphData) => SceneGraphData) | null, request: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    const before = data;
    if (optimistic) setData(optimistic(before));
    try {
      await request();
      await refresh();
    } catch (cause) {
      setData(before);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [data, refresh]);

  const moveScene = useCallback((sceneId: string, laneId: string) => {
    const storylineId = laneId === UNMOUNTED_LANE_ID ? null : laneId;
    void mutate(
      (current) => ({ ...current, mounts: moveLocally(current.mounts, sceneId, storylineId) }),
      () => send(`${base}/scenes/${encodeURIComponent(sceneId)}/primary-storyline`, "PUT", { storylineId }),
    );
  }, [base, mutate]);

  const selectedScene = selection?.kind === "scene" ? graph.scenes.find((node) => node.scene.id === selection.id) : undefined;
  const selectedLane = selection?.kind === "lane" ? graph.lanes.find((lane) => lane.id === selection.id) : undefined;
  const nameOf = (storylineId: string) => graph.lanes.find((lane) => lane.id === storylineId)?.label ?? storylineId;
  const mountable = selectedScene
    ? graph.lanes.filter((lane) => lane.storyline && !selectedScene.mounts.some((mount) => mount.storylineId === lane.id))
    : [];

  const createStoryline = () => {
    const name = newLineName.trim();
    if (!name) return;
    void mutate(null, async () => {
      await send(`${base}/storylines`, "POST", { name, kind: newLineKind });
      setNewLineName("");
    });
  };

  const fieldClass = "rounded border bg-background px-2 py-1 text-xs outline-none focus:border-primary";

  return (
    <div className={className ?? "flex h-full min-h-0 gap-2"} data-testid="causal-canvas">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
          <span>{graph.lanes.length - 1} 条线 · {graph.scenes.length} 场 · {graph.hookLinks.length} 处伏笔回收</span>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={showHooks} onChange={(event) => setShowHooks(event.target.checked)} aria-label="显示伏笔线" />
            伏笔线
          </label>
          <span>把场景上下拖到另一条线 = 改主剧情线；点左侧线名只看这条线。</span>
          {busy ? <Loader2 className="size-3 animate-spin" /> : null}
          <button
            type="button"
            onClick={() => setPanelOpen((value) => !value)}
            aria-pressed={panelOpen}
            className="ml-auto flex items-center gap-1 rounded border px-1.5 py-0.5 hover:bg-muted"
          >
            <Info className="size-3" />
            说明 / 新建剧情线
          </button>
          <button type="button" title="重读场景图" onClick={() => void refresh()} className="rounded border p-1 hover:bg-muted">
            <RefreshCw className="size-3" />
          </button>
        </div>
        {error ? (
          <div role="alert" className="flex items-center gap-1.5 rounded border border-destructive/40 bg-destructive/5 px-2 py-1 text-2xs text-destructive" data-testid="causal-canvas-error">
            <AlertCircle className="size-3 shrink-0" />
            <span className="flex-1">{error}</span>
            <button type="button" onClick={() => setError(null)} aria-label="关闭"><X className="size-3" /></button>
          </div>
        ) : null}
        <div ref={paneRef} className="relative min-h-0 flex-1 overflow-hidden rounded-md border">
          <ReactFlow<CausalCanvasNode, CausalCanvasEdge>
            nodes={nodes}
            edges={flow.edges}
            nodeTypes={causalNodeTypes}
            edgeTypes={causalEdgeTypes}
            defaultEdgeOptions={{ markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 } }}
            onNodesChange={onNodesChange}
            onNodeClick={(_, node) => setSelection(node.type === "scene" ? { kind: "scene", id: node.id } : null)}
            onPaneClick={() => setSelection(null)}
            onNodeDrag={(_, node) => {
              if (node.type === "scene") setDropLaneId(laneAtY(graph, node.position.y).id);
            }}
            onNodeDragStop={(_, node) => {
              setDropLaneId(null);
              if (node.type !== "scene") return;
              const target = laneAtY(graph, node.position.y);
              const current = graph.scenes.find((candidate) => candidate.scene.id === node.id);
              if (current && target.id !== current.laneId) moveScene(node.id, target.id);
              else setNodes(flow.nodes);
            }}
            onInit={(ready) => {
              setInstance(ready);
              const pane = paneRef.current?.getBoundingClientRect();
              void ready.setViewport(initialViewport(layout, { width: pane?.width || 800, height: pane?.height || 600 }));
            }}
            nodesConnectable={false}
            deleteKeyCode={null}
            onlyRenderVisibleElements
            minZoom={0.2}
            maxZoom={1.6}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
            <Controls showInteractive={false} position="bottom-right" />
            <MiniMap pannable zoomable position="top-right" className="!top-8" style={{ width: 150, height: 90 }} nodeColor={(node) => (node.type === "scene" ? String((node.data as { homeColor?: string }).homeColor ?? "#94a3b8") : "transparent")} />
            <FrozenRulers
              graph={graph}
              layout={layout}
              selectedLaneId={selection?.kind === "lane" ? selection.id : null}
              onSelectLane={(laneId) => setSelection((current) => (current?.kind === "lane" && current.id === laneId ? null : { kind: "lane", id: laneId }))}
            />
          </ReactFlow>
          {graph.scenes.length === 0 ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center text-xs text-muted-foreground" data-testid="causal-canvas-empty">
              还没有场景。写作管线会把每章的场景蓝图落成场景；也可以在「推进」看板上给剧情线加节拍。
            </div>
          ) : null}
        </div>
      </div>

      {selection || panelOpen ? (
      <aside className="relative w-64 shrink-0 space-y-3 overflow-y-auto rounded-md border p-2.5 text-xs" data-testid="causal-inspector">
        <button
          type="button"
          aria-label="收起面板"
          className="absolute right-1.5 top-1.5 rounded p-0.5 text-muted-foreground hover:bg-muted"
          onClick={() => {
            setSelection(null);
            setPanelOpen(false);
          }}
        >
          <X className="size-3" />
        </button>
        {selectedScene ? (
          <>
            <div className="space-y-0.5">
              <div className="font-semibold">{selectedScene.scene.title?.trim() || `第 ${selectedScene.scene.ordinal} 场`}</div>
              <div className="text-2xs text-muted-foreground">
                第 {selectedScene.scene.chapterNumber} 章 · 第 {selectedScene.scene.ordinal} 场
                {selectedScene.scene.function ? ` · ${SCENE_FUNCTION_LABEL[selectedScene.scene.function] ?? selectedScene.scene.function}` : ""}
              </div>
              {selectedScene.scene.status === "needs-review" ? (
                <div className="rounded bg-amber-50 px-1.5 py-1 text-2xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">机器拆出的场景，确认前不要当作定论。</div>
              ) : null}
            </div>
            {selectedScene.scene.summary ? <p className="whitespace-pre-wrap text-2xs leading-relaxed text-muted-foreground">{selectedScene.scene.summary}</p> : null}
            <div className="space-y-1.5">
              <div className="text-2xs font-medium text-muted-foreground">服务的剧情线</div>
              {selectedScene.mounts.length === 0 ? <div className="text-2xs text-muted-foreground">还没有挂到任何剧情线。</div> : null}
              {selectedScene.mounts.map((mount) => (
                <div key={mount.storylineId} className="flex items-center gap-1.5" data-testid={`causal-mount-${mount.storylineId}`}>
                  <span className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: laneColor(graph, mount.storylineId) }} />
                  <span className="flex-1 truncate">{nameOf(mount.storylineId)}</span>
                  <span className="text-2xs text-muted-foreground">{mount.role === "primary" ? "主" : "辅"}</span>
                  {mount.role === "supporting" ? (
                    <button type="button" disabled={busy} className="rounded border px-1 text-2xs hover:bg-muted disabled:opacity-50" onClick={() => moveScene(selectedScene.scene.id, mount.storylineId)}>
                      设为主线
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={busy}
                    title="从这条线上摘下"
                    aria-label={`从「${nameOf(mount.storylineId)}」摘下`}
                    className="rounded p-0.5 text-destructive hover:bg-destructive/10 disabled:opacity-50"
                    onClick={() => void mutate(
                      (current) => ({ ...current, mounts: current.mounts.filter((item) => !(item.sceneId === selectedScene.scene.id && item.storylineId === mount.storylineId)) }),
                      () => send(`${base}/scenes/${encodeURIComponent(selectedScene.scene.id)}/mounts/${encodeURIComponent(mount.storylineId)}`, "DELETE"),
                    )}
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              ))}
              {mountable.length > 0 ? (
                <div className="flex items-center gap-1">
                  <select aria-label="挂到剧情线" value={addLineId} onChange={(event) => setAddLineId(event.target.value)} className={`${fieldClass} min-w-0 flex-1`}>
                    <option value="">也服务于……</option>
                    {mountable.map((lane) => <option key={lane.id} value={lane.id}>{lane.label}</option>)}
                  </select>
                  <button
                    type="button"
                    disabled={busy || !addLineId}
                    className="flex items-center gap-0.5 rounded border px-1.5 py-1 text-2xs hover:bg-muted disabled:opacity-50"
                    onClick={() => {
                      const storylineId = addLineId;
                      const role = selectedScene.mounts.length === 0 ? "primary" : "supporting";
                      setAddLineId("");
                      void mutate(
                        (current) => ({ ...current, mounts: [...current.mounts, { sceneId: selectedScene.scene.id, storylineId, role, createdAt: Date.now() }] }),
                        () => send(`${base}/scenes/${encodeURIComponent(selectedScene.scene.id)}/mounts`, "POST", { storylineId, role }),
                      );
                    }}
                  >
                    <Plus className="size-3" />
                    挂上
                  </button>
                </div>
              ) : null}
            </div>
            {(selectedScene.scene.hooksPlanted?.length || selectedScene.scene.hooksUsed?.length) ? (
              <div className="space-y-0.5 text-2xs">
                <div className="font-medium text-muted-foreground">伏笔</div>
                {selectedScene.scene.hooksPlanted?.length ? <div>埋下：{selectedScene.scene.hooksPlanted.join("、")}</div> : null}
                {selectedScene.scene.hooksUsed?.length ? <div>回收：{selectedScene.scene.hooksUsed.join("、")}</div> : null}
                {selectedScene.openHooks.length ? <div className="text-amber-600">之后还没回收：{selectedScene.openHooks.join("、")}</div> : null}
              </div>
            ) : null}
            {onOpenChapter ? (
              <button type="button" className="flex items-center gap-1 rounded border px-2 py-1 text-2xs hover:bg-muted" onClick={() => onOpenChapter(selectedScene.scene.chapterNumber)}>
                <BookOpen className="size-3" />
                打开第 {selectedScene.scene.chapterNumber} 章
              </button>
            ) : null}
          </>
        ) : selectedLane ? (
          <>
            <div className="space-y-0.5">
              <div className="flex items-center gap-1.5 font-semibold">
                <span className="inline-block size-2.5 rounded-full" style={{ background: laneColor(graph, selectedLane.id) }} />
                {selectedLane.label}
              </div>
              {laneSummary(selectedLane) ? <div className="text-2xs text-muted-foreground">{laneSummary(selectedLane)}</div> : null}
            </div>
            {selectedLane.storyline?.goal ? <p className="text-2xs leading-relaxed text-muted-foreground">目标：{selectedLane.storyline.goal}</p> : null}
            <div className="text-2xs">
              {selectedLane.sceneCount} 场{selectedLane.lastChapter !== undefined ? `，最近推进到第 ${selectedLane.lastChapter} 章` : "，还没有场景"}
              {selectedLane.stalledChapters !== undefined ? <span className="text-amber-600">，已 {selectedLane.stalledChapters} 章没推进</span> : null}
            </div>
            <p className="text-2xs text-muted-foreground">画布上只突出这条线经过的场景；再点一次线名取消。</p>
          </>
        ) : (
          <>
            <div className="space-y-1 text-2xs text-muted-foreground">
              <div className="font-medium text-foreground">怎么看</div>
              <div>每条横道是一条剧情线，场景住在它的主剧情线上；同色实线把这条线服务的场景按章串起来，跨道的线表示场景同时服务这条线。</div>
              <div>橙色虚线：伏笔从埋下的场景指向回收它的场景。「悬」表示之后还没有场景回收。</div>
              <div>虚线框、标「待审」的是机器拆出的场景。</div>
            </div>
            <div className="space-y-1.5 border-t pt-2">
              <div className="text-2xs font-medium">新建剧情线</div>
              <input aria-label="剧情线名称" value={newLineName} onChange={(event) => setNewLineName(event.target.value)} placeholder="例如：师门旧案" className={`${fieldClass} w-full`} />
              <div className="flex items-center gap-1">
                <select aria-label="剧情线类别" value={newLineKind} onChange={(event) => setNewLineKind(event.target.value)} className={`${fieldClass} flex-1`}>
                  {Object.entries(STORYLINE_KIND_LABEL).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
                </select>
                <button type="button" disabled={busy || !newLineName.trim()} onClick={createStoryline} className="flex items-center gap-0.5 rounded bg-primary px-2 py-1 text-2xs text-primary-foreground disabled:opacity-50">
                  <Plus className="size-3" />
                  新建
                </button>
              </div>
            </div>
          </>
        )}
        {instance && graph.scenes.length > 0 ? (
          <button type="button" className="text-2xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => void instance.fitView({ padding: FIT_PADDING, duration: 200 })}>
            查看全书
          </button>
        ) : null}
      </aside>
      ) : null}
    </div>
  );
}

