import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Music, CheckCircle2, Circle, RefreshCw, Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Beat {
  readonly index: number;
  readonly name: string;
  readonly emotionalTone: string;
  readonly wordRatio: number;
  readonly networkNovelTip?: string;
}

interface BeatTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly beats: readonly Beat[];
}

interface BeatStoreData {
  readonly templateId: string;
  readonly templateName: string;
  readonly beats: readonly (Beat & { completed: boolean })[];
  readonly currentBeatIndex: number;
}

export interface BeatPanelProps {
  readonly bookId: string;
}

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

function getStorageKey(bookId: string): string {
  return `novelfork-beat-${bookId}`;
}

function loadBeatStore(bookId: string): BeatStoreData | null {
  try {
    const raw = localStorage.getItem(getStorageKey(bookId));
    if (raw) return JSON.parse(raw) as BeatStoreData;
  } catch { /* ignore */ }
  return null;
}

function saveBeatStore(bookId: string, data: BeatStoreData): void {
  localStorage.setItem(getStorageKey(bookId), JSON.stringify(data));
  // Notify StatusBar to re-read beat progress
  window.dispatchEvent(new CustomEvent("novelfork-beat-updated"));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BeatPanel({ bookId }: BeatPanelProps) {
  const [data, setData] = useState<BeatStoreData | null>(null);
  const [templates, setTemplates] = useState<BeatTemplate[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load saved beat state + available templates
  useEffect(() => {
    const saved = loadBeatStore(bookId);
    setData(saved);

    fetch("/api/presets/beats")
      .then((r) => {
        if (!r.ok) throw new Error("API error");
        return r.json();
      })
      .then((res) => {
        setTemplates(res.beats ?? []);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [bookId]);

  // Select a template
  const selectTemplate = useCallback(
    (template: BeatTemplate) => {
      // If selecting the same template, just close picker without resetting progress
      if (data?.templateId === template.id) {
        setShowPicker(false);
        return;
      }

      const newData: BeatStoreData = {
        templateId: template.id,
        templateName: template.name,
        beats: template.beats.map((b, i) => ({ ...b, index: i, completed: false })),
        currentBeatIndex: 0,
      };
      setData(newData);
      saveBeatStore(bookId, newData);
      setShowPicker(false);

      // Sync to backend so beat.get_current tool can read it
      void fetch(`/api/books/${bookId}/beat-template`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ beatTemplateId: template.id }),
      }).catch(() => { /* best-effort sync */ });
    },
    [bookId, data?.templateId],
  );

  // Advance current beat
  const advanceBeat = useCallback(() => {
    if (!data) return;
    const nextIndex = Math.min(data.currentBeatIndex + 1, data.beats.length - 1);
    const updated: BeatStoreData = {
      ...data,
      currentBeatIndex: nextIndex,
      beats: data.beats.map((b, i) => (i < nextIndex ? { ...b, completed: true } : b)),
    };
    setData(updated);
    saveBeatStore(bookId, updated);
  }, [bookId, data]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Template picker
  if (!data || showPicker) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">选择节拍模板</p>
          {data && (
            <Button variant="ghost" size="sm" onClick={() => setShowPicker(false)}>
              取消
            </Button>
          )}
        </div>

        {templates.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 gap-2">
            <AlertCircle className="size-6 text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground">无可用节拍模板</p>
          </div>
        ) : (
          <div className="space-y-2">
            {templates.map((t) => (
              <button
                key={t.id}
                onClick={() => selectTemplate(t)}
                className={cn(
                  "w-full text-left rounded-md border border-border p-2.5 hover:bg-muted/50 transition-colors",
                  data?.templateId === t.id && "border-primary bg-primary/5",
                )}
              >
                <div className="text-sm font-medium">{t.name}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{t.description}</div>
                <div className="text-[10px] text-muted-foreground mt-1">{t.beats.length} 个节拍</div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Active beat display
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
            <span className="text-xs text-muted-foreground">#{data.currentBeatIndex + 1}</span>
          </div>
          <p className="text-sm font-medium">{currentBeat.name}</p>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>情绪: {currentBeat.emotionalTone}</span>
            <span>字数占比: {Math.round(currentBeat.wordRatio * 100)}%</span>
          </div>
          {currentBeat.networkNovelTip && (
            <p className="text-[11px] text-muted-foreground mt-1">💡 {currentBeat.networkNovelTip}</p>
          )}
        </div>
      )}

      {/* Beat list */}
      <div className="space-y-1 max-h-48 overflow-y-auto">
        {data.beats.map((beat, i) => (
          <div
            key={i}
            className={cn(
              "flex items-center gap-2 rounded px-2 py-1 text-xs",
              i === data.currentBeatIndex && "bg-muted/50",
            )}
          >
            {beat.completed ? (
              <CheckCircle2 className="size-3.5 text-green-500 shrink-0" />
            ) : i === data.currentBeatIndex ? (
              <Music className="size-3.5 text-primary shrink-0" />
            ) : (
              <Circle className="size-3.5 text-muted-foreground/50 shrink-0" />
            )}
            <span className={cn("truncate", beat.completed && "text-muted-foreground line-through")}>
              {beat.name}
            </span>
            <span className="ml-auto text-[10px] text-muted-foreground shrink-0">
              {Math.round(beat.wordRatio * 100)}%
            </span>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={advanceBeat}
          disabled={data.currentBeatIndex >= data.beats.length - 1}
        >
          <CheckCircle2 className="size-3.5 mr-1.5" />
          完成当前节拍
        </Button>
        <Button variant="outline" size="sm" onClick={() => setShowPicker(true)}>
          <RefreshCw className="size-3.5 mr-1.5" />
          切换
        </Button>
      </div>
    </div>
  );
}
