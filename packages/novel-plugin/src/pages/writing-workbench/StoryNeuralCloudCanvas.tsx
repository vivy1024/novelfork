/**
 * 故事世界网点云。
 *
 * gstack motion（DESIGN.md 克制档 + consultation token）：
 * - 唯一高潮：点击后能量沿边传播（50ms 起步，每跳 +90ms，上限 400ms）
 * - 其余只有 ambient 呼吸和 hover 放大
 * - prefers-reduced-motion：传播瞬间到位，不跑动画
 */

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { AlertTriangle, Loader2, Network, RefreshCw, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fetchJson, ApiRequestError } from "@/hooks/use-api";

import type { NarrativeEvent, NarrativeFact } from "./narrative-memory-graph-model";
import {
  activateNeuralCloud,
  buildNeuralCloudModel,
  NEURAL_CLOUD_KIND_COLOR,
  type JingweiCloudEntry,
  type NeuralCloudActivation,
  type NeuralCloudLayoutNode,
  type NeuralCloudModel,
} from "./story-neural-cloud-model";

export interface StoryNeuralCloudCanvasProps {
  readonly bookId: string;
  readonly currentChapter?: number;
  readonly initialFocusEntity?: string;
  readonly onOpenEntityDetail?: (entity: string, entryId?: string) => void;
  readonly onOpenChapter?: (chapterNumber: number) => void;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; entries: JingweiCloudEntry[]; facts: NarrativeFact[]; events: NarrativeEvent[] };

const SETTING_QUERY_CATEGORIES = ["characters", "factions", "locations", "props", "relationships", "conflicts", "foreshadowing"] as const;

