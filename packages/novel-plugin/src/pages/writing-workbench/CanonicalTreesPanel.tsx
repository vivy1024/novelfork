/**
 * 正图面板：世界观 / 关系树 / 章节 / 发展历程 / 章节脉络 / 总图。
 *
 * 数据只读经纬条目 + memory.graph 共现与事件。不写 Lore，不碰真实库回填。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, FolderTree, Loader2, RefreshCw, Search, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiRequestError, fetchJson } from "@/hooks/use-api";

import {
  buildCanonicalTrees,
  CANONICAL_TREE_VIEWS,
  collectDefaultExpanded,
  indexCanonicalTree,
  type CanonicalForest,
  type CanonicalTreeKind,
  type CanonicalTreeNode,
  type CanonicalTrees,
  type CooccurrenceEdgeInput,
  type TimelineEventInput,
  type VolumeTreeInput,
} from "../../engine/narrative-taxonomy/canonical-trees";
import { buildCarrierTree } from "../../engine/narrative-taxonomy/scene-trees";
import type { TreeEntryInput } from "../../engine/narrative-taxonomy/story-tree";
import type { NarrativeStructurePayload } from "../../engine/narrative-taxonomy/narrative-structure";
import { CausalCanvas } from "./causal-canvas/CausalCanvas";
import { TidyTreeCanvas } from "./TidyTreeCanvas";

export interface CanonicalTreesPanelProps {
  readonly bookId: string;
  readonly onOpenEntry?: (entryId: string, label: string) => void;
  readonly onOpenChapter?: (chapterNumber: number) => void;
  readonly onSendToNarrator?: (message: string) => Promise<void> | void;
  readonly initialKind?: CanonicalTreeKind;
  /** 只展示指定的子视图集合（如理镜头传 worldview+relations，推镜头传 chapters+causal+chronicle+timeline）。 */
  readonly kinds?: readonly CanonicalTreeKind[];
  /** false 时只画这一张树，给发展历程 / 章节脉络 / 关系网当独立入口。 */
  readonly showSwitcher?: boolean;
}

interface RawEntry {
  readonly id: string;
  readonly title?: string;
  readonly category?: string;
  readonly summaryMd?: string | null;
  readonly contentMd?: string;
  readonly fields?: Record<string, unknown>;
  readonly lifecycle?: string;
  readonly status?: string;
}

interface GraphPayload {
  readonly facts?: ReadonlyArray<{
    readonly subject?: string;
    readonly object?: string;
    readonly predicate?: string;
    readonly category?: string;
    readonly sourceChapter?: number;
  }>;
  readonly events?: readonly TimelineEventInput[];
  readonly cooccurrence?: {
    readonly edges?: readonly CooccurrenceEdgeInput[];
  };
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      trees: CanonicalTrees;
      degraded: boolean;
      /** 叙事结构快照：因果树页签用它画因果画布（剧情线 × 场景是图，不是树）。 */
      structure?: NarrativeStructurePayload;
    };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readVolumes(entries: readonly TreeEntryInput[]): VolumeTreeInput[] {
  for (const entry of entries) {
    if (entry.category !== "outline") continue;
    const volumes = entry.fields?.volumes;
    if (Array.isArray(volumes) && volumes.length > 0) return volumes as VolumeTreeInput[];
  }
  return [];
}

function matchingIds(node: CanonicalTreeNode, query: string): Set<string> {
  const result = new Set<string>();
  const needle = query.trim().toLowerCase();
  if (!needle) return result;
  const walk = (current: CanonicalTreeNode, chain: readonly string[]) => {
    const hit = current.label.toLowerCase().includes(needle)
      || (current.detail?.toLowerCase().includes(needle) ?? false);
    if (hit) {
      for (const id of chain) result.add(id);
      result.add(current.id);
    }
    for (const child of current.children) walk(child, [...chain, current.id]);
  };
  walk(node, []);
  return result;
}

