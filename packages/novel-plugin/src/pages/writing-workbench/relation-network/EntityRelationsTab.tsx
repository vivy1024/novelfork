/**
 * 实体抽屉的「关系」页：按经纬条目 id → 实体 id 读关系（实体索引），不按名字匹配。
 * 显示所问章节（或至今）仍成立的关系，以及与每个人的关系史、证据和走向。
 */

import { useCallback, useEffect, useState } from "react";
import { BookOpen, HeartHandshake, Loader2, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fetchJson } from "@/hooks/use-api";

import type { GraphExplanation, RelationPolarityLabel } from "../../../engine/narrative-entity/relation-graph";

export interface EntityRelationsTabProps {
  readonly bookId: string;
  /** 经纬条目 id；null 表示没找到对应条目（说明原因由 unresolved 给出）。 */
  readonly entryId: string | null;
  /** 条目还在解析（经纬检索未返回）。 */
  readonly resolving?: boolean;
  readonly entityName: string;
  readonly currentChapter?: number;
  readonly onOpenChapter?: (chapterNumber: number) => void;
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
  readonly polarity: { readonly label: RelationPolarityLabel };
}

interface Counterpart {
  readonly entity: { readonly id: string; readonly name: string; readonly entryId: string | null };
  readonly current: readonly HistoryItem[];
  readonly history: readonly HistoryItem[];
  readonly trend: { readonly kind: string; readonly label: string; readonly explanation: string };
  readonly sharedEvents: number;
}

interface RelationsResponse {
  readonly status: "ok" | "empty";
  readonly reason?: string;
  readonly explanation?: GraphExplanation;
  readonly entity?: { readonly id: string; readonly name: string };
  readonly counterparts?: readonly Counterpart[];
}

type State =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly data: RelationsResponse };

function Explanation({ explanation }: { explanation: GraphExplanation }) {
  return (
    <div className="space-y-1 rounded-lg border border-dashed border-border/80 bg-muted/10 p-3 text-2xs leading-relaxed" data-testid="entity-relations-explanation">
      <p className="text-xs font-medium text-foreground">{explanation.whatHappened}</p>
      <p className="text-muted-foreground">{explanation.whyItMatters}</p>
      <p className="text-muted-foreground">建议：{explanation.suggestedAction}</p>
    </div>
  );
}

function range(from: number | null, to: number | null): string {
  const start = from === null ? "开篇" : `第 ${from} 章`;
  return to === null ? `${start}起` : `${start}—第 ${to} 章止`;
}