const MOTION = {
  micro: 70,
  short: 180,
  hop: 90,
  long: 400,
} as const;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function readCssColor(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!value) return fallback;
  if (/^(oklch|hsl|rgb|#)/.test(value)) return value;
  return `hsl(${value})`;
}

function hitTest(nodes: readonly NeuralCloudLayoutNode[], x: number, y: number): NeuralCloudLayoutNode | undefined {
  let best: NeuralCloudLayoutNode | undefined;
  let bestDistance = Infinity;
  for (const node of nodes) {
    const distance = Math.hypot(node.x - x, node.y - y);
    const threshold = Math.max(10, node.radius + 6);
    if (distance <= threshold && distance < bestDistance) {
      best = node;
      bestDistance = distance;
    }
  }
  return best;
}

export function StoryNeuralCloudCanvas({
  bookId,
  currentChapter,
  initialFocusEntity,
  onOpenEntityDetail,
  onOpenChapter,
}: StoryNeuralCloudCanvasProps) {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [seedId, setSeedId] = useState<string | null>(null);
  const [pulse, setPulse] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const hoverRef = useRef<string | null>(null);
  const generationRef = useRef(0);

  const load = useCallback(async () => {
    const generation = ++generationRef.current;
    setLoadState({ status: "loading" });
    try {
      const base = `/api/books/${encodeURIComponent(bookId)}`;
      const entryResults = await Promise.all(SETTING_QUERY_CATEGORIES.map(async (category) => {
        try {
          const payload = await fetchJson<{ entries?: JingweiCloudEntry[] } | JingweiCloudEntry[]>(
            `${base}/jingwei/entries?category=${encodeURIComponent(category)}&limit=200`,
          );
          return { ok: true as const, entries: Array.isArray(payload) ? payload : payload.entries ?? [] };
        } catch (cause) {
          return { ok: false as const, cause };
        }
      }));
      if (entryResults.every((result) => !result.ok)) {
        const first = entryResults[0];
        throw first && !first.ok ? first.cause : new Error("世界网读取失败。");
      }
      const entryLists = entryResults.map((result) => result.ok ? result.entries : []);
      let facts: NarrativeFact[] = [];
      let events: NarrativeEvent[] = [];
      try {
        const memory = await fetchJson<{ facts?: NarrativeFact[]; events?: NarrativeEvent[] }>(
          `${base}/narrative-memory/graph?view=event_chain&limit=0`,
        );
        facts = memory.facts ?? [];
        events = memory.events ?? [];
      } catch {
        facts = [];
        events = [];
      }
      if (generation !== generationRef.current) return;
      setLoadState({
        status: "ready",
        entries: entryLists.flat(),
        facts,
        events,
      });
    } catch (cause) {
      if (generation !== generationRef.current) return;
      const message = cause instanceof ApiRequestError
        ? `世界网读取失败（HTTP ${cause.status ?? "?"}）。`
        : cause instanceof Error ? cause.message : "世界网读取失败。";
      setLoadState({ status: "error", message });
    }
  }, [bookId]);

  useEffect(() => {
    void load();
    return () => {
      generationRef.current += 1;
    };
  }, [load]);

  const model = useMemo(() => {
    if (loadState.status !== "ready") return null;
    return buildNeuralCloudModel({
      entries: loadState.entries,
      facts: loadState.facts,
      events: loadState.events,
      currentChapter,
    });
  }, [currentChapter, loadState]);

  useEffect(() => {
    if (!model || !initialFocusEntity?.trim()) return;
    const match = model.nodes.find((node) => node.label === initialFocusEntity.trim());
    if (match) setSeedId(match.id);
  }, [initialFocusEntity, model]);

  const activation = useMemo<NeuralCloudActivation | null>(() => {
    if (!model || !seedId) return null;
    return activateNeuralCloud(model, seedId);
  }, [model, seedId]);

  const selected = model?.nodes.find((node) => node.id === seedId);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !model) return;
    let frame = 0;
    let cancelled = false;
    const reduced = prefersReducedMotion();

    const draw = (now: number) => {
      if (cancelled) return;
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(1, wrap.clientWidth);
      const height = Math.max(1, wrap.clientHeight);
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const minX = Math.min(...model.nodes.map((node) => node.x));
      const maxX = Math.max(...model.nodes.map((node) => node.x));
      const minY = Math.min(...model.nodes.map((node) => node.y));
      const maxY = Math.max(...model.nodes.map((node) => node.y));
      const worldW = Math.max(1, maxX - minX);
      const worldH = Math.max(1, maxY - minY);
      const scale = Math.min((width - 72) / worldW, (height - 72) / worldH, 1.6);
      const ox = (width - worldW * scale) / 2 - minX * scale;
      const oy = (height - worldH * scale) / 2 - minY * scale;
      const sx = (x: number) => ox + x * scale;
      const sy = (y: number) => oy + y * scale;

      const lit = activation?.energyById;
      const litEdges = new Set(activation?.litEdgeIds ?? []);
      const elapsed = reduced ? MOTION.long : Math.min(MOTION.long, pulse === 0 ? MOTION.long : now - pulse);
      const primary = readCssColor("--primary", "#b45309");
      const muted = readCssColor("--muted-foreground", "#78716c");
      const foreground = readCssColor("--foreground", "#1f1a14");

      ctx.lineCap = "round";
      for (const edge of model.edges) {
        const from = model.nodes.find((node) => node.id === edge.source);
        const to = model.nodes.find((node) => node.id === edge.target);
        if (!from || !to) continue;
        const active = litEdges.has(edge.id);
        ctx.beginPath();
        ctx.moveTo(sx(from.x), sy(from.y));
        ctx.lineTo(sx(to.x), sy(to.y));
        if (active) {
          const hop = Math.max(
            lit?.get(edge.source)?.hop ?? 0,
            lit?.get(edge.target)?.hop ?? 0,
          );
          const appearAt = hop * MOTION.hop;
          const t = Math.max(0, Math.min(1, (elapsed - appearAt) / MOTION.short));
          ctx.strokeStyle = primary;
          ctx.globalAlpha = 0.18 + t * 0.7;
          ctx.lineWidth = 1.2 + t * 1.6;
        } else {
          ctx.strokeStyle = edge.kind === "sequence" ? primary : muted;
          ctx.globalAlpha = edge.kind === "sequence" ? 0.22 : 0.08;
          ctx.lineWidth = edge.kind === "sequence" ? 1.4 : 0.8;
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      const breath = reduced ? 0 : Math.sin(now / 1400) * 0.4;
      for (const node of model.nodes) {
        const energy = lit?.get(node.id);
        const hover = hoverRef.current === node.id;
        const appearAt = (energy?.hop ?? 0) * MOTION.hop;
        const t = energy ? Math.max(0, Math.min(1, (elapsed - appearAt) / MOTION.short)) : 0;
        const radius = (node.radius + (hover ? 1.6 : 0) + (energy ? t * 2.2 : breath * 0.25)) * Math.max(scale, 0.85);
        ctx.beginPath();
        ctx.arc(sx(node.x), sy(node.y), radius, 0, Math.PI * 2);
        ctx.fillStyle = NEURAL_CLOUD_KIND_COLOR[node.kind];
        ctx.globalAlpha = energy ? 0.45 + t * 0.55 : lit ? 0.18 : 0.72;
        ctx.fill();
        if (energy) {
          ctx.shadowColor = NEURAL_CLOUD_KIND_COLOR[node.kind];
          ctx.shadowBlur = 10 + t * 14;
          ctx.fill();
          ctx.shadowBlur = 0;
        }
        ctx.globalAlpha = 1;
        const showLabel = Boolean(energy) || hover || node.kind === "chapter";
        if (showLabel) {
          ctx.font = node.kind === "chapter" ? "600 11px sans-serif" : "500 10px sans-serif";
          ctx.fillStyle = foreground;
          ctx.textAlign = "center";
          ctx.fillText(node.label, sx(node.x), sy(node.y) - radius - 6);
        }
      }

      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [activation, model, pulse]);

  const toWorld = (event: MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !model) return null;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const minX = Math.min(...model.nodes.map((node) => node.x));
    const maxX = Math.max(...model.nodes.map((node) => node.x));
    const minY = Math.min(...model.nodes.map((node) => node.y));
    const maxY = Math.max(...model.nodes.map((node) => node.y));
    const worldW = Math.max(1, maxX - minX);
    const worldH = Math.max(1, maxY - minY);
    const scale = Math.min((width - 72) / worldW, (height - 72) / worldH, 1.6);
    const ox = (width - worldW * scale) / 2 - minX * scale;
    const oy = (height - worldH * scale) / 2 - minY * scale;
    return {
      x: (event.clientX - rect.left - ox) / scale,
      y: (event.clientY - rect.top - oy) / scale,
    };
  };

  const onCanvasClick = (event: MouseEvent<HTMLCanvasElement>) => {
    if (!model) return;
    const world = toWorld(event);
    if (!world) return;
    const hit = hitTest(model.nodes, world.x, world.y);
    if (!hit) {
      setSeedId(null);
      return;
    }
    setSeedId(hit.id);
    setPulse(prefersReducedMotion() ? 0 : performance.now());
  };

  const onCanvasMove = (event: MouseEvent<HTMLCanvasElement>) => {
    if (!model) return;
    const world = toWorld(event);
    hoverRef.current = world ? hitTest(model.nodes, world.x, world.y)?.id ?? null : null;
  };

  if (loadState.status === "loading") {
    return (
      <div className="flex h-full min-h-[80vh] items-center justify-center gap-2 text-sm text-muted-foreground" data-testid="story-neural-cloud-loading">
        <Loader2 className="size-4 animate-spin" /> 正在铺开世界网…
      </div>
    );
  }

  if (loadState.status === "error") {
    return (
      <div className="flex h-full min-h-[80vh] flex-col items-center justify-center gap-3 text-center" data-testid="story-neural-cloud-error">
        <AlertTriangle className="size-6 text-destructive/70" />
        <p className="text-sm font-medium">世界网暂时无法加载</p>
        <p className="max-w-sm text-xs text-muted-foreground">{loadState.message}</p>
        <Button size="sm" className="gap-1.5" onClick={() => void load()}><RefreshCw className="size-3.5" />重试</Button>
      </div>
    );
  }

  if (!model || model.nodes.every((node) => node.kind === "chapter")) {
    return (
      <div className="flex h-full min-h-[80vh] flex-col items-center justify-center gap-2 text-center" data-testid="story-neural-cloud-empty">
        <Network className="size-7 text-muted-foreground/50" />
        <p className="text-sm font-medium">还没有可展开的世界网</p>
        <p className="max-w-sm text-xs text-muted-foreground">先在经纬里写下角色、势力或关系。点云只画设定实体，结算流水只出现在点开后的现状里。</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-[80vh] overflow-hidden" data-testid="story-neural-cloud">
      <div ref={wrapRef} className="relative min-w-0 flex-1 bg-background">
        <canvas
          ref={canvasRef}
          className="h-full w-full cursor-pointer"
          data-testid="story-neural-cloud-canvas"
          onClick={onCanvasClick}
          onMouseMove={onCanvasMove}
          onMouseLeave={() => {
            hoverRef.current = null;
          }}
        />
        <div className="pointer-events-none absolute left-3 top-3 rounded-md border border-border/70 bg-card/90 px-2.5 py-1.5 text-[10px] text-muted-foreground shadow-sm">
          点是点。点一下沿关系走，空白处熄灭。
          {model.truncated ? " · 已按上限截取" : ""}
        </div>
      </div>
      <aside className="w-72 shrink-0 border-l border-border bg-card/60" data-testid="story-neural-cloud-inspector">
        {selected ? (
          <div className="flex h-full flex-col">
            <div className="flex items-start justify-between gap-2 border-b border-border px-3 py-2.5">
              <div className="min-w-0">
                <Badge variant="secondary" className="text-[10px]">{selected.kind}</Badge>
                <h3 className="mt-1 text-sm font-semibold leading-5">{selected.label}</h3>
                {selected.subtitle ? <p className="mt-0.5 text-[11px] text-muted-foreground">{selected.subtitle}</p> : null}
              </div>
              <Button variant="ghost" size="icon" className="size-7" onClick={() => setSeedId(null)} aria-label="熄灭传播">
                <X className="size-3.5" />
              </Button>
            </div>
            <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3 text-xs">
              {selected.chapterNumber !== undefined ? <p>出场第 {selected.chapterNumber} 章</p> : null}
              {selected.currentState ? (
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">当前状态</div>
                  <p className="whitespace-pre-wrap leading-5">{selected.currentState}</p>
                </div>
              ) : null}
              {selected.secret ? (
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">秘密</div>
                  <p className="whitespace-pre-wrap leading-5">{selected.secret}</p>
                </div>
              ) : null}
              {selected.evidenceText ? (
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">设定 / 证据</div>
                  <p className="whitespace-pre-wrap leading-5">{selected.evidenceText}</p>
                </div>
              ) : null}
              {activation ? (
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">传播</div>
                  <p className="text-muted-foreground">点亮 {activation.energyById.size} 个点 · {activation.litEdgeIds.length} 条边</p>
                </div>
              ) : null}
              {selected.kind === "chapter" && selected.chapterNumber !== undefined && onOpenChapter ? (
                <Button size="sm" variant="outline" onClick={() => onOpenChapter(selected.chapterNumber!)}>打开第 {selected.chapterNumber} 章</Button>
              ) : null}
              {selected.kind !== "chapter" && onOpenEntityDetail ? (
                <Button
                  size="sm"
                  onClick={() => {
                    if (selected.entryId) onOpenEntityDetail(selected.label, selected.entryId);
                    else onOpenEntityDetail(selected.label);
                  }}
                >
                  {selected.entryId ? "打开关联条目卡" : "查看实体详情"}
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-4 text-center text-muted-foreground">
            <Network className="mb-2 size-6 opacity-40" />
            <p className="text-sm font-medium text-foreground">点一个点</p>
            <p className="mt-1 text-[11px] leading-5">能量会沿关系走一两跳。右侧只在点亮后给出数据。</p>
          </div>
        )}
      </aside>
    </div>
  );
}
