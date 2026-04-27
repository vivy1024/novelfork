import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useApi } from "@/hooks/use-api";

export interface ConflictData {
  readonly conflicts: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly rank: "primary" | "secondary";
    readonly nature: "antagonistic" | "non-antagonistic";
    readonly status: string;
    readonly controllingIdea?: string;
    readonly transformations: ReadonlyArray<{ readonly chapter: number; readonly description: string }>;
  }>;
  readonly driftWarning?: { readonly message: string };
}

const RANK_ICON: Record<string, string> = { primary: "★", secondary: "○" };
const NATURE_LABEL: Record<string, string> = { antagonistic: "对抗性", "non-antagonistic": "非对抗性" };

export function ConflictMap({ bookId }: { readonly bookId: string }) {
  const { data, loading, error } = useApi<ConflictData>(`/books/${bookId}/conflicts/map`);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (loading) {
    return <Card><CardContent className="py-6 text-sm text-muted-foreground">正在加载矛盾地图...</CardContent></Card>;
  }
  if (error) {
    return <Card><CardContent className="py-6 text-sm text-destructive">加载失败：{error}</CardContent></Card>;
  }
  if (!data || data.conflicts.length === 0) {
    return <Card><CardContent className="py-6 text-sm text-muted-foreground">暂无矛盾数据</CardContent></Card>;
  }

  const primary = data.conflicts.filter((c) => c.rank === "primary");
  const secondary = data.conflicts.filter((c) => c.rank === "secondary");

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <CardTitle>矛盾地图</CardTitle>
            <CardDescription>主要矛盾 {primary.length} 条 · 次要矛盾 {secondary.length} 条</CardDescription>
          </div>
          {data.driftWarning && <Badge variant="destructive">偏移预警</Badge>}
        </div>
        {data.driftWarning && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {data.driftWarning.message}
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {data.conflicts.map((conflict) => {
          const expanded = expandedId === conflict.id;
          return (
            <div key={conflict.id} className="rounded-xl border border-border/60 bg-muted/20">
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm"
                onClick={() => setExpandedId(expanded ? null : conflict.id)}
              >
                <span className="shrink-0 text-base">{RANK_ICON[conflict.rank] ?? "○"}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{conflict.name}</span>
                <Badge variant="secondary" className="shrink-0 text-xs">{NATURE_LABEL[conflict.nature] ?? conflict.nature}</Badge>
                <Badge variant="outline" className="shrink-0 text-xs">{conflict.status}</Badge>
                <span className="shrink-0 text-xs text-muted-foreground">{expanded ? "收起" : "展开"}</span>
              </button>
              {expanded && (
                <div className="space-y-2 border-t border-border/40 px-3 py-2.5">
                  {conflict.controllingIdea && (
                    <div className="text-xs text-muted-foreground">控制理念：{conflict.controllingIdea}</div>
                  )}
                  {conflict.transformations.length > 0 ? (
                    <div className="space-y-1">
                      {conflict.transformations.map((t) => (
                        <div key={`${conflict.id}-ch${t.chapter}`} className="flex items-start gap-2 text-xs">
                          <Badge variant="outline" className="shrink-0">第{t.chapter}章</Badge>
                          <span className="text-muted-foreground">{t.description}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">暂无转化记录</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