export function EntityRelationsTab({ bookId, entryId, resolving, entityName, currentChapter, onOpenChapter }: EntityRelationsTabProps) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [rebuilding, setRebuilding] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (!entryId) return;
    let cancelled = false;
    setState({ status: "loading" });
    const params = new URLSearchParams({ entryId });
    if (currentChapter !== undefined) params.set("chapter", String(currentChapter));
    fetchJson<RelationsResponse>(`/api/books/${encodeURIComponent(bookId)}/narrative-memory/entity-graph/relations?${params.toString()}`)
      .then((data) => { if (!cancelled) setState({ status: "ready", data }); })
      .catch((cause) => { if (!cancelled) setState({ status: "error", message: cause instanceof Error ? cause.message : "读取关系失败" }); });
    return () => { cancelled = true; };
  }, [bookId, entryId, currentChapter, nonce]);

  const rebuild = useCallback(async () => {
    setRebuilding(true);
    try {
      await fetchJson(`/api/books/${encodeURIComponent(bookId)}/narrative-memory/entity-index/rebuild`, { method: "POST" });
    } catch {
      // 重建失败时重读的结果仍会给出说明
    } finally {
      setRebuilding(false);
      setNonce((value) => value + 1);
    }
  }, [bookId]);

  if (resolving) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground" data-testid="entity-relations-loading">
        <Loader2 className="size-4 animate-spin" />
        <span className="text-xs">正在找对应的经纬条目…</span>
      </div>
    );
  }

  if (!entryId) {
    return (
      <Explanation
        explanation={{
          whatHappened: `经纬里没有标题或别名正好是「${entityName}」的条目。`,
          whyItMatters: "关系按实体 ID 读取，实体身份来自经纬条目；没有条目就无法确认这些关系属于谁，按名字猜会把同名、别名混在一起。",
          suggestedAction: "在经纬里为 TA 建角色（或地点 / 势力 / 道具）条目，或给已有条目加上这个别名，然后在「设定图谱 › 人物关系」点「重建索引」。",
        }}
      />
    );
  }

  if (state.status === "loading") {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground" data-testid="entity-relations-loading">
        <Loader2 className="size-4 animate-spin" />
        <span className="text-xs">正在读关系…</span>
      </div>
    );
  }
  if (state.status === "error") return <p className="text-xs text-destructive">{state.message}</p>;

  const data = state.data;
  if (data.status === "empty" && data.explanation) {
    return (
      <div className="space-y-2">
        <Explanation explanation={data.explanation} />
        {data.reason !== "schema-missing" ? (
          <Button size="xs" variant="outline" className="h-6 gap-1 text-2xs" disabled={rebuilding} onClick={() => void rebuild()} data-testid="entity-relations-rebuild">
            {rebuilding ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
            重建索引
          </Button>
        ) : null}
      </div>
    );
  }

  const counterparts = data.counterparts ?? [];
  const nameOf = (id: string) => (id === data.entity?.id ? data.entity.name : counterparts.find((item) => item.entity.id === id)?.entity.name ?? id);
  const currentCount = counterparts.filter((item) => item.current.length > 0).length;

  if (counterparts.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/80 bg-muted/10 p-4 text-center text-xs text-muted-foreground" data-testid="entity-relations-none">
        <p className="font-medium">{currentChapter !== undefined ? `截至第 ${currentChapter} 章` : "目前"}还没有 TA 的关系记录。</p>
        <p className="mt-1 text-2xs">关系来自章后结算里的关系类事实，双方都要有经纬条目；只是同场出现不算关系。</p>
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="entity-relations">
      <p className="px-0.5 text-2xs text-muted-foreground">
        {currentChapter !== undefined ? `截至第 ${currentChapter} 章` : "至今"}与 {currentCount} 人有仍成立的关系，共和 {counterparts.length} 人有过关系。
      </p>
      {counterparts.map((item) => {
        const expanded = open === item.entity.id;
        const latest = item.current[item.current.length - 1] ?? item.history[item.history.length - 1];
        return (
          <article key={item.entity.id} className="rounded-lg border border-border/70 bg-card p-2.5 text-xs shadow-xs" data-testid="entity-relation-counterpart">
            <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => setOpen(expanded ? null : item.entity.id)} aria-expanded={expanded}>
              <HeartHandshake className="size-3.5 shrink-0 text-primary/80" />
              <span className="font-semibold">{item.entity.name}</span>
              <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
                {item.current.length > 0 ? item.current.map((relation) => relation.predicate).join("、") : `已结束：${latest?.predicate ?? ""}`}
              </span>
              <Badge variant="outline" className="h-4 shrink-0 px-1 text-2xs">{item.trend.label}</Badge>
            </button>
            {expanded ? (
              <div className="mt-2 space-y-1.5 border-t pt-2">
                <p className="text-2xs leading-relaxed text-muted-foreground">{item.trend.explanation}{item.sharedEvents > 0 ? ` 共同经历事件 ${item.sharedEvents} 次。` : ""}</p>
                {item.history.map((relation) => (
                  <div key={relation.relationId} className={`space-y-1 rounded border p-2 ${relation.active ? "border-primary/40" : ""}`}>
                    <div className="flex flex-wrap items-center gap-1 text-2xs text-muted-foreground">
                      {onOpenChapter && relation.validFrom !== null ? (
                        <button type="button" className="inline-flex items-center gap-0.5 text-primary hover:underline" onClick={() => onOpenChapter(relation.validFrom!)}>
                          <BookOpen className="size-3" />{range(relation.validFrom, relation.validTo)}
                        </button>
                      ) : <span>{range(relation.validFrom, relation.validTo)}</span>}
                      <Badge variant="outline" className="h-4 px-1 text-2xs">{relation.polarity.label}</Badge>
                      {relation.active ? <Badge variant="secondary" className="h-4 px-1 text-2xs">仍成立</Badge> : <span>已结束</span>}
                    </div>
                    <div>
                      <span className="text-muted-foreground">{nameOf(relation.subjectId)} → {nameOf(relation.objectId)}：</span>
                      <span className="font-medium">{relation.predicate}</span>
                    </div>
                    {relation.evidence ? <p className="line-clamp-2 rounded bg-muted/30 p-1.5 text-2xs text-muted-foreground">依据：{relation.evidence}</p> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
