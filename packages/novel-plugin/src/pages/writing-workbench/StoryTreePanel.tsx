/**
 * 故事树面板：给 StoryTreeView 供数据的容器。
 *
 * StoryTreeView 是纯展示组件（三处共用：工作台 / lore.read 卡 / memory.graph 卡），
 * 数据获取放在这里，工具卡那侧则直接把工具返回喂进去。
 *
 * 关系边来自两个源，都读：
 *   · 经纬 relationships 条目的 fields.source/target
 *   · narrative_fact 里 category=relationship 的三元组（带谓词与章号，语义更全）
 * 注意这仍是按**名字**匹配。migration 0032 建了 narrative_relation（外键边），
 * 回填完成后应切到 entity_id，避免「薛行之与方工」这类复合主体被当成一个实体。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ApiRequestError, fetchJson } from "@/hooks/use-api";

import { StoryTreeView } from "./StoryTreeView";
import type { TreeEntryInput, TreeRelationInput } from "../../engine/narrative-taxonomy/story-tree";

export interface StoryTreePanelProps {
  readonly bookId: string;
  readonly onOpenEntry?: (entryId: string, label: string) => void;
  readonly onSendToNarrator?: (message: string) => Promise<void> | void;
}

interface EntriesPayload {
  readonly entries?: RawEntry[];
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
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; entries: TreeEntryInput[]; relations: TreeRelationInput[]; degraded: boolean };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function StoryTreePanel({ bookId, onOpenEntry, onSendToNarrator }: StoryTreePanelProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [nonce, setNonce] = useState(0);
  const generationRef = useRef(0);

  useEffect(() => {
    if (!bookId.trim()) {
      setState({ status: "ready", entries: [], relations: [], degraded: false });
      return;
    }
    const generation = ++generationRef.current;
    setState({ status: "loading" });
    const base = `/api/books/${encodeURIComponent(bookId)}`;

    void (async () => {
      let entries: TreeEntryInput[] = [];
      let entriesFailed = false;
      try {
        // 不带 category 即取全书条目，一次拉完由前端分层（209 条量级完全够用）
        const payload = await fetchJson<EntriesPayload | RawEntry[]>(`${base}/jingwei/entries`);
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
        entriesFailed = true;
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

      // 关系边失败不阻断：树的层级不依赖关系，缺了只是少了度数排序
      const relations: TreeRelationInput[] = [];
      for (const entry of entries) {
        if (entry.category !== "relationships") continue;
        const source = text(entry.fields?.source) || text(entry.fields?.sourceName);
        const target = text(entry.fields?.target) || text(entry.fields?.targetName);
        if (!source || !target) continue;
        relations.push({ sourceName: source, targetName: target, predicate: text(entry.fields?.relationType) });
      }
      let graphFailed = false;
      try {
        const graph = await fetchJson<GraphPayload>(`${base}/narrative-memory/graph?view=relationship&limit=0`);
        for (const fact of graph.facts ?? []) {
          if (fact.category !== "relationship") continue;
          const source = text(fact.subject);
          const target = text(fact.object);
          if (!source || !target) continue;
          relations.push({
            sourceName: source,
            targetName: target,
            predicate: text(fact.predicate),
            ...(typeof fact.sourceChapter === "number" ? { validFrom: fact.sourceChapter } : {}),
          });
        }
      } catch {
        graphFailed = true;
      }

      if (generation !== generationRef.current) return;
      setState({ status: "ready", entries, relations, degraded: graphFailed && !entriesFailed });
    })();

    return () => {
      generationRef.current += 1;
    };
  }, [bookId, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  const openEntry = useCallback(
    (entryId: string, label: string) => onOpenEntry?.(entryId, label),
    [onOpenEntry],
  );

  const content = useMemo(() => {
    if (state.status !== "ready") return null;
    return (
      <StoryTreeView
        entries={state.entries}
        relations={state.relations}
        mode="full"
        className="h-full"
        {...(onOpenEntry ? { onOpenEntry: openEntry } : {})}
        {...(onSendToNarrator ? { onSendToNarrator } : {})}
      />
    );
  }, [state, onOpenEntry, openEntry, onSendToNarrator]);

  if (state.status === "loading") {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground" data-testid="story-tree-panel-loading">
        <Loader2 className="size-4 animate-spin" /> 正在读取经纬条目…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center" data-testid="story-tree-panel-error">
        <AlertCircle className="size-6 text-destructive" />
        <p className="max-w-sm text-[11px] text-muted-foreground">{state.message}</p>
        <Button size="xs" variant="outline" className="h-7 gap-1 text-xs" onClick={reload}>
          <RefreshCw className="size-3" /> 重试
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5" data-testid="story-tree-panel">
      {state.degraded ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/[0.06] px-2 py-1 text-[10px] text-amber-700 dark:text-amber-300" data-testid="story-tree-panel-degraded">
          动态关系没读到，树的层级正常，但条目上不显示关系度数。
        </p>
      ) : null}
      <div className="min-h-0 flex-1">{content}</div>
    </div>
  );
}

export default StoryTreePanel;
