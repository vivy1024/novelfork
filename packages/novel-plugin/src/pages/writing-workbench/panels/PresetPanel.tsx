import { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Loader2, Plus, ChevronDown, ChevronUp, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PresetItem {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly promptInjection?: string;
  readonly enabled: boolean;
}

interface AllPreset {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly promptInjection?: string;
}

export interface PresetPanelProps {
  bookId: string;
  onOpenMarket?: () => void;
}

// ---------------------------------------------------------------------------
// Category config
// ---------------------------------------------------------------------------

const CATEGORY_LABELS: Record<string, string> = {
  genre: "流派套装",
  tone: "文风",
  "setting-base": "基底",
  "logic-risk": "逻辑风险",
  "anti-ai": "AI过滤",
  literary: "文学技法",
};

const CATEGORY_ORDER = ["genre", "tone", "setting-base", "logic-risk", "anti-ai", "literary"];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PresetPanel({ bookId, onOpenMarket }: PresetPanelProps) {
  const [presets, setPresets] = useState<PresetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Fetch book's enabled presets + all available presets
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      fetch(`/api/books/${bookId}/presets`).then((r) => {
        if (!r.ok) throw new Error("无法加载书籍预设配置");
        return r.json();
      }),
      fetch("/api/presets").then((r) => {
        if (!r.ok) throw new Error("无法加载预设列表");
        return r.json();
      }),
    ])
      .then(([bookData, allData]) => {
        if (cancelled) return;
        const enabledIds: string[] = bookData.enabledPresetIds ?? [];
        const allPresets: AllPreset[] = allData.presets ?? [];

        const merged: PresetItem[] = allPresets.map((p) => ({
          id: p.id,
          name: p.name,
          category: p.category,
          promptInjection: p.promptInjection,
          enabled: enabledIds.includes(p.id),
        }));

        setPresets(merged);
        setLoading(false);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "加载失败");
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [bookId]);

  // Save enabled presets to backend
  const saveEnabledPresets = useCallback(
    async (updatedPresets: PresetItem[]) => {
      const enabledIds = updatedPresets.filter((p) => p.enabled).map((p) => p.id);
      setSaving(true);
      try {
        const res = await fetch(`/api/books/${bookId}/presets`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabledPresetIds: enabledIds }),
        });
        if (!res.ok) {
          console.error("Failed to save presets:", await res.text());
        }
      } catch (err) {
        console.error("Failed to save presets:", err);
      } finally {
        setSaving(false);
      }
    },
    [bookId],
  );

  const handleToggle = (id: string, enabled: boolean) => {
    const updated = presets.map((p) => (p.id === id ? { ...p, enabled } : p));
    setPresets(updated);
    void saveEnabledPresets(updated);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-2">
        <AlertCircle className="size-6 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">{error}</p>
        <p className="text-xs text-muted-foreground">请确认已创建书籍并配置预设</p>
      </div>
    );
  }

  if (presets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-2">
        <AlertCircle className="size-6 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">暂无可用预设</p>
      </div>
    );
  }

  // Group by category
  const grouped = CATEGORY_ORDER.reduce<Record<string, PresetItem[]>>((acc, cat) => {
    const items = presets.filter((p) => p.category === cat);
    if (items.length > 0) acc[cat] = items;
    return acc;
  }, {});

  // Also include uncategorized
  const categorized = new Set(CATEGORY_ORDER);
  const uncategorized = presets.filter((p) => !categorized.has(p.category));
  if (uncategorized.length > 0) grouped["other"] = uncategorized;

  return (
    <div className="space-y-3">
      {saving && (
        <div className="text-[10px] text-muted-foreground flex items-center gap-1">
          <Loader2 className="size-3 animate-spin" /> 保存中...
        </div>
      )}

      {Object.entries(grouped).map(([category, items]) => (
        <div key={category} className="space-y-1.5">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
            {CATEGORY_LABELS[category] ?? category}
          </div>
          {items.map((preset) => (
            <div
              key={preset.id}
              className="flex items-start gap-2 rounded-md border border-border p-2"
            >
              <Switch
                checked={preset.enabled}
                onCheckedChange={(checked) => handleToggle(preset.id, checked)}
                className="mt-0.5 shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium truncate">{preset.name}</span>
                  <Badge variant="secondary" className="text-[10px] shrink-0">
                    {CATEGORY_LABELS[preset.category] ?? preset.category}
                  </Badge>
                </div>
                {preset.promptInjection && (
                  <div className="mt-1">
                    <p className={cn("text-xs text-muted-foreground", expandedId !== preset.id && "line-clamp-2")}>
                      {expandedId === preset.id
                        ? preset.promptInjection
                        : preset.promptInjection.slice(0, 80) + (preset.promptInjection.length > 80 ? "…" : "")}
                    </p>
                    {preset.promptInjection.length > 80 && (
                      <button
                        className="text-[10px] text-primary hover:underline mt-0.5 inline-flex items-center gap-0.5"
                        onClick={() => setExpandedId(expandedId === preset.id ? null : preset.id)}
                      >
                        {expandedId === preset.id ? (
                          <>收起 <ChevronUp className="size-3" /></>
                        ) : (
                          <>展开 <ChevronDown className="size-3" /></>
                        )}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ))}

      <Button
        variant="outline"
        size="sm"
        className="w-full mt-2"
        onClick={() => onOpenMarket?.()}
      >
        <Plus className="size-3.5 mr-1.5" />
        浏览模板市场
      </Button>
    </div>
  );
}
