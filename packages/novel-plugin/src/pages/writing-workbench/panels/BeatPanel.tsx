import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Music, CheckCircle2, Circle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Beat {
  readonly index: number;
  readonly name: string;
  readonly emotionalTone: string;
  readonly wordRatio: number;
  readonly completed: boolean;
}

interface BeatStoreData {
  readonly templateName: string;
  readonly beats: readonly Beat[];
  readonly currentBeatIndex: number;
}

export interface BeatPanelProps {
  readonly bookId: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BeatPanel({ bookId }: BeatPanelProps) {
  const [data, setData] = useState<BeatStoreData | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`novelfork-beat-${bookId}`);
      if (raw) {
        setData(JSON.parse(raw) as BeatStoreData);
      }
    } catch {
      // ignore parse errors
    }
    setLoaded(true);
  }, [bookId]);

  if (!loaded) return null;

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-3">
        <Music className="size-8 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">未选择节拍模板</p>
        <Button variant="outline" size="sm">
          选择模板
        </Button>
      </div>
    );
  }

  const completedCount = data.beats.filter((b) => b.completed).length;
  const totalCount = data.beats.length;
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const currentBeat = data.beats[data.currentBeatIndex];

  return (
    <div className="space-y-3">
      {/* Header: template name + progress */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{data.templateName}</span>
          <span className="text-xs text-muted-foreground">
            {completedCount}/{totalCount}
          </span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Current beat highlight */}
      {currentBeat && (
        <div className="rounded-md border border-primary/30 bg-primary/5 p-2.5 space-y-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-primary">当前节拍</span>
            <span className="text-xs text-muted-foreground">#{currentBeat.index + 1}</span>
          </div>
          <p className="text-sm font-medium">{currentBeat.name}</p>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>情绪: {currentBeat.emotionalTone}</span>
            <span>字数占比: {Math.round(currentBeat.wordRatio * 100)}%</span>
          </div>
        </div>
      )}

      {/* Beat list */}
      <div className="space-y-1">
        {data.beats.map((beat) => (
          <div
            key={beat.index}
            className={cn(
              "flex items-center gap-2 rounded px-2 py-1 text-xs",
              beat.index === data.currentBeatIndex && "bg-muted/50"
            )}
          >
            {beat.completed ? (
              <CheckCircle2 className="size-3.5 text-green-500 shrink-0" />
            ) : (
              <Circle className="size-3.5 text-muted-foreground/50 shrink-0" />
            )}
            <span className={cn("truncate", beat.completed && "text-muted-foreground line-through")}>
              {beat.name}
            </span>
          </div>
        ))}
      </div>

      <Button variant="outline" size="sm" className="w-full">
        <RefreshCw className="size-3.5 mr-1.5" />
        切换模板
      </Button>
    </div>
  );
}
