/**
 * 四张正图共用的 tidy-tree 画布。
 *
 * 坐标来自 layoutTidyTree（横向：根在左）。折叠后只布局可见子树。
 * 完整画布：滚轮缩放、拖空白平移、拖节点改布局（偏移叠在 tidy 坐标上）。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, LocateFixed, Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";

import {
  collectDefaultExpanded,
  indexCanonicalTree,
  toLayoutInput,
  type CanonicalForest,
  type CanonicalTreeNode,
} from "../../engine/narrative-taxonomy/canonical-trees";
import { layoutTidyTree } from "../../engine/narrative-taxonomy/tidy-tree-layout";

export interface TidyTreeCanvasProps {
  readonly forest: CanonicalForest;
  readonly expanded: ReadonlySet<string>;
  readonly selectedId?: string | null;
  readonly matchedIds?: ReadonlySet<string>;
  readonly onToggle: (id: string) => void;
  readonly onSelect: (node: CanonicalTreeNode) => void;
  readonly onOpenEntry?: (entryId: string, label: string) => void;
  readonly onOpenChapter?: (chapterNumber: number) => void;
  readonly className?: string;
}

const NODE_WIDTH = 168;
const NODE_HEIGHT = 32;
const PAD_X = 28;
const PAD_Y = 24;
const DEPTH_SPACING = 220;
const BREADTH_SPACING = 40;
const MIN_SCALE = 0.35;
const MAX_SCALE = 2.8;
const DRAG_THRESHOLD = 4;

const KIND_FILL: Record<CanonicalTreeNode["kind"], string> = {
  root: "var(--primary)",
  group: "var(--primary)",
  dimension: "var(--primary)",
  feature: "color-mix(in oklch, var(--primary) 70%, transparent)",
  category: "color-mix(in oklch, var(--muted-foreground) 45%, transparent)",
  volume: "color-mix(in oklch, var(--primary) 80%, transparent)",
  chapter: "color-mix(in oklch, var(--muted-foreground) 55%, transparent)",
  beat: "color-mix(in oklch, var(--muted-foreground) 40%, transparent)",
  entity: "color-mix(in oklch, var(--primary) 75%, transparent)",
  entry: "color-mix(in oklch, var(--muted-foreground) 50%, transparent)",
  event: "color-mix(in oklch, var(--muted-foreground) 60%, transparent)",
  character: "color-mix(in oklch, var(--primary) 65%, transparent)",
  // 剧情线是因果树的根层，与卷同重；场景是两棵树共用的叶子，与章同色系但更淡。
  storyline: "color-mix(in oklch, var(--primary) 80%, transparent)",
  scene: "color-mix(in oklch, var(--muted-foreground) 45%, transparent)",
};

interface ViewTransform {
  x: number;
  y: number;
  scale: number;
}

interface Offset {
  x: number;
  y: number;
}

type DragState =
  | { kind: "pan"; startX: number; startY: number; origX: number; origY: number; moved: boolean }
  | { kind: "node"; id: string; startX: number; startY: number; origX: number; origY: number; moved: boolean };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isPrimaryPointer(event: { button?: number }): boolean {
  return event.button == null || event.button === 0;
}

function nodeAction(node: CanonicalTreeNode, props: TidyTreeCanvasProps): void {
  props.onSelect(node);
  if (node.kind === "entry" && node.entryId && props.onOpenEntry) {
    props.onOpenEntry(node.entryId, node.label);
    return;
  }
  if ((node.kind === "entity" || node.kind === "character") && node.entryId && props.onOpenEntry) {
    props.onOpenEntry(node.entryId, node.label);
    return;
  }
  if ((node.kind === "chapter" || node.kind === "event") && node.chapterNumber && props.onOpenChapter) {
    props.onOpenChapter(node.chapterNumber);
  }
}

function zoomToward(current: ViewTransform, localX: number, localY: number, nextScale: number): ViewTransform {
  const scale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
  const worldX = (localX - current.x) / current.scale;
  const worldY = (localY - current.y) / current.scale;
  return { scale, x: localX - worldX * scale, y: localY - worldY * scale };
}

export function TidyTreeCanvas(props: TidyTreeCanvasProps) {
  const { forest, expanded, selectedId, matchedIds, onToggle, className } = props;
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const transformRef = useRef<ViewTransform>({ x: 0, y: 0, scale: 1 });
  const [transform, setTransform] = useState<ViewTransform>({ x: 0, y: 0, scale: 1 });
  const [offsets, setOffsets] = useState<Record<string, Offset>>({});
  const [cursor, setCursor] = useState<"grab" | "grabbing" | "move">("grab");
  const index = useMemo(() => indexCanonicalTree(forest.root), [forest]);

  transformRef.current = transform;

  useEffect(() => {
    const next = { x: 0, y: 0, scale: 1 };
    transformRef.current = next;
    setTransform(next);
    setOffsets({});
    dragRef.current = null;
  }, [forest.kind, forest.root.id]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      const current = transformRef.current;
      const rect = el.getBoundingClientRect();
      const next = zoomToward(
        current,
        event.clientX - rect.left,
        event.clientY - rect.top,
        current.scale * factor,
      );
      transformRef.current = next;
      setTransform(next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [forest.root.children.length]);

  const layout = useMemo(() => {
    const effective = expanded.size > 0 ? expanded : collectDefaultExpanded(forest.root);
    return layoutTidyTree(toLayoutInput(forest.root, effective), {
      depthSpacing: DEPTH_SPACING,
      breadthSpacing: BREADTH_SPACING,
    });
  }, [forest, expanded]);

  const [minBreadth, maxBreadth] = layout.breadthExtent;
  const width = Math.max(320, layout.maxDepth * DEPTH_SPACING + NODE_WIDTH + PAD_X * 2);
  const height = Math.max(160, (maxBreadth - minBreadth) + NODE_HEIGHT + PAD_Y * 2);

  const placed = useMemo(() => {
    return [...layout.points.values()].flatMap((point) => {
      const node = index.get(point.id);
      if (!node) return [];
      const offset = offsets[point.id];
      return [{
        node,
        x: point.depthCoord + PAD_X + (offset?.x ?? 0),
        y: point.breadthCoord - minBreadth + PAD_Y + (offset?.y ?? 0),
      }];
    });
  }, [index, layout, minBreadth, offsets]);

  const byId = useMemo(() => new Map(placed.map((item) => [item.node.id, item])), [placed]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      drag.moved = true;
      if (drag.kind === "pan") {
        const next = { ...transformRef.current, x: drag.origX + dx, y: drag.origY + dy };
        transformRef.current = next;
        setTransform(next);
        setCursor("grabbing");
        return;
      }
      const scale = transformRef.current.scale || 1;
      setOffsets((current) => ({
        ...current,
        [drag.id]: { x: drag.origX + dx / scale, y: drag.origY + dy / scale },
      }));
      setCursor("move");
    };
    const onUp = () => {
      const drag = dragRef.current;
      dragRef.current = null;
      setCursor("grab");
      if (drag?.kind === "node" && drag.moved) suppressClickRef.current = true;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  function localPoint(clientX: number, clientY: number): { x: number; y: number } {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return { x: clientX, y: clientY };
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function applyZoom(nextScale: number, clientX?: number, clientY?: number) {
    const rect = viewportRef.current?.getBoundingClientRect();
    const local = clientX !== undefined && clientY !== undefined
      ? localPoint(clientX, clientY)
      : { x: (rect?.width ?? 320) / 2, y: (rect?.height ?? 160) / 2 };
    setTransform((current) => {
      const next = zoomToward(current, local.x, local.y, nextScale);
      transformRef.current = next;
      return next;
    });
  }

  function resetView() {
    const next = { x: 0, y: 0, scale: 1 };
    transformRef.current = next;
    setTransform(next);
    setOffsets({});
  }

  if (forest.root.children.length === 0) {
    return (
      <div
        className={`flex h-full min-h-[12rem] flex-col items-center justify-center gap-1 p-6 text-center ${className ?? ""}`}
        data-testid="tidy-tree-empty"
        data-kind={forest.kind}
      >
        <p className="text-xs font-medium">这张图还是空的</p>
        <p className="max-w-sm text-[11px] leading-relaxed text-muted-foreground">
          {forest.emptyReason ?? "没有可显示的节点。"}
        </p>
      </div>
    );
  }

  return (
    <div
      ref={viewportRef}
      className={`relative min-h-0 flex-1 overflow-hidden ${className ?? ""}`}
      data-testid="tidy-tree-canvas"
      data-kind={forest.kind}
      data-zoom={transform.scale.toFixed(2)}
      data-pan-x={String(transform.x)}
      data-pan-y={String(transform.y)}
      style={{ cursor, touchAction: "none" }}
      onPointerDown={(event) => {
        if (!isPrimaryPointer(event)) return;
        const target = event.target as HTMLElement | null;
        if (target?.closest("button,[data-slot='button']")) return;
        dragRef.current = {
          kind: "pan",
          startX: event.clientX,
          startY: event.clientY,
          origX: transform.x,
          origY: transform.y,
          moved: false,
        };
        setCursor("grabbing");
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag) return;
        const dx = event.clientX - drag.startX;
        const dy = event.clientY - drag.startY;
        if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        drag.moved = true;
        if (drag.kind === "pan") {
          const next = { ...transformRef.current, x: drag.origX + dx, y: drag.origY + dy };
          transformRef.current = next;
          setTransform(next);
          setCursor("grabbing");
          return;
        }
        const scale = transformRef.current.scale || 1;
        setOffsets((current) => ({
          ...current,
          [drag.id]: { x: drag.origX + dx / scale, y: drag.origY + dy / scale },
        }));
        setCursor("move");
      }}
      onPointerUp={() => {
        const drag = dragRef.current;
        dragRef.current = null;
        setCursor("grab");
        if (drag?.kind === "node" && drag.moved) suppressClickRef.current = true;
      }}
    >
      <div className="absolute right-2 top-2 z-[1] flex items-center gap-1 rounded-md border bg-background/90 p-0.5 shadow-sm">
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="h-6 w-6 p-0"
          aria-label="缩小"
          data-testid="tidy-tree-zoom-out"
          onClick={() => applyZoom(transform.scale / 1.2)}
        >
          <Minus className="size-3" />
        </Button>
        <span className="min-w-10 text-center text-[10px] tabular-nums text-muted-foreground" data-testid="tidy-tree-zoom-label">
          {Math.round(transform.scale * 100)}%
        </span>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="h-6 w-6 p-0"
          aria-label="放大"
          data-testid="tidy-tree-zoom-in"
          onClick={() => applyZoom(transform.scale * 1.2)}
        >
          <Plus className="size-3" />
        </Button>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="h-6 px-1.5 text-[10px]"
          aria-label="复位视图"
          data-testid="tidy-tree-reset"
          onClick={resetView}
        >
          <LocateFixed className="size-3" />
        </Button>
      </div>

      <div
        data-testid="tidy-tree-stage"
        style={{
          width,
          height,
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          transformOrigin: "0 0",
        }}
      >
        <svg
          role="tree"
          aria-label={forest.root.label}
          width={width}
          height={height}
          className="block"
        >
          {layout.edges.map((edge) => {
            const from = byId.get(edge.from);
            const to = byId.get(edge.to);
            if (!from || !to) return null;
            const x1 = from.x + NODE_WIDTH;
            const y1 = from.y + NODE_HEIGHT / 2;
            const x2 = to.x;
            const y2 = to.y + NODE_HEIGHT / 2;
            const mid = (x1 + x2) / 2;
            return (
              <path
                key={`${edge.from}->${edge.to}`}
                d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke="currentColor"
                strokeOpacity={0.28}
                strokeWidth={1.2}
              />
            );
          })}
          {placed.map(({ node, x, y }) => {
            const hasChildren = node.children.length > 0;
            const isExpanded = expanded.has(node.id);
            const selected = selectedId === node.id;
            const matched = Boolean(matchedIds?.has(node.id));
            return (
              <g
                key={node.id}
                transform={`translate(${x} ${y})`}
                data-testid={`tidy-tree-row-${node.id}`}
                data-x={x.toFixed(1)}
                data-y={y.toFixed(1)}
                onPointerDown={(event) => {
                  if (!isPrimaryPointer(event)) return;
                  event.stopPropagation();
                  const target = event.target as HTMLElement | null;
                  if (target?.closest("[data-testid^='tidy-tree-toggle-']")) return;
                  dragRef.current = {
                    kind: "node",
                    id: node.id,
                    startX: event.clientX,
                    startY: event.clientY,
                    origX: offsets[node.id]?.x ?? 0,
                    origY: offsets[node.id]?.y ?? 0,
                    moved: false,
                  };
                }}
              >
                <rect
                  width={NODE_WIDTH}
                  height={NODE_HEIGHT}
                  rx={6}
                  className={selected ? "stroke-primary" : matched ? "stroke-amber-500/70" : "stroke-border"}
                  fill="var(--card)"
                  strokeWidth={selected || matched ? 1.6 : 1}
                />
                <rect width={3} height={NODE_HEIGHT} rx={1.5} fill={KIND_FILL[node.kind]} />
                {hasChildren ? (
                  <foreignObject x={4} y={4} width={20} height={24}>
                    <button
                      type="button"
                      className="flex size-5 items-center justify-center text-muted-foreground hover:text-foreground"
                      style={{ width: "100%", height: "100%" }}
                      aria-label={isExpanded ? `折叠 ${node.label}` : `展开 ${node.label}`}
                      aria-expanded={isExpanded}
                      data-testid={`tidy-tree-toggle-${node.id}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggle(node.id);
                      }}
                    >
                      {isExpanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                    </button>
                  </foreignObject>
                ) : null}
                <foreignObject x={hasChildren ? 24 : 10} y={1} width={NODE_WIDTH - (hasChildren ? 28 : 14)} height={NODE_HEIGHT - 2}>
                  <button
                    type="button"
                    className="flex h-full w-full cursor-grab items-center gap-1 overflow-hidden text-left"
                    style={{ width: "100%", height: "100%" }}
                    data-testid={`tidy-tree-node-${node.id}`}
                    title={node.detail ?? node.label}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (suppressClickRef.current) {
                        suppressClickRef.current = false;
                        return;
                      }
                      nodeAction(node, props);
                    }}
                  >
                    <span className="min-w-0 truncate text-[11px] font-medium">{node.label}</span>
                    {node.kind !== "entry" && node.kind !== "chapter" && node.kind !== "entity" && node.count > 0 ? (
                      <span className="shrink-0 text-[9px] text-muted-foreground">{` · ${node.count}`}</span>
                    ) : null}
                  </button>
                </foreignObject>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

export default TidyTreeCanvas;
