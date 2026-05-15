import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Loader2, Plus, ChevronDown, ChevronUp } from "lucide-react";
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

interface PresetsResponse {
  readonly presets: readonly PresetItem[];
}

export interface PresetPanelProps {
  readonly bookId: string;
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
// Mock data (fallback when API unavailable)
// ---------------------------------------------------------------------------

const MOCK_PRESETS: PresetItem[] = [
  { id: "p1", name: "玄幻仙侠套装", category: "genre", promptInjection: "以东方玄幻世界观为基础，融合修仙体系与宗门势力，注重境界划分与功法描写，战斗场面宏大磅礴", enabled: true },
  { id: "p2", name: "冷峻叙事", category: "tone", promptInjection: "文风偏冷峻克制，少用感叹号，多用短句，叙事节奏紧凑，情感表达含蓄内敛", enabled: true },
  { id: "p3", name: "现代都市", category: "setting-base", promptInjection: "以当代中国都市为背景，涉及职场、商业、社交等现代生活场景", enabled: false },
  { id: "p4", name: "因果逻辑检查", category: "logic-risk", promptInjection: "检查前后因果关系是否成立，角色动机是否合理，时间线是否一致", enabled: true },
  { id: "p5", name: "去AI味过滤", category: "anti-ai", promptInjection: "避免使用'值得注意的是'、'总而言之'等AI常见表达，减少排比句和对仗句式", enabled: true },
  { id: "p6", name: "白描手法", category: "literary", promptInjection: "以简洁朴素的文字直接描摹事物，不加修饰渲染，追求客观冷静的叙述效果", enabled: false },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PresetPanel({ bookId }: PresetPanelProps) {
  const [presets, setPresets] = useState<PresetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetch(`/api/books/${bookId}/presets`)
      .then((res) => {
        if (!res.ok) throw new Error("API unavailable");
        return res.json() as Promise<PresetsResponse>;
      })
      .then((data) => {
        if (!cancelled) {
          setPresets(data.presets.map((p) => ({ ...p, enabled: true })));
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPresets(MOCK_PRESETS);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [bookId]);

  const handleToggle = (id: string, enabled: boolean) => {
    setPresets((prev) => prev.map((p) => (p.id === id ? { ...p, enabled } : p)));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Group by category
  const grouped = CATEGORY_ORDER.reduce<Record<string, PresetItem[]>>((acc, cat) => {
    const items = presets.filter((p) => p.category === cat);
    if (items.length > 0) acc[cat] = items;
    return acc;
  }, {});

  return (
    <div className="space-y-3">
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

      <Button variant="outline" size="sm" className="w-full mt-2">
        <Plus className="size-3.5 mr-1.5" />
        添加套装
      </Button>
    </div>
  );
}
