import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useApi } from "@/hooks/use-api";

export interface ArcData {
  readonly arcs: ReadonlyArray<{
    readonly characterId: string;
    readonly characterName: string;
    readonly arcType: string;
    readonly startState: string;
    readonly endState: string;
    readonly beats: ReadonlyArray<{
      readonly chapter: number;
      readonly description: string;
      readonly direction: "advance" | "regression" | "neutral";
    }>;
    readonly warnings: ReadonlyArray<string>;
  }>;
}

const DIRECTION_ICON: Record<string, string> = { advance: "↑", regression: "↓", neutral: "→" };
const DIRECTION_COLOR: Record<string, string> = {
  advance: "text-emerald-600",
  regression: "text-destructive",
  neutral: "text-muted-foreground",
};

export function CharacterArcDashboard({ bookId }: { readonly bookId: string }) {
  const { data, loading, error } = useApi<ArcData>(`/books/${bookId}/arcs`);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (loading) {
    return <Card><CardContent className="py-6 text-sm text-muted-foreground">正在加载角色弧线...</CardContent></Card>;
  }
  if (error) {
    return <Card><CardContent className="py-6 text-sm text-destructive">加载失败：{error}</CardContent></Card>;
  }
  if (!data || data.arcs.length === 0) {
    return <Card><CardContent className="py-6 text-sm text-muted-foreground">暂无角色弧线数据</CardContent></Card>;
  }

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle>角色弧线仪表盘</CardTitle>
        <CardDescription>群像总览：{data.arcs.length} 个角色弧线</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {data.arcs.map((arc) => {
          const expanded = expandedId === arc.characterId;
          const advanceCount = arc.beats.filter((b) => b.direction === "advance").length;
          const progress = arc.beats.length > 0 ? Math.round((advanceCount / arc.beats.length) * 100) : 0;

          return (
            <div key={arc.characterId} className="rounded-xl border border-border/60 bg-muted/20">
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm"
                onClick={() => setExpandedId(expanded ? null : arc.characterId)}
              >
                <span className="min-w-0 flex-1 font-medium">{arc.characterName}</span>
                <Badge variant="outline" className="shrink-0 text-xs">{arc.arcType}</Badge>
                <div className="w-20 shrink-0"><Progress aria-label={`${arc.characterName} 弧线进度`} value={progress} /></div>
                {arc.warnings.length > 0 && <Badge variant="destructive" className="shrink-0 text-xs">{arc.warnings.length} 警告</Badge>}
                <span className="shrink-0 text-xs text-muted-foreground">{expanded ? "收起" : "展开"}</span>
              </button>
              {expanded && (
                <div className="space-y-2 border-t border-border/40 px-3 py-2.5">
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    <span>起始：{arc.startState}</span>
                    <span>终态：{arc.endState}</span>
                  </div>
                  {arc.warnings.length > 0 && (
                    <div className="space-y-1">
                      {arc.warnings.map((w) => (
                        <div key={w} className="text-xs text-destructive">{w}</div>
                      ))}
                    </div>
                  )}
                  {arc.beats.length > 0 ? (
                    <div className="space-y-1">
                      {arc.beats.map((beat) => (
                        <div key={`${arc.characterId}-ch${beat.chapter}`} className="flex items-start gap-2 text-xs">
                          <Badge variant="outline" className="shrink-0">第{beat.chapter}章</Badge>
                          <span className={`shrink-0 ${DIRECTION_COLOR[beat.direction] ?? ""}`}>
                            {DIRECTION_ICON[beat.direction] ?? "→"}
                          </span>
                          <span className="text-muted-foreground">{beat.description}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">暂无节拍记录</div>
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