function NodeInspector({ node }: { node: CanonicalTreeNode | null }) {
  if (!node) {
    return (
      <p className="p-3 text-2xs text-muted-foreground" data-testid="canonical-tree-inspector-empty">
        点树上任一节点查看详情。
      </p>
    );
  }
  return (
    <div className="space-y-2 p-3" data-testid="canonical-tree-inspector">
      <div>
        <p className="text-xs font-semibold">{node.label}</p>
        {node.subtitle ? <p className="mt-0.5 text-2xs text-muted-foreground">{node.subtitle}</p> : null}
      </div>
      <div className="flex flex-wrap gap-1">
        <Badge variant="outline" className="h-4 px-1 text-2xs">{node.kind}</Badge>
        {node.count > 0 ? <Badge variant="outline" className="h-4 px-1 text-2xs">{node.count}</Badge> : null}
        {node.status ? <Badge variant="secondary" className="h-4 px-1 text-2xs">{node.status}</Badge> : null}
        {node.degree ? <Badge variant="outline" className="h-4 px-1 text-2xs">{node.degree} 共现</Badge> : null}
      </div>
      {node.detail ? (
        <p className="max-h-52 overflow-y-auto whitespace-pre-wrap text-2xs leading-relaxed text-muted-foreground">
          {node.detail}
        </p>
      ) : (
        <p className="text-2xs text-muted-foreground">这个节点没有正文内容。</p>
      )}
    </div>
  );
}

