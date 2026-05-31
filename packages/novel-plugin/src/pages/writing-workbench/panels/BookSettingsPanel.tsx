import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Loader2, AlertCircle, Music, Check } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BookConfig {
  title: string;
  genre: string;
  platform: "tomato" | "feilu" | "qidian" | "other";
  language: "zh" | "en";
  targetChapters: number;
  chapterWordCount: number;
  arcTrackingMode: "off" | "rule" | "llm";
  customSensitiveWords: string;
  beatTemplateId?: string;
}

interface PresetItem {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly enabled: boolean;
}

interface AllPreset {
  readonly id: string;
  readonly name: string;
  readonly category: string;
}

interface BeatTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly beats: readonly { name: string; wordRatio: number }[];
}

export interface BookSettingsPanelProps {
  bookId: string;
  onBack: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLATFORM_OPTIONS = [
  { value: "tomato", label: "番茄小说" },
  { value: "feilu", label: "飞卢小说" },
  { value: "qidian", label: "起点中文网" },
  { value: "other", label: "其他" },
] as const;

const LANGUAGE_OPTIONS = [
  { value: "zh", label: "中文" },
  { value: "en", label: "English" },
] as const;

const ARC_TRACKING_OPTIONS = [
  { value: "off", label: "关闭" },
  { value: "rule", label: "规则引擎" },
  { value: "llm", label: "LLM 精炼" },
] as const;

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
// Hook: useDebounce
// ---------------------------------------------------------------------------

function useDebounce<T extends (...args: unknown[]) => unknown>(fn: T, delay: number): T {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return useCallback(
    (...args: Parameters<T>) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => fnRef.current(...args), delay);
    },
    [delay],
  ) as unknown as T;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BookSettingsPanel({ bookId, onBack }: BookSettingsPanelProps) {
  // --- Basic info & writing params state ---
  const [config, setConfig] = useState<BookConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);

  // --- Presets state ---
  const [presets, setPresets] = useState<PresetItem[]>([]);
  const [presetsLoading, setPresetsLoading] = useState(true);
  const [presetsError, setPresetsError] = useState<string | null>(null);

  // --- Beat templates state ---
  const [beatTemplates, setBeatTemplates] = useState<BeatTemplate[]>([]);
  const [selectedBeatId, setSelectedBeatId] = useState<string | null>(null);
  const [beatsLoading, setBeatsLoading] = useState(true);
  const [beatsError, setBeatsError] = useState<string | null>(null);

  // --- Save indicator ---
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  // =========================================================================
  // Data loading
  // =========================================================================

  // Load book config
  useEffect(() => {
    let cancelled = false;
    setConfigLoading(true);
    setConfigError(null);

    fetch(`/api/books/${encodeURIComponent(bookId)}`)
      .then((r) => {
        if (!r.ok) throw new Error("无法加载书籍配置");
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        setConfig({
          title: data.title ?? "",
          genre: data.genre ?? "",
          platform: data.platform ?? "other",
          language: data.language ?? "zh",
          targetChapters: data.targetChapters ?? 100,
          chapterWordCount: data.chapterWordCount ?? 2000,
          arcTrackingMode: data.arcTrackingMode ?? "off",
          customSensitiveWords: data.customSensitiveWords ?? "",
          beatTemplateId: data.beatTemplateId,
        });
        setSelectedBeatId(data.beatTemplateId ?? null);
        setConfigLoading(false);
      })
      .catch((err) => {
        if (!cancelled) {
          setConfigError(err instanceof Error ? err.message : "加载失败");
          setConfigLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [bookId]);

  // Load presets
  useEffect(() => {
    let cancelled = false;
    setPresetsLoading(true);
    setPresetsError(null);

    Promise.all([
      fetch("/api/presets").then((r) => {
        if (!r.ok) throw new Error("无法加载预设列表");
        return r.json();
      }),
      fetch(`/api/books/${encodeURIComponent(bookId)}/presets`).then((r) => {
        if (!r.ok) throw new Error("无法加载书籍预设");
        return r.json();
      }),
    ])
      .then(([allData, bookData]) => {
        if (cancelled) return;
        const enabledIds: string[] = bookData.enabledPresetIds ?? [];
        const allPresets: AllPreset[] = allData.presets ?? [];
        setPresets(
          allPresets.map((p) => ({
            id: p.id,
            name: p.name,
            category: p.category,
            enabled: enabledIds.includes(p.id),
          })),
        );
        setPresetsLoading(false);
      })
      .catch((err) => {
        if (!cancelled) {
          setPresetsError(err instanceof Error ? err.message : "加载失败");
          setPresetsLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [bookId]);

  // Load beat templates
  useEffect(() => {
    let cancelled = false;
    setBeatsLoading(true);
    setBeatsError(null);

    fetch("/api/presets/beats")
      .then((r) => {
        if (!r.ok) throw new Error("无法加载节拍模板");
        return r.json();
      })
      .then((data) => {
        if (!cancelled) {
          setBeatTemplates(data.beats ?? []);
          setBeatsLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setBeatsError(err instanceof Error ? err.message : "加载失败");
          setBeatsLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, []);

  // =========================================================================
  // Auto-save for config (debounced)
  // =========================================================================

  const saveConfig = useCallback(
    async (partial: Partial<BookConfig>) => {
      setSaveStatus("saving");
      try {
        const res = await fetch(`/api/books/${encodeURIComponent(bookId)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(partial),
        });
        if (!res.ok) {
          console.error("Failed to save book config:", await res.text());
        }
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 1500);
      } catch (err) {
        console.error("Failed to save book config:", err);
        setSaveStatus("idle");
      }
    },
    [bookId],
  );

  const debouncedSave = useDebounce(saveConfig, 1000);

  const updateConfig = useCallback(
    (key: keyof BookConfig, value: string | number) => {
      setConfig((prev) => {
        if (!prev) return prev;
        const updated = { ...prev, [key]: value };
        debouncedSave({ [key]: value });
        return updated;
      });
    },
    [debouncedSave],
  );

  // =========================================================================
  // Preset toggle
  // =========================================================================

  const handlePresetToggle = useCallback(
    async (id: string, enabled: boolean) => {
      let enabledIds: string[] = [];
      setPresets((prev) => {
        const updated = prev.map((p) => (p.id === id ? { ...p, enabled } : p));
        enabledIds = updated.filter((p) => p.enabled).map((p) => p.id);
        return updated;
      });

      try {
        const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/presets`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabledPresetIds: enabledIds }),
        });
        if (!res.ok) console.error("Failed to save presets:", await res.text());
      } catch (err) {
        console.error("Failed to save presets:", err);
      }
    },
    [bookId, presets],
  );

  // =========================================================================
  // Beat template selection
  // =========================================================================

  const handleBeatSelect = useCallback(
    async (templateId: string) => {
      setSelectedBeatId(templateId);
      try {
        const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/beat-template`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ beatTemplateId: templateId }),
        });
        if (!res.ok) console.error("Failed to save beat template:", await res.text());
      } catch (err) {
        console.error("Failed to save beat template:", err);
      }
    },
    [bookId],
  );

  // =========================================================================
  // Render
  // =========================================================================

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="shrink-0">
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="text-sm font-semibold text-foreground">书籍设置</h1>
        {saveStatus === "saving" && (
          <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
            <Loader2 className="size-3 animate-spin" /> 保存中...
          </span>
        )}
        {saveStatus === "saved" && (
          <span className="ml-auto flex items-center gap-1 text-[11px] text-green-500">
            <Check className="size-3" /> 已保存
          </span>
        )}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
        {/* ============================================================= */}
        {/* Section 1: 基本信息 */}
        {/* ============================================================= */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">基本信息</h2>

          {configLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : configError ? (
            <div className="flex items-center gap-2 rounded-lg border border-border p-4">
              <AlertCircle className="size-4 text-destructive" />
              <span className="text-sm text-muted-foreground">{configError}</span>
            </div>
          ) : config ? (
            <div className="rounded-lg border border-border p-4 space-y-3">
              {/* 书名 */}
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">书名</label>
                <Input
                  value={config.title}
                  onChange={(e) => updateConfig("title", e.target.value)}
                  placeholder="输入书名"
                />
              </div>

              {/* 流派 */}
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">流派</label>
                <Input
                  value={config.genre}
                  onChange={(e) => updateConfig("genre", e.target.value)}
                  placeholder="如：都市、玄幻、科幻"
                />
              </div>

              {/* 平台 */}
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">平台</label>
                <Select
                  value={config.platform}
                  onValueChange={(v) => updateConfig("platform", v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PLATFORM_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 语言 */}
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">语言</label>
                <Select
                  value={config.language}
                  onValueChange={(v) => updateConfig("language", v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LANGUAGE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : null}
        </section>

        {/* ============================================================= */}
        {/* Section 2: 写作参数 */}
        {/* ============================================================= */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">写作参数</h2>

          {configLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : configError ? null : config ? (
            <div className="rounded-lg border border-border p-4 space-y-3">
              {/* 目标总章数 */}
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">目标总章数</label>
                <Input
                  type="number"
                  min={1}
                  value={config.targetChapters}
                  onChange={(e) => updateConfig("targetChapters", Number(e.target.value))}
                />
              </div>

              {/* 每章字数 */}
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">每章字数</label>
                <Input
                  type="number"
                  min={100}
                  value={config.chapterWordCount}
                  onChange={(e) => updateConfig("chapterWordCount", Number(e.target.value))}
                />
              </div>

              {/* 角色弧线追踪 */}
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">角色弧线追踪</label>
                <Select
                  value={config.arcTrackingMode}
                  onValueChange={(v) => updateConfig("arcTrackingMode", v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ARC_TRACKING_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 敏感词 */}
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">敏感词（每行一个）</label>
                <Textarea
                  value={config.customSensitiveWords}
                  onChange={(e) => updateConfig("customSensitiveWords", e.target.value)}
                  placeholder="每行输入一个敏感词"
                  className="min-h-20"
                />
              </div>
            </div>
          ) : null}
        </section>

        {/* ============================================================= */}
        {/* Section 3: 预设配置 */}
        {/* ============================================================= */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">预设配置</h2>

          {presetsLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : presetsError ? (
            <div className="flex items-center gap-2 rounded-lg border border-border p-4">
              <AlertCircle className="size-4 text-destructive" />
              <span className="text-sm text-muted-foreground">{presetsError}</span>
            </div>
          ) : presets.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-border p-6 gap-2">
              <AlertCircle className="size-5 text-muted-foreground/50" />
              <p className="text-xs text-muted-foreground">暂无可用预设</p>
            </div>
          ) : (
            <div className="space-y-4">
              {CATEGORY_ORDER.map((category) => {
                const items = presets.filter((p) => p.category === category);
                if (items.length === 0) return null;
                return (
                  <div key={category} className="rounded-lg border border-border p-4 space-y-2">
                    <h3 className="text-xs font-medium text-muted-foreground">
                      {CATEGORY_LABELS[category] ?? category}
                    </h3>
                    <div className="space-y-1.5">
                      {items.map((preset) => (
                        <div
                          key={preset.id}
                          className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted/30"
                        >
                          <span className="text-sm truncate">{preset.name}</span>
                          <Switch
                            checked={preset.enabled}
                            onCheckedChange={(checked) => void handlePresetToggle(preset.id, checked)}
                            aria-label={`切换预设: ${preset.name}`}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}

              {/* Uncategorized */}
              {(() => {
                const categorized = new Set(CATEGORY_ORDER);
                const uncategorized = presets.filter((p) => !categorized.has(p.category));
                if (uncategorized.length === 0) return null;
                return (
                  <div className="rounded-lg border border-border p-4 space-y-2">
                    <h3 className="text-xs font-medium text-muted-foreground">其他</h3>
                    <div className="space-y-1.5">
                      {uncategorized.map((preset) => (
                        <div
                          key={preset.id}
                          className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted/30"
                        >
                          <span className="text-sm truncate">{preset.name}</span>
                          <Switch
                            checked={preset.enabled}
                            onCheckedChange={(checked) => void handlePresetToggle(preset.id, checked)}
                            aria-label={`切换预设: ${preset.name}`}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </section>

        {/* ============================================================= */}
        {/* Section 4: 节拍模板 */}
        {/* ============================================================= */}
        <section className="space-y-3 pb-6">
          <h2 className="text-sm font-semibold text-foreground">节拍模板</h2>

          {beatsLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : beatsError ? (
            <div className="flex items-center gap-2 rounded-lg border border-border p-4">
              <AlertCircle className="size-4 text-destructive" />
              <span className="text-sm text-muted-foreground">{beatsError}</span>
            </div>
          ) : beatTemplates.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-border p-6 gap-2">
              <AlertCircle className="size-5 text-muted-foreground/50" />
              <p className="text-xs text-muted-foreground">暂无可用节拍模板</p>
            </div>
          ) : (
            <div className="space-y-2">
              {beatTemplates.map((template) => (
                <button
                  key={template.id}
                  onClick={() => void handleBeatSelect(template.id)}
                  className={cn(
                    "w-full text-left rounded-lg border border-border p-3 transition-colors hover:bg-muted/30",
                    selectedBeatId === template.id && "border-primary bg-primary/5",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Music className="size-3.5 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium">{template.name}</span>
                    {selectedBeatId === template.id && (
                      <Check className="size-3.5 text-primary ml-auto shrink-0" />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 ml-5.5">
                    {template.description}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5 ml-5.5">
                    {template.beats.length} 个节拍
                  </p>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
