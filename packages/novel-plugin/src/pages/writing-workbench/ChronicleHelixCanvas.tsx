/**
 * 编年史对照条 · ChronicleHelixCanvas
 *
 * 表世界（A，章摘要）与里世界（B，角色内在变化）沿章节轴分居上下两条水平轨。
 * 交叉点（冲突事实 / high 风险事件 / 张力≥8 章）标在中间轴上。
 * 不再画正弦交缠。纯 Canvas 2D 渲染。
 *
 * 数据三态独立容错：任一接口失败不连坐整体（缺哪条链就画哪条）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchJson } from "@/hooks/use-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dna, Info, Loader2, RefreshCw } from "lucide-react";

import {
  buildChronicleHelixModel,
  MAX_ARC_NODES_PER_CHAPTER,
  type ChronicleArcEvent,
  type ChronicleBeat,
  type ChronicleGraphPayload,
  type ChronicleHelixModel,
  type ChronicleSummaryInput,
} from "./chronicle-helix-data";

const CHARACTER_PALETTE = ["#8b5cf6", "#0ea5e9", "#f59e0b", "#f43f5e", "#14b8a6", "#a855f7", "#84cc16", "#fb923c"] as const;

const STRAND_A_COLOR = "#10b981";
const INTERSECTION_COLOR = "#f5b301";
const AXIS_COLOR = "rgba(128,128,128,0.35)";

const CANVAS_HEIGHT = 380;
const TRACK_OFFSET = 56;
const MIN_CHAPTER_GAP = 30;
const MAX_CHAPTER_GAP = 64;
const EDGE_PADDING = 72;

type LoadState =
  | { status: "idle" | "loading" }
  | { status: "ready"; model: ChronicleHelixModel; degradedChains: readonly string[] }
  | { status: "error"; message: string };

interface ScreenPoint {
  readonly x: number;
  readonly y: number;
  readonly chapterNumber: number;
}

interface HoverTarget {
  readonly x: number;
  readonly y: number;
  readonly kind: "beat" | "arc" | "intersection";
  readonly chapterNumber: number;
  readonly title: string;
  readonly lines: readonly string[];
  readonly characterName?: string;
  readonly entryId?: string;
}

export interface ChronicleHelixCanvasProps {
  readonly bookId?: string;
  readonly currentChapter?: number;
  /** 身份链命中时直跳经纬条目卡（复用 D批 通道）。 */
  readonly onOpenEntityDetail?: (entity: string, entryId?: string) => void;
}

function useChronicleHelixModel(bookId: string | undefined): { state: LoadState; refresh: () => void } {
  const [state, setState] = useState<LoadState>({ status: "idle" });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!bookId?.trim()) {
      setState({
        status: "ready",
        degradedChains: [],
        model: { chapters: [], strandA: new Map(), strandB: new Map(), intersections: [], topCharacters: [] },
      });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    const base = `/api/books/${encodeURIComponent(bookId)}`;
    // B 链用 event_chain 视图：timeline 视图只回 timeline/location/world_fact 三类事件，
    // 不含 character_state_changed/relationship_changed；event_chain 返回全部事件，
    //（由 chronicle-helix-data 过滤出角色状态/关系变化）。
    // 单链失败降级继续（缺哪条画哪条）；两条链全挂才进错误态给重试。
    const summaries = fetchJson<{ entries?: ChronicleSummaryInput[] }>(`${base}/jingwei/entries?category=chapter-summaries&limit=200`)
      .then((payload) => ({ payload, failed: false as const }))
      .catch(() => ({ payload: { entries: [] as ChronicleSummaryInput[] }, failed: true as const }));
    const graph = fetchJson<ChronicleGraphPayload>(`${base}/narrative-memory/graph?view=event_chain`)
      .then((payload) => ({ payload, failed: false as const }))
      .catch(() => ({ payload: {} as ChronicleGraphPayload, failed: true as const }));
    Promise.all([summaries, graph])
      .then(([summariesResult, graphResult]) => {
        if (cancelled) return;
        const degradedChains = [
          summariesResult.failed ? "章节摘要" : null,
          graphResult.failed ? "事件流" : null,
        ].filter((value): value is string => value !== null);
        if (degradedChains.length === 2) {
          setState({ status: "error", message: "章节摘要与事件流均加载失败，请检查后端服务。" });
          return;
        }
        setState({
          status: "ready",
          model: buildChronicleHelixModel(summariesResult.payload.entries ?? [], graphResult.payload),
          degradedChains,
        });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setState({ status: "error", message: cause instanceof Error ? cause.message : String(cause) });
      });
    return () => {
      cancelled = true;
    };
  }, [bookId, nonce]);

  return { state, refresh: useCallback(() => setNonce((value) => value + 1), []) };
}

