import { useState, useEffect } from "react";
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
import { Switch } from "@/components/ui/switch";
import { Loader2, Eye } from "lucide-react";
import { useApi, fetchJson, putApi } from "@/hooks/use-api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PresetItem {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly description: string;
  readonly tags?: readonly string[];
  readonly promptInjection?: string;
}

interface PresetsResponse {
  readonly presets: readonly PresetItem[];
}

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

export function PresetsPanel({ bookId }: PresetsPanelProps) {
  const { data, loading, error } = useApi<PresetsResponse>("/presets");
  const [selectedPreset, setSelectedPreset] = useState<PresetItem | null>(null);
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [enabledIds, setEnabledIds] = useState<string[]>([]);
  const [applyMessage, setApplyMessage] = useState<string | null>(null);

  // Load book's enabled preset IDs
  useEffect(() => {
    fetchJson<{ enabledPresetIds?: string[] }>(`/books/${bookId}`)
      .then((book) => setEnabledIds(book.enabledPresetIds ?? []))
      .catch(() => {});
  }, [bookId]);

  async function handleTogglePreset(presetId: string, enabled: boolean) {
    const nextIds = enabled
      ? [...enabledIds, presetId]
      : enabledIds.filter((id) => id !== presetId);
    setEnabledIds(nextIds);
    try {
      await putApi(`/books/${bookId}/presets`, { enabledPresetIds: nextIds });
    } catch {
      // Revert on failure
      setEnabledIds(enabledIds);
    }
  }

  function handleApplyPreset(preset: PresetItem) {
    // Toggle the preset on if not already enabled
    if (!enabledIds.includes(preset.id)) {
      void handleTogglePreset(preset.id, true);
    }
    setApplyMessage(`已应用预设「${preset.name}」到下次生成`);
    setTimeout(() => setApplyMessage(null), 3000);
  }

  const presets = data?.presets ?? [];
  const filteredPresets = filterCategory
    ? presets.filter((p) => p.category === filterCategory)
    : presets;

  const categories = [...new Set(presets.map((p) => p.category))];

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
            <div className="flex items-center gap-1 shrink-0">
              <Switch
                checked={enabledIds.includes(preset.id)}
                onCheckedChange={(checked) => void handleTogglePreset(preset.id, checked)}
                aria-label={`启用预设 ${preset.name}`}
                className="scale-75"
              />
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => setSelectedPreset(preset)}
                title={`预览预设: ${preset.name}`}
              >
                <Eye className="size-3.5" />
              </Button>
            </div>
          </div>
        ))}
        {filteredPresets.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">暂无预设</p>
        )}
      </div>

      {/* Apply confirmation */}
      {applyMessage && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400">{applyMessage}</p>
      )}

      {/* Preview dialog */}
      <Dialog open={selectedPreset !== null} onOpenChange={(open) => { if (!open) setSelectedPreset(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>预设预览：{selectedPreset?.name}</DialogTitle>
            <DialogDescription>{selectedPreset?.description}</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Prompt 注入规则</label>
              <pre className="mt-1.5 rounded-md border border-border bg-muted/50 px-3 py-2 text-xs whitespace-pre-wrap max-h-48 overflow-y-auto">
                {selectedPreset?.promptInjection || "（无 prompt 注入内容）"}
              </pre>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setSelectedPreset(null)}>
              关闭
            </Button>
            <Button
              size="sm"
              onClick={() => { if (selectedPreset) { handleApplyPreset(selectedPreset); setSelectedPreset(null); } }}
            >
              启用此预设
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