export function CanonicalTreesPanel({
  bookId,
  onOpenEntry,
  onOpenChapter,
  onSendToNarrator,
  initialKind = "worldview",
  kinds,
  showSwitcher = true,
}: CanonicalTreesPanelProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  const availableViews = useMemo(() => {
    if (!kinds || kinds.length === 0) return CANONICAL_TREE_VIEWS;
    const allowed = new Set(kinds);
    return CANONICAL_TREE_VIEWS.filter((view) => allowed.has(view.id));
  }, [kinds]);

  const defaultKind = useMemo(() => {
    if (initialKind && availableViews.some((v) => v.id === initialKind)) return initialKind;
    return availableViews[0]?.id ?? "worldview";
  }, [initialKind, availableViews]);

  const [kind, setKind] = useState<CanonicalTreeKind>(defaultKind);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedByKind, setExpandedByKind] = useState<Partial<Record<CanonicalTreeKind, Set<string>>>>({});
  const [nonce, setNonce] = useState(0);
  const generationRef = useRef(0);

  useEffect(() => {
    setKind(defaultKind);
  }, [defaultKind]);

  useEffect(() => {
    if (!bookId.trim()) {
      setState({
        status: "ready",
        trees: buildCanonicalTrees({}),
        degraded: false,
      });
      return;
    }
    const generation = ++generationRef.current;
    setState({ status: "loading" });
    const base = `/api/books/${encodeURIComponent(bookId)}`;

    void (async () => {
      // 任务 4 优先路径：尝试单次快照
      try {
        const struct = await fetchJson<NarrativeStructurePayload>(`${base}/narrative-structure`);
        if (generation !== generationRef.current) return;
        if (struct && struct.ok) {
          const volumes = struct.volumes.map((v) => ({
            id: v.id,
            title: v.title,
            chapterRange: v.chapterRange,
            status: v.status,
            goal: v.goal,
          }));
          const base = buildCanonicalTrees({ volumes });

          // buildCanonicalTrees 的「章节」树只到卷 → 章；场景要落进去得用
          // buildCarrierTree（卷 → 章 → 场景），它产出同一套 CanonicalForest
          // 结构，可直接替换那一棵，而不是往 buildCanonicalTrees 里再塞一份
          // 重复的建树逻辑。没有场景时保持原树，避免老书凭空多出一层空节点。
          const scenes = struct.scenes.map((s) => ({
            id: s.id,
            chapterNumber: s.chapterNumber,
            ordinal: s.ordinal,
            title: s.title,
            summary: s.summary,
            function: s.function,
            status: s.status,
          }));
          const trees = {
            ...base,
            ...(scenes.length > 0
              ? {
                  chapters: buildCarrierTree({
                    volumes,
                    chapters: struct.chapters.map((chapter) => ({
                      number: chapter.number,
                      title: chapter.title,
                    })),
                    scenes,
                  }),
                }
              : {}),
          };
          setState({ status: "ready", trees, degraded: false, structure: struct });
          return;
        }
      } catch {
        // 回退兼容多路请求
      }

      let entries: TreeEntryInput[] = [];
      try {
        const payload = await fetchJson<{ entries?: RawEntry[] } | RawEntry[]>(`${base}/jingwei/entries`);
        const rows = Array.isArray(payload) ? payload : payload.entries ?? [];
        entries = rows.map((row) => ({
          id: row.id,
          ...(row.title ? { title: row.title } : {}),
          ...(row.category ? { category: row.category } : {}),
          ...(row.summaryMd !== undefined ? { summaryMd: row.summaryMd } : {}),
          ...(row.contentMd ? { contentMd: row.contentMd } : {}),
          ...(row.fields ? { fields: row.fields } : {}),
          ...(row.lifecycle ? { lifecycle: row.lifecycle } : {}),
          ...(row.status ? { status: row.status } : {}),
        }));
      } catch (cause) {
        if (generation === generationRef.current) {
          setState({
            status: "error",
            message: cause instanceof ApiRequestError
              ? `经纬条目读取失败（HTTP ${cause.status ?? "?"}）。`
              : "经纬条目读取失败，请刷新后重试。",
          });
        }
        return;
      }

      let cooccurrence: CooccurrenceEdgeInput[] = [];
      let events: TimelineEventInput[] = [];
      let graphFailed = false;
      try {
        const [relationshipGraph, eventGraph] = await Promise.all([
          fetchJson<GraphPayload>(`${base}/narrative-memory/graph?view=relationship&limit=0`),
          fetchJson<GraphPayload>(`${base}/narrative-memory/graph?view=event_chain&limit=0`),
        ]);
        cooccurrence = [...(relationshipGraph.cooccurrence?.edges ?? [])];
        if (cooccurrence.length === 0) {
          for (const fact of relationshipGraph.facts ?? []) {
            if (fact.category !== "relationship") continue;
            const source = text(fact.subject);
            const target = text(fact.object);
            if (!source || !target) continue;
            cooccurrence.push({ source, target, weight: 1, coCount: 1 });
          }
        }
        events = [...(eventGraph.events ?? [])];
      } catch {
        graphFailed = true;
      }
      if (cooccurrence.length === 0) {
        for (const entry of entries) {
          if (entry.category !== "relationships") continue;
          const source = text(entry.fields?.source) || text(entry.fields?.sourceName);
          const target = text(entry.fields?.target) || text(entry.fields?.targetName);
          if (!source || !target) continue;
          cooccurrence.push({ source, target, weight: 1, coCount: 1 });
        }
      }

      if (generation !== generationRef.current) return;
      const fallbackTrees = buildCanonicalTrees({
        entries,
        cooccurrence,
        events,
        volumes: readVolumes(entries),
      });
      setState({
        status: "ready",
        trees: {
          ...fallbackTrees,
          // 没有快照就没有场景与剧情线，别把「读取失败」说成「还没有剧情线」。
          causal: { ...fallbackTrees.causal, emptyReason: "叙事结构快照没读到，因果画布暂时画不出来；点刷新重试。" },
        },
        degraded: graphFailed,
      });
    })();

    return () => {
      generationRef.current += 1;
    };
  }, [bookId, nonce]);

  const forest: CanonicalForest | null = state.status === "ready" ? state.trees[kind] : null;

  const expanded = useMemo(() => {
    if (!forest) return new Set<string>();
    return expandedByKind[kind] ?? collectDefaultExpanded(forest.root);
  }, [expandedByKind, forest, kind]);

  const matched = useMemo(
    () => (forest ? matchingIds(forest.root, query) : new Set<string>()),
    [forest, query],
  );

  const effectiveExpanded = useMemo(() => {
    if (matched.size === 0) return expanded;
    return new Set([...expanded, ...matched]);
  }, [expanded, matched]);

  const selected = useMemo(() => {
    if (!forest || !selectedId) return null;
    return indexCanonicalTree(forest.root).get(selectedId) ?? null;
  }, [forest, selectedId]);

  const toggle = useCallback((id: string) => {
    setExpandedByKind((current) => {
      const baseline = forest
        ? (current[kind] ?? collectDefaultExpanded(forest.root))
        : new Set<string>();
      const next = new Set(baseline);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...current, [kind]: next };
    });
  }, [forest, kind]);

  const select = useCallback((node: CanonicalTreeNode) => {
    setSelectedId(node.id);
  }, []);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  if (state.status === "loading") {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground" data-testid="canonical-trees-loading">
        <Loader2 className="size-4 animate-spin" /> 正在铺开正图…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center" data-testid="canonical-trees-error">
        <AlertCircle className="size-6 text-destructive" />
        <p className="max-w-sm text-2xs text-muted-foreground">{state.message}</p>
        <Button size="xs" variant="outline" className="h-7 gap-1 text-xs" onClick={reload}>
          <RefreshCw className="size-3" /> 重试
        </Button>
      </div>
    );
  }

  if (!forest) return null;

  const causalStructure = kind === "causal" && state.structure ? state.structure : null;
  const emptyPrompt = !causalStructure && forest.emptyReason
    ? `正图「${forest.root.label}」还是空的。${forest.emptyReason}请基于已有正文补齐对应经纬条目，并保持 needs-review 待我确认。`
    : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5" data-testid="canonical-trees-panel">
      {state.degraded ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/[0.06] px-2 py-1 text-2xs text-amber-700 dark:text-amber-300" data-testid="canonical-trees-degraded">
          动态记忆没读到，世界观和章节仍可用；关系树、发展历程、章节脉络会缺事件和共现。
        </p>
      ) : null}

      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        <FolderTree className="size-3.5 text-primary" />
        <span className="text-xs font-semibold">{showSwitcher && availableViews.length > 1 ? "正图" : (availableViews.find((view) => view.id === kind)?.label ?? "正图")}</span>
        {showSwitcher && availableViews.length > 1 ? (
        <nav className="flex items-center gap-0.5 rounded-md bg-muted/60 p-0.5" role="tablist" aria-label="正图切换">
          {availableViews.map((view) => {
            const active = kind === view.id;
            return (
              <button
                key={view.id}
                type="button"
                role="tab"
                aria-selected={active}
                title={view.description}
                data-testid={`canonical-tree-tab-${view.id}`}
                onClick={() => {
                  setKind(view.id);
                  setSelectedId(null);
                  setQuery("");
                }}
                className={
                  "rounded px-2 py-1 text-2xs transition-colors "
                  + (active ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")
                }
              >
                {view.label}
              </button>
            );
          })}
        </nav>
        ) : null}
        {causalStructure ? null : <span className="text-2xs text-muted-foreground">{forest.root.count} 项</span>}
        <div className="ml-auto flex items-center gap-1">
          <div className="relative">
            <Search className="pointer-events-none absolute left-1.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索节点"
              aria-label="搜索正图"
              className="h-6 w-32 pl-6 text-2xs"
            />
          </div>
          {query ? (
            <Button size="xs" variant="ghost" className="h-6 px-1 text-2xs" onClick={() => setQuery("")}>
              <X className="size-3" />
            </Button>
          ) : null}
        </div>
      </div>

      {query && !causalStructure && matched.size === 0 ? (
        <p className="px-1 text-2xs text-muted-foreground">没有匹配「{query}」的节点。</p>
      ) : null}

      {causalStructure ? (
        <CausalCanvas
          bookId={bookId}
          structure={causalStructure}
          query={query}
          {...(onOpenChapter ? { onOpenChapter } : {})}
          className="flex min-h-0 flex-1 gap-2"
        />
      ) : (
      <div className="flex min-h-0 flex-1 gap-2">
        <div className="min-w-0 flex-1 overflow-hidden rounded-md border">
          <TidyTreeCanvas
            forest={forest}
            expanded={effectiveExpanded}
            selectedId={selectedId}
            matchedIds={query ? matched : undefined}
            onToggle={toggle}
            onSelect={select}
            {...(onOpenEntry ? { onOpenEntry } : {})}
            {...(onOpenChapter ? { onOpenChapter } : {})}
          />
        </div>
        <div className="w-64 shrink-0 overflow-y-auto rounded-md border">
          <NodeInspector node={selected} />
        </div>
      </div>
      )}

      {emptyPrompt && onSendToNarrator ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed px-2 py-1.5">
          <span className="text-2xs text-muted-foreground">{forest.emptyReason}</span>
          <Button
            size="xs"
            variant="ghost"
            className="ml-auto h-6 px-1.5 text-2xs"
            data-testid="canonical-tree-fill-gap"
            onClick={() => void onSendToNarrator(emptyPrompt)}
          >
            让叙述者补
          </Button>
        </div>
      ) : forest.emptyReason && !causalStructure ? (
        <p className="px-1 text-2xs text-muted-foreground">{forest.emptyReason}</p>
      ) : null}
    </div>
  );
}

export default CanonicalTreesPanel;