interface HelixGeometry {
  readonly width: number;
  readonly gap: number;
  readonly indexByChapter: ReadonlyMap<number, number>;
  /** 章节在画布上的 x 坐标。 */
  readonly centerX: (chapterNumber: number) => number;
  readonly pointA: (chapterNumber: number) => ScreenPoint;
  readonly pointB: (chapterNumber: number) => ScreenPoint;
}

function buildGeometry(chapters: readonly number[]): HelixGeometry {
  const count = Math.max(1, chapters.length);
  const gap = chapters.length > 1
    ? Math.max(MIN_CHAPTER_GAP, Math.min(MAX_CHAPTER_GAP, 1200 / (chapters.length - 1)))
    : MAX_CHAPTER_GAP;
  const width = EDGE_PADDING * 2 + (count - 1) * gap;
  const midY = CANVAS_HEIGHT / 2;
  const indexByChapter = new Map(chapters.map((chapter, index) => [chapter, index]));

  const pointFor = (chapterNumber: number, y: number): ScreenPoint => {
    const index = indexByChapter.get(chapterNumber) ?? 0;
    return {
      x: EDGE_PADDING + index * gap,
      y,
      chapterNumber,
    };
  };

  return {
    width,
    gap,
    indexByChapter,
    centerX: (chapterNumber) => EDGE_PADDING + (indexByChapter.get(chapterNumber) ?? 0) * gap,
    pointA: (chapterNumber) => pointFor(chapterNumber, midY - TRACK_OFFSET),
    pointB: (chapterNumber) => pointFor(chapterNumber, midY + TRACK_OFFSET),
  };
}

