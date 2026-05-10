import { Badge } from "@/components/ui/badge";
import { Loader2, TrendingUp, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useApi } from "@/hooks/use-api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ArcBeat {
  readonly chapter: number;
  readonly event: string;
  readonly emotionDirection: string;
}

interface CharacterArc {
  readonly id: string;
  readonly characterId: string;
  readonly arcType: string;
  readonly startingState: string;
  readonly endingState: string;
  readonly currentPosition: string;
  readonly keyTurningPointsJson: string;
}

interface ArcsResponse {
  readonly arcs: readonly CharacterArc[];
}

export interface CharacterArcsPanelProps {
  readonly bookId: string;
  readonly onClose: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseBeats(json: string): ArcBeat[] {
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) {
      return parsed.map((item: Record<string, unknown>) => ({
        chapter: typeof item.chapter === "number" ? item.chapter : 0,
        event: typeof item.event === "string" ? item.event : String(item.event ?? ""),
        emotionDirection: typeof item.emotionDirection === "string" ? item.emotionDirection : "→",
      }));
    }
  } catch {
    // ignore
  }
  return [];
}

const ARC_TYPE_LABELS: Record<string, string> = {
  growth: "成长",
  fall: "堕落",
  flat: "坚守",
  transformation: "蜕变",
  redemption: "救赎",
};

function arcTypeLabel(type: string): string {
  return ARC_TYPE_LABELS[type] ?? type;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CharacterArcsPanel({ bookId, onClose }: CharacterArcsPanelProps) {
  const { data, loading, error } = useApi<ArcsResponse>(`/books/${bookId}/arcs`);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="rounded-lg border border-border p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">角色弧线</span>
          <button type="button" onClick={onClose} className="text-[10px] text-muted-foreground hover:text-foreground">关闭</button>
        </div>
        <div className="flex items-center justify-center py-6">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
          <span className="ml-2 text-xs text-muted-foreground">加载中…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-border p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">角色弧线</span>
          <button type="button" onClick={onClose} className="text-[10px] text-muted-foreground hover:text-foreground">关闭</button>
        </div>
        <p className="text-xs text-destructive">{error}</p>
      </div>
    );
  }

  const arcs = data?.arcs ?? [];

  return (
    <div className="rounded-lg border border-border p-3 space-y-2" data-testid="character-arcs-panel">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <TrendingUp className="size-3.5 text-primary" />
          <span className="text-xs font-medium">角色弧线</span>
          <Badge variant="secondary" className="text-[9px] h-4">{arcs.length}</Badge>
        </div>
        <button type="button" onClick={onClose} className="text-[10px] text-muted-foreground hover:text-foreground">关闭</button>
      </div>

      {arcs.length === 0 && (
        <p className="text-[10px] text-muted-foreground text-center py-3">暂无角色弧线数据</p>
      )}

      <div className="space-y-1.5">
        {arcs.map((arc) => {
          const expanded = expandedId === arc.id;
          const beats = parseBeats(arc.keyTurningPointsJson);
          return (
            <div key={arc.id} className="rounded-md border border-border">
              <button
                type="button"
                onClick={() => setExpandedId(expanded ? null : arc.id)}
                className="flex items-center gap-2 w-full p-2 text-left hover:bg-muted/50 transition-colors"
              >
                {expanded ? <ChevronDown className="size-3 shrink-0" /> : <ChevronRight className="size-3 shrink-0" />}
                <span className="text-xs font-medium flex-1 truncate">{arc.characterId}</span>
                <Badge variant="outline" className="text-[9px] h-4 shrink-0">{arcTypeLabel(arc.arcType)}</Badge>
              </button>

              {expanded && (
                <div className="px-2 pb-2 space-y-1.5 border-t border-border pt-1.5">
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span>当前阶段：</span>
                    <span className="text-foreground font-medium">{arc.currentPosition || "未知"}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span>{arc.startingState}</span>
                    <span>→</span>
                    <span>{arc.endingState}</span>
                  </div>

                  {beats.length > 0 && (
                    <div className="space-y-1 mt-1">
                      <span className="text-[10px] text-muted-foreground font-medium">弧线节拍</span>
                      {beats.map((beat, i) => (
                        <div key={i} className="flex items-start gap-1.5 text-[10px] pl-2">
                          <Badge variant="secondary" className="text-[8px] h-3.5 shrink-0">Ch.{beat.chapter}</Badge>
                          <span className="flex-1 text-muted-foreground">{beat.event}</span>
                          <span className="shrink-0 text-primary">{beat.emotionDirection}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
