import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Play } from "lucide-react";
import { useApi, fetchJson } from "@/hooks/use-api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PresetItem {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly description: string;
  readonly tags?: readonly string[];
}

interface PresetsResponse {
  readonly presets: readonly PresetItem[];
}

type ExecuteScope = "full-chapter" | "selection";

export interface PresetsPanelProps {
  readonly bookId: string;
  readonly currentChapter?: number;
}

// ---------------------------------------------------------------------------
// Category labels
// ---------------------------------------------------------------------------

const CATEGORY_LABELS: Record<string, string> = {
  genre: "流派",
  tone: "文风",
  "setting-base": "时代基底",
  "logic-risk": "逻辑风险",
  bundle: "套装",
  beat: "节拍",
  "anti-ai": "去AI味",
  literary: "文学技法",
};

function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PresetsPanel({ bookId, currentChapter }: PresetsPanelProps) {
  const { data, loading, error } = useApi<PresetsResponse>("/presets");
  const [selectedPreset, setSelectedPreset] = useState<PresetItem | null>(null);
  const [scope, setScope] = useState<ExecuteScope>("full-chapter");
  const [selectionText, setSelectionText] = useState("");
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<{ presetId: string; data: unknown } | null>(null);
  const [execError, setExecError] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<string | null>(null);

  const presets = data?.presets ?? [];
  const filteredPresets = filterCategory
    ? presets.filter((p) => p.category === filterCategory)
    : presets;

  const categories = [...new Set(presets.map((p) => p.category))];

  async function handleExecute() {
    if (!selectedPreset) return;
    setExecuting(true);
    setExecError(null);
    setResult(null);

    try {
      const body: Record<string, unknown> = {
        mode: selectedPreset.category,
        presetId: selectedPreset.id,
        chapterNumber: currentChapter ?? 1,
      };
      if (scope === "selection" && selectionText.trim()) {
        body.text = selectionText.trim();
      }

      const res = await fetchJson<unknown>(
        `/books/${bookId}/inline-write`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      setResult({ presetId: selectedPreset.id, data: res });
      setSelectedPreset(null);
    } catch (cause) {
      setExecError(cause instanceof Error ? cause.message : "预设执行失败");
    } finally {
      setExecuting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
        <span className="ml-2 text-xs text-muted-foreground">加载预设…</span>
      </div>
    );
  }

  if (error) {
    return <p className="text-xs text-destructive py-4">{error}</p>;
  }

  return (
    <div className="space-y-3" data-testid="presets-panel">
      {/* Category filter */}
      {categories.length > 1 && (
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => setFilterCategory(null)}
            className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
              filterCategory === null
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            全部
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setFilterCategory(cat === filterCategory ? null : cat)}
              className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                filterCategory === cat
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {categoryLabel(cat)}
            </button>
          ))}
        </div>
      )}

      {/* Preset cards */}
      <div className="grid grid-cols-1 gap-2">
        {filteredPresets.map((preset) => (
          <div
            key={preset.id}
            className="flex items-start justify-between gap-2 rounded-lg border border-border p-2.5 hover:bg-muted/50 transition-colors"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-medium">{preset.name}</span>
                <Badge variant="secondary" className="text-[9px] h-4">
                  {categoryLabel(preset.category)}
                </Badge>
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">
                {preset.description}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 size-7"
              onClick={() => setSelectedPreset(preset)}
              title={`执行预设: ${preset.name}`}
            >
              <Play className="size-3.5" />
            </Button>
          </div>
        ))}
        {filteredPresets.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">暂无预设</p>
        )}
      </div>

      {/* Execution error */}
      {execError && <p className="text-xs text-destructive">{execError}</p>}

      {/* Result display */}
      {result && (
        <div className="rounded-lg border border-border p-3 space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-[10px]">
              {presets.find((p) => p.id === result.presetId)?.name ?? result.presetId}
            </Badge>
            <span className="text-[10px] text-muted-foreground">执行完成</span>
          </div>
          <pre className="text-[11px] text-muted-foreground overflow-x-auto max-h-40 whitespace-pre-wrap">
            {typeof result.data === "string" ? result.data : JSON.stringify(result.data, null, 2)}
          </pre>
        </div>
      )}

      {/* Execute dialog */}
      <Dialog open={selectedPreset !== null} onOpenChange={(open) => { if (!open) setSelectedPreset(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>执行预设：{selectedPreset?.name}</DialogTitle>
            <DialogDescription>{selectedPreset?.description}</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium">作用范围</label>
              <div className="flex gap-2 mt-1.5">
                <button
                  type="button"
                  onClick={() => setScope("full-chapter")}
                  className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${
                    scope === "full-chapter"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border hover:bg-muted"
                  }`}
                >
                  全章（第 {currentChapter ?? 1} 章）
                </button>
                <button
                  type="button"
                  onClick={() => setScope("selection")}
                  className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${
                    scope === "selection"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border hover:bg-muted"
                  }`}
                >
                  选段文本
                </button>
              </div>
            </div>

            {scope === "selection" && (
              <div>
                <label className="text-xs font-medium">输入文本</label>
                <textarea
                  className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-xs min-h-[80px] resize-y focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="粘贴或输入要处理的文本段落…"
                  value={selectionText}
                  onChange={(e) => setSelectionText(e.target.value)}
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setSelectedPreset(null)} disabled={executing}>
              取消
            </Button>
            <Button
              size="sm"
              onClick={() => void handleExecute()}
              disabled={executing || (scope === "selection" && !selectionText.trim())}
            >
              {executing ? (
                <>
                  <Loader2 className="size-3 animate-spin mr-1" />
                  执行中…
                </>
              ) : (
                "确认执行"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