export function ChronicleHelixCanvas({ bookId, currentChapter, onOpenEntityDetail }: ChronicleHelixCanvasProps) {
  const { state, refresh } = useChronicleHelixModel(bookId);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const geometryRef = useRef<HelixGeometry | null>(null);
  const hoverPointsRef = useRef<ReadonlyArray<HoverTarget>>([]);
  const [hover, setHover] = useState<HoverTarget | null>(null);
  const [selected, setSelected] = useState<HoverTarget | null>(null);
  /** F1 图例聚焦：单角色弧线高亮，其余节点降透明度；再点取消。 */
  const [focusCharacter, setFocusCharacter] = useState<string | null>(null);

  const characterColor = useMemo(() => {
    if (state.status !== "ready") return new Map<string, string>();
    const map = new Map<string, string>();
    state.model.topCharacters.forEach((character, index) => {
      map.set(character.name, CHARACTER_PALETTE[index % CHARACTER_PALETTE.length]!);
    });
    return map;
  }, [state]);

  // ── 绘制 ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (state.status !== "ready") return;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const draw = () => {
      const model = state.model;
      const geometry = buildGeometry(model.chapters);
      geometryRef.current = geometry;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = geometry.width * dpr;
      canvas.height = CANVAS_HEIGHT * dpr;
      canvas.style.width = `${geometry.width}px`;
      canvas.style.height = `${CANVAS_HEIGHT}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, geometry.width, CANVAS_HEIGHT);

      const midY = CANVAS_HEIGHT / 2;

      // 章节轴线
      ctx.strokeStyle = AXIS_COLOR;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(EDGE_PADDING / 2, midY);
      ctx.lineTo(geometry.width - EDGE_PADDING / 2, midY);
      ctx.stroke();

      // 当前章高亮竖线
      if (currentChapter !== undefined && geometry.indexByChapter.has(currentChapter)) {
        const x = geometry.centerX(currentChapter);
        ctx.strokeStyle = "rgba(16,185,129,0.45)";
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(x, 18);
        ctx.lineTo(x, CANVAS_HEIGHT - 24);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = STRAND_A_COLOR;
        ctx.font = "10px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`当前 ${currentChapter}`, x, 14);
      }

      const drawTrack = (y: number, color: string, label: string) => {
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.28;
        ctx.lineWidth = 8;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(EDGE_PADDING / 2, y);
        ctx.lineTo(geometry.width - EDGE_PADDING / 2, y);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = color;
        ctx.font = "10px sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(label, 8, y + 3);
      };
      drawTrack(midY - TRACK_OFFSET, STRAND_A_COLOR, "表世界");
      drawTrack(midY + TRACK_OFFSET, "#8b5cf6", "里世界");

      // 章节号刻度
      ctx.fillStyle = "rgba(128,128,128,0.75)";
      ctx.font = "9px sans-serif";
      ctx.textAlign = "center";
      const tickEvery = Math.max(1, Math.ceil(model.chapters.length / 24));
      model.chapters.forEach((chapter, index) => {
        if (index % tickEvery !== 0 && index !== model.chapters.length - 1) return;
        ctx.fillText(String(chapter), geometry.centerX(chapter), CANVAS_HEIGHT - 8);
      });

      // A 链节拍点（主线）
      const hoverTargets: HoverTarget[] = [];
      for (const [chapter, beat] of model.strandA) {
        const point = geometry.pointA(chapter);
        const tension = beat.tensionScore ?? 0;
        const radius = 3.5 + (tension / 10) * 5;
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = STRAND_A_COLOR;
        ctx.shadowColor = STRAND_A_COLOR;
        ctx.shadowBlur = tension >= 8 ? 12 : 4;
        ctx.fill();
        ctx.shadowBlur = 0;
        hoverTargets.push({
          x: point.x, y: point.y, kind: "beat", chapterNumber: chapter,
          title: `第 ${chapter} 章 · 表世界`,
          lines: [
            beat.summary ? beat.summary.slice(0, 80) : "暂无摘要",
            beat.tensionScore !== undefined ? `张力 ${beat.tensionScore}/10` : "未评张力",
          ],
        });
      }

      // B 链角色节点（聚焦模式下非聚焦角色降透明度）
      const alphaFor = (name: string): number =>
        focusCharacter && name !== focusCharacter ? 0.15 : 1;
      for (const [chapter, events] of model.strandB) {
        const visible = events.slice(0, MAX_ARC_NODES_PER_CHAPTER);
        visible.forEach((event, slot) => {
          const point = geometry.pointB(chapter);
          const jitterY = (slot - (visible.length - 1) / 2) * 10;
          const y = point.y + jitterY;
          const color = characterColor.get(event.characterName) ?? "#94a3b8";
          ctx.beginPath();
          ctx.arc(point.x, y, 3.5, 0, Math.PI * 2);
          ctx.globalAlpha = alphaFor(event.characterName);
          ctx.fillStyle = color;
          ctx.fill();
          ctx.globalAlpha = 1;
          hoverTargets.push({
            x: point.x, y, kind: "arc", chapterNumber: chapter,
            title: `第 ${chapter} 章 · ${event.characterName}`,
            lines: [event.description.slice(0, 80)],
            characterName: event.characterName,
            entryId: event.entryId,
          });
        });
        if (events.length > visible.length) {
          const point = geometry.pointB(chapter);
          ctx.fillStyle = "rgba(148,163,184,0.9)";
          ctx.font = "9px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(`+${events.length - visible.length}`, point.x + 12, point.y - 8);
        }
      }

      // 交叉点：金色菱形于轴上
      for (const intersection of model.intersections) {
        const x = geometry.centerX(intersection.chapterNumber);
        const size = 6;
        ctx.save();
        ctx.translate(x, midY);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = INTERSECTION_COLOR;
        ctx.shadowColor = INTERSECTION_COLOR;
        ctx.shadowBlur = 10;
        ctx.fillRect(-size / 2, -size / 2, size, size);
        ctx.restore();
        ctx.shadowBlur = 0;
        hoverTargets.push({
          x, y: midY, kind: "intersection", chapterNumber: intersection.chapterNumber,
          title: `第 ${intersection.chapterNumber} 章 · 关键转折`,
          lines: [
            ...intersection.reasons.map((reason) => ({
              "conflict-fact": "含冲突类目事实",
              "high-risk": "含高风险事件",
              "tension-peak": `张力峰值 ≥8`,
            })[reason]),
            intersection.label,
          ].filter(Boolean),
        });
      }

      hoverPointsRef.current = hoverTargets;
    };

    draw();

    const observer = new ResizeObserver(() => draw());
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [state, characterColor, currentChapter, focusCharacter]);

  const pickTarget = useCallback((clientX: number, clientY: number): HoverTarget | null => {
    const wrap = wrapRef.current;
    if (!wrap) return null;
    const rect = wrap.getBoundingClientRect();
    const localX = clientX - rect.left + wrap.scrollLeft;
    const localY = clientY - rect.top;
    let nearest: HoverTarget | null = null;
    let nearestDistance = 16;
    for (const target of hoverPointsRef.current) {
      const distance = Math.hypot(target.x - localX, target.y - localY);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = target;
      }
    }
    return nearest;
  }, []);

  // ── 三态外壳 ──────────────────────────────────────────────────────
  if (!bookId?.trim()) {
    return (
      <div className="flex h-full min-h-[80vh] items-center justify-center text-sm text-muted-foreground" data-testid="chronicle-helix-empty">
        先打开一本书，再查看里世界 / 表世界对照。
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="flex h-full min-h-[80vh] flex-col items-center justify-center gap-2 text-sm text-destructive" data-testid="chronicle-helix-error">
        <span>{state.message}</span>
        <Button variant="outline" size="sm" onClick={refresh}><RefreshCw className="h-3.5 w-3.5" /> 重试</Button>
      </div>
    );
  }
  if (state.status !== "ready") {
    return (
      <div className="flex h-full min-h-[80vh] items-center justify-center gap-2 text-sm text-muted-foreground" data-testid="chronicle-helix-loading">
        <Loader2 className="h-4 w-4 animate-spin" /> 正在铺开里/表世界对照…
      </div>
    );
  }

  const model = state.model;
  const isEmpty = model.chapters.length === 0;

  return (
    <div className="flex h-full min-h-[80vh] flex-col" data-testid="chronicle-helix-canvas">
      {/* 图例 */}
      <div className="flex flex-wrap items-center gap-3 border-b px-3 py-2 text-[11px] text-muted-foreground">
        {state.degradedChains.length > 0 ? (
          <Badge variant="destructive" className="text-[10px] font-normal" data-testid="chronicle-helix-degraded">
            {state.degradedChains.join("、")}加载失败，当前为残缺视图
          </Badge>
        ) : null}
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-full" style={{ background: STRAND_A_COLOR }} /> 表世界（章面）
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-full bg-violet-500" /> 里世界（角色内在）
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2 rotate-45" style={{ background: INTERSECTION_COLOR }} /> 表里交汇
        </span>
        <span className="ml-auto inline-flex items-center gap-1">
          {model.topCharacters.slice(0, 6).map((character) => {
            const active = focusCharacter === character.name;
            return (
              <Button
                key={character.name}
                variant={active ? "secondary" : "outline"}
                size="xs"
                className="h-5 gap-1 px-1.5 text-[10px] font-normal"
                aria-pressed={active}
                data-testid={`chronicle-focus-${character.name}`}
                title={active ? "取消聚焦" : "聚焦该角色弧线"}
                onClick={() => setFocusCharacter((value) => (value === character.name ? null : character.name))}
              >
                <span className="inline-block size-2 rounded-full" style={{ background: characterColor.get(character.name) ?? "#94a3b8" }} />
                {character.name}
              </Button>
            );
          })}
          {focusCharacter && (
            <Badge variant="outline" className="gap-1 text-[10px] font-normal text-primary" data-testid="chronicle-focus-active">
              聚焦 {focusCharacter}
            </Badge>
          )}
          <Button variant="ghost" size="icon" className="size-7" onClick={refresh} aria-label="刷新编年史"><RefreshCw className="size-3.5" /></Button>
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        <div
          ref={wrapRef}
          className="relative min-w-0 flex-1 overflow-x-auto overflow-y-hidden"
          data-testid="chronicle-helix-scroll"
          onMouseMove={(event) => setHover(pickTarget(event.clientX, event.clientY))}
          onMouseLeave={() => setHover(null)}
          onClick={(event) => setSelected(pickTarget(event.clientX, event.clientY))}
        >
          {isEmpty ? (
            <div className="flex h-full min-h-[320px] items-center justify-center text-xs text-muted-foreground">
              还没有可编织的章节摘要或事件。先结算几章再来。
            </div>
          ) : null}
          <canvas ref={canvasRef} className={isEmpty ? "hidden" : "block"} role="img" aria-label="里世界与表世界对照条" />
          {hover ? (
            <div
              className="pointer-events-none absolute z-10 max-w-64 rounded-md border bg-popover px-2.5 py-1.5 text-[11px] shadow-md"
              style={{
                left: Math.min(hover.x + 12, (wrapRef.current?.clientWidth ?? 400) - 270),
                top: Math.max(4, hover.y - 52),
              }}
              data-testid="chronicle-helix-tooltip"
            >
              <p className="font-semibold leading-4">{hover.title}</p>
              {hover.lines.map((line, index) => (
                <p key={index} className="mt-0.5 leading-4 text-muted-foreground">{line}</p>
              ))}
            </div>
          ) : null}
        </div>

        {/* 检查器 */}
        <aside className="w-72 shrink-0 border-l p-3" data-testid="chronicle-helix-inspector">
          {selected ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-1.5 text-sm"><Info className="size-3.5 text-primary" /> {selected.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                {selected.lines.map((line, index) => (
                  <p key={index} className="leading-5 text-muted-foreground">{line}</p>
                ))}
                {selected.kind === "arc" && selected.characterName ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="w-full gap-1.5"
                    onClick={() => onOpenEntityDetail?.(selected.characterName!, selected.entryId)}
                  >
                    打开{selected.entryId ? "关联条目卡" : "实体详情"}
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2 text-xs leading-5 text-muted-foreground">
              <p className="font-medium text-foreground">如何阅读这张图</p>
              <p>上轨是<strong>表世界</strong>：读者看见的章面推进，点越大张力越高。</p>
              <p>下轨是<strong>里世界</strong>：角色内在变化，颜色对应上方图例。</p>
              <p>中间金色菱形是<strong>表里交汇</strong>：冲突、高风险或张力峰值落在这一章。</p>
              <p>悬停查看详情，点击固定到右侧检查器。</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

export default ChronicleHelixCanvas;
