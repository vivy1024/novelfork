import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Music, RefreshCw, Loader2, AlertCircle } from "lucide-react";
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
  readonly beats: readonly Beat[];
}

export interface BeatPanelProps {
  readonly bookId: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BeatPanel({ bookId }: BeatPanelProps) {
  const [data, setData] = useState<BeatStoreData | null>(null);
  const [templates, setTemplates] = useState<BeatTemplate[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load beat state from backend API (single source of truth)
  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      try {
        // 1. Load available templates
        const beatsRes = await fetch("/api/presets/beats");
        if (beatsRes.ok) {
          const beatsData = await beatsRes.json();
          if (!cancelled) setTemplates(beatsData.beats ?? []);
        }

        // 2. Load book's selected beat template from backend
        const bookRes = await fetch(`/api/books/${encodeURIComponent(bookId)}`);
        if (bookRes.ok) {
          const bookData = await bookRes.json();
          const beatTemplateId = bookData.beatTemplateId;
          if (beatTemplateId && !cancelled) {
            // Find the template in the loaded list
            const beatsData = await (await fetch("/api/presets/beats")).json();
            const allTemplates: BeatTemplate[] = beatsData.beats ?? [];
            const selected = allTemplates.find((t) => t.id === beatTemplateId);
            if (selected) {
              setData({
                templateId: selected.id,
                templateName: selected.name,
                beats: selected.beats.map((b, i) => ({ ...b, index: i })),
              });
            }
          }
        }
      } catch { /* ignore load errors */ }
      if (!cancelled) setLoading(false);
    }

    void loadData();
    return () => { cancelled = true; };
  }, [bookId]);

  // Select a template — persist to backend API
  const selectTemplate = useCallback(
    async (template: BeatTemplate) => {
      const newData: BeatStoreData = {
        templateId: template.id,
        templateName: template.name,
        beats: template.beats.map((b, i) => ({ ...b, index: i })),
      };
      setData(newData);
      setShowPicker(false);

      // Persist to backend (single source of truth)
      try {
        await fetch(`/api/books/${encodeURIComponent(bookId)}/beat-template`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ beatTemplateId: template.id }),
        });
      } catch { /* best-effort */ }

      // Notify other components (StatusBar etc.)
      window.dispatchEvent(new CustomEvent("novelfork-beat-updated", { detail: { bookId, templateName: template.name } }));
    },
    [bookId],
  );

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
                onClick={() => void selectTemplate(t)}
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

  // Selected template — reference display only
  return (
    <div className="space-y-3">
      {/* Header: template name + switch */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{data.templateName}</span>
        <Button variant="ghost" size="sm" onClick={() => setShowPicker(true)}>
          <RefreshCw className="size-3.5 mr-1" />
          切换
        </Button>
      </div>

      {/* Beat reference list */}
      <div className="space-y-1 max-h-60 overflow-y-auto">
        {data.beats.map((beat, i) => (
          <div
            key={i}
            className="flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted/30"
          >
            <Music className="size-3.5 text-muted-foreground/60 shrink-0" />
            <span className="truncate flex-1">{beat.name}</span>
            <span className="text-[10px] text-muted-foreground shrink-0">
              {Math.round(beat.wordRatio * 100)}%
            </span>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-muted-foreground">
        节拍模板为结构参考，Agent 写作时会参照当前模板安排情节节奏。
      </p>
    </div>
  );
}
