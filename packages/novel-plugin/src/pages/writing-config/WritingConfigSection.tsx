import { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Loader2,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Music,
  RefreshCw,
  Wrench,
  Settings2,
  ListMusic,
  ShieldCheck,
  BrainCircuit,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ===========================================================================
// 写作配置统一 Section
// 整合：写作预设 / 节拍模板 / 辅助工具开关 三块逻辑
// ===========================================================================

type ConfigTab = "presets" | "beats" | "memory" | "tools";

// ---------------------------------------------------------------------------
// 预设相关类型与配置
// ---------------------------------------------------------------------------

interface PresetItem {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly promptInjection?: string;
  readonly conflictGroup?: string;
  readonly postWriteChecks?: readonly unknown[];
  readonly enabled: boolean;
}

interface AllPreset {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly promptInjection?: string;
  readonly conflictGroup?: string;
  readonly postWriteChecks?: readonly unknown[];
  readonly enabled?: boolean;
}

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
// 节拍相关类型
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

// ---------------------------------------------------------------------------
// 工具相关类型与配置
// ---------------------------------------------------------------------------

interface ToolItem {
  readonly id: string;
  readonly label: string;
}

/** 可选工具池 — 仅写作过程中 agent 主动查询的辅助工具，可按需开关 */
const OPTIONAL_TOOLS: readonly ToolItem[] = [
  { id: "lore.read", label: "静态设定" },
  { id: "memory.read", label: "叙事记忆" },
  { id: "memory.graph", label: "记忆图谱" },
  { id: "memory.events", label: "待确认事件" },
  { id: "chapter.read", label: "章节" },
  { id: "cockpit.snapshot", label: "快照" },
  { id: "hooks.manage", label: "伏笔" },
  { id: "character.check_consistency", label: "角色一致性" },
  { id: "presets.check_compliance", label: "合规检查" },
  { id: "narrative.read_line", label: "叙事线" },
];

/** 默认启用的工具 ID（写作角色基线） */
const ROLE_DEFAULTS: readonly string[] = [
  "lore.read",
  "memory.read",
  "chapter.read",
  "cockpit.snapshot",
  "hooks.manage",
  "presets.check_compliance",
];

function toolStorageKey(sessionId: string): string {
  return `novelfork-tool-config-${sessionId}`;
}

function loadToolConfig(sessionId: string | undefined): Set<string> | null {
  if (!sessionId) return null;
  try {
    const raw = localStorage.getItem(toolStorageKey(sessionId));
    if (raw) {
      const arr = JSON.parse(raw) as string[];
      return new Set(arr);
    }
  } catch {
    /* ignore */
  }
  return null;
}

function saveToolConfig(sessionId: string | undefined, enabled: Set<string>): void {
  if (!sessionId) return;
  try {
    localStorage.setItem(toolStorageKey(sessionId), JSON.stringify([...enabled]));
  } catch {
    /* ignore */
  }
}

// ===========================================================================
// Tab 1: 写作预设
// ===========================================================================

function PresetsTab({ bookId }: { bookId: string }) {
  const [presets, setPresets] = useState<PresetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/books/${encodeURIComponent(bookId)}/presets`)
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as {
          presets?: AllPreset[];
          enabledPresetIds?: string[];
          error?: string;
        } | null;
        if (!response.ok || !payload) {
          throw new Error(payload?.error ?? "无法加载书籍写作预设");
        }
        return payload;
      })
      .then((data) => {
        if (cancelled) return;
        const enabledIds = data.enabledPresetIds ?? [];
        const allPresets = data.presets ?? [];
        setPresets(allPresets.map((preset) => ({
          id: preset.id,
          name: preset.name,
          category: preset.category,
          promptInjection: preset.promptInjection,
          conflictGroup: preset.conflictGroup,
          postWriteChecks: preset.postWriteChecks,
          enabled: typeof preset.enabled === "boolean" ? preset.enabled : enabledIds.includes(preset.id),
        })));
        setLoading(false);
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "加载失败");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [bookId]);

  const saveEnabledPresets = useCallback(
    async (updatedPresets: PresetItem[]) => {
      const enabledIds = updatedPresets.filter((p) => p.enabled).map((p) => p.id);
      setSaving(true);
      try {
        const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/presets`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabledPresetIds: enabledIds }),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => null) as { error?: string } | null;
          throw new Error(payload?.error ?? "无法保存书籍预设");
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "无法保存书籍预设");
      } finally {
        setSaving(false);
      }
    },
    [bookId],
  );

  const handleToggle = (id: string, enabled: boolean) => {
    const target = presets.find((p) => p.id === id);
    const updated = presets.map((p) => {
      if (p.id === id) return { ...p, enabled };
      // 互斥处理：启用某预设时，自动关闭同 conflictGroup 的其他已启用预设
      if (
        enabled &&
        target?.conflictGroup &&
        p.conflictGroup === target.conflictGroup &&
        p.enabled
      ) {
        return { ...p, enabled: false };
      }
      return p;
    });
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

  // 按 category 分组
  const grouped = CATEGORY_ORDER.reduce<Record<string, PresetItem[]>>((acc, cat) => {
    const items = presets.filter((p) => p.category === cat);
    if (items.length > 0) acc[cat] = items;
    return acc;
  }, {});

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
          {items.map((preset) => {
            const hasPostWriteChecks =
              Array.isArray(preset.postWriteChecks) && preset.postWriteChecks.length > 0;
            return (
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
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-sm font-medium truncate">{preset.name}</span>
                    <Badge variant="secondary" className="text-[10px] shrink-0">
                      {CATEGORY_LABELS[preset.category] ?? preset.category}
                    </Badge>
                    {hasPostWriteChecks && (
                      <Badge
                        variant="outline"
                        className="text-[10px] shrink-0 inline-flex items-center gap-0.5"
                      >
                        <ShieldCheck className="size-2.5" />
                        含写后检测
                      </Badge>
                    )}
                  </div>
                  {preset.promptInjection && (
                    <div className="mt-1">
                      <p
                        className={cn(
                          "text-xs text-muted-foreground",
                          expandedId !== preset.id && "line-clamp-2",
                        )}
                      >
                        {expandedId === preset.id
                          ? preset.promptInjection
                          : preset.promptInjection.slice(0, 80) +
                            (preset.promptInjection.length > 80 ? "…" : "")}
                      </p>
                      {preset.promptInjection.length > 80 && (
                        <button
                          className="text-[10px] text-primary hover:underline mt-0.5 inline-flex items-center gap-0.5"
                          onClick={() =>
                            setExpandedId(expandedId === preset.id ? null : preset.id)
                          }
                        >
                          {expandedId === preset.id ? (
                            <>
                              收起 <ChevronUp className="size-3" />
                            </>
                          ) : (
                            <>
                              展开 <ChevronDown className="size-3" />
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ===========================================================================
// Tab 2: 节拍模板
// ===========================================================================

function BeatsTab({ bookId }: { bookId: string }) {
  const [data, setData] = useState<BeatStoreData | null>(null);
  const [templates, setTemplates] = useState<BeatTemplate[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setError(null);
      try {
        const response = await fetch(`/api/books/${encodeURIComponent(bookId)}/beat-templates`);
        const payload = await response.json().catch(() => null) as {
          templates?: BeatTemplate[];
          selectedTemplateId?: string | null;
          error?: string;
        } | null;
        if (!response.ok || !payload) {
          throw new Error(payload?.error ?? "无法加载书籍节拍模板");
        }
        const allTemplates = payload.templates ?? [];
        const selected = payload.selectedTemplateId
          ? allTemplates.find((template) => template.id === payload.selectedTemplateId)
          : undefined;
        if (!cancelled) {
          setTemplates(allTemplates);
          setData(selected
            ? {
                templateId: selected.id,
                templateName: selected.name,
                beats: selected.beats.map((beat, index) => ({ ...beat, index })),
              }
            : null);
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "无法加载书籍节拍模板");
      }
      if (!cancelled) setLoading(false);
    }

    void loadData();
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  const selectTemplate = useCallback(
    async (template: BeatTemplate) => {
      const newData: BeatStoreData = {
        templateId: template.id,
        templateName: template.name,
        beats: template.beats.map((b, i) => ({ ...b, index: i })),
      };
      setData(newData);
      setShowPicker(false);

      try {
        const response = await fetch(`/api/books/${encodeURIComponent(bookId)}/beat-template`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ beatTemplateId: template.id }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(payload?.error ?? "无法保存节拍模板");
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "无法保存节拍模板");
      }

      window.dispatchEvent(
        new CustomEvent("novelfork-beat-updated", {
          detail: { bookId, templateName: template.name },
        }),
      );
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

  // 模板选择器
  if (!data || showPicker) {
    return (
      <div className="space-y-3">
        {error && <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</p>}
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
                <div className="text-[10px] text-muted-foreground mt-1">
                  {t.beats.length} 个节拍
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // 已选模板 — 参考展示
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{data.templateName}</span>
        <Button variant="ghost" size="sm" onClick={() => setShowPicker(true)}>
          <RefreshCw className="size-3.5 mr-1" />
          切换
        </Button>
      </div>

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

// ===========================================================================
// Tab 3: 叙事记忆
// ===========================================================================

type NarrativeMemorySettings = {
  version: 1;
  settlement: {
    enabled: boolean;
    autoApplyLowRisk: boolean;
    autoApplyMediumRisk: boolean;
    highRiskAlwaysPending: boolean;
    minConfidence: number;
    blockWriteOnHighRiskPending: boolean;
    useLlmExtraction: boolean;
  };
  ledger: {
    closeSupersededFacts: boolean;
    currentViewLimit: number;
  };
  retrieval: {
    maxTokens: number;
    channels: {
      state: boolean;
      timeline: boolean;
      hooks: boolean;
      facts: boolean;
      style: boolean;
      semantic: boolean;
    };
    waveEnabled: boolean;
    semanticEnabled: boolean;
  };
};

function NarrativeMemoryToggle(props: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div data-slot="narrative-memory-toggle" className="flex items-center gap-3 rounded-md border border-border px-3 py-2.5">
      <div data-slot="narrative-memory-toggle-copy" className="min-w-0 flex-1">
        <div className="text-sm font-medium">{props.label}</div>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{props.description}</p>
      </div>
      <Switch
        checked={props.checked}
        onCheckedChange={props.onCheckedChange}
        disabled={props.disabled}
        aria-label={props.label}
        className="shrink-0"
      />
    </div>
  );
}

/** Book-scoped narrative memory settings, reusable from both configuration surfaces. */
export function NarrativeMemorySettingsSection({ bookId }: { bookId: string }) {
  const [config, setConfig] = useState<NarrativeMemorySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/books/${encodeURIComponent(bookId)}/narrative-memory/config`);
      const payload = await response.json().catch(() => null) as { config?: NarrativeMemorySettings; error?: string } | null;
      if (!response.ok || !payload?.config) throw new Error(payload?.error ?? "无法加载叙事记忆配置");
      setConfig(payload.config);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法加载叙事记忆配置");
    } finally {
      setLoading(false);
    }
  }, [bookId]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateSettlement = useCallback((patch: Partial<NarrativeMemorySettings["settlement"]>) => {
    setConfig((current) => current ? { ...current, settlement: { ...current.settlement, ...patch } } : current);
    setSaved(false);
  }, []);
  const updateLedger = useCallback((patch: Partial<NarrativeMemorySettings["ledger"]>) => {
    setConfig((current) => current ? { ...current, ledger: { ...current.ledger, ...patch } } : current);
    setSaved(false);
  }, []);
  const updateRetrieval = useCallback((patch: Partial<NarrativeMemorySettings["retrieval"]>) => {
    setConfig((current) => current ? { ...current, retrieval: { ...current.retrieval, ...patch } } : current);
    setSaved(false);
  }, []);
  const updateChannel = useCallback((channel: keyof NarrativeMemorySettings["retrieval"]["channels"], checked: boolean) => {
    setConfig((current) => current ? {
      ...current,
      retrieval: { ...current.retrieval, channels: { ...current.retrieval.channels, [channel]: checked } },
    } : current);
    setSaved(false);
  }, []);

  const save = useCallback(async () => {
    if (!config) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/books/${encodeURIComponent(bookId)}/narrative-memory/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      });
      const payload = await response.json().catch(() => null) as { config?: NarrativeMemorySettings; error?: string } | null;
      if (!response.ok || !payload?.config) throw new Error(payload?.error ?? "无法保存叙事记忆配置");
      setConfig(payload.config);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法保存叙事记忆配置");
    } finally {
      setSaving(false);
    }
  }, [bookId, config]);

  if (loading) {
    return <div className="flex items-center justify-center py-8"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>;
  }
  if (!config) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8">
        <AlertCircle className="size-6 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">{error ?? "无法加载叙事记忆配置"}</p>
        <Button size="sm" variant="outline" onClick={() => void load()}>重试</Button>
      </div>
    );
  }

  return (
    <div data-slot="narrative-memory-settings" className="flex flex-col gap-4">
      <div data-slot="narrative-memory-settings-intro" className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2.5">
        <div className="flex items-center gap-2 text-sm font-medium"><BrainCircuit className="size-4 text-primary" />动态事实与当前账本</div>
        <p className="mt-1 text-[11px] text-muted-foreground">经纬负责静态设定；这里控制章节结算、旧事实失效和写作前动态召回。</p>
      </div>

      {error && <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</p>}

      <div className="space-y-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">章节结算</p>
        <NarrativeMemoryToggle label="自动结算确认章节" description="章节正式确认后提取动态事件；关闭后不写入新的叙事事实。" checked={config.settlement.enabled} onCheckedChange={(checked) => updateSettlement({ enabled: checked })} />
        <NarrativeMemoryToggle label="自动应用低风险事件" description="高置信、低风险的角色状态和情节变化直接进入账本。" checked={config.settlement.autoApplyLowRisk} onCheckedChange={(checked) => updateSettlement({ autoApplyLowRisk: checked })} disabled={!config.settlement.enabled} />
        <NarrativeMemoryToggle label="自动应用中风险事件" description="中风险事件无需作者审批即可结算；高风险事件仍保留人工确认。" checked={config.settlement.autoApplyMediumRisk} onCheckedChange={(checked) => updateSettlement({ autoApplyMediumRisk: checked })} disabled={!config.settlement.enabled} />
        <NarrativeMemoryToggle label="高风险事件始终待审" description="涉及世界规则、核心伏笔或不可逆变化时，始终进入作者确认队列。" checked={config.settlement.highRiskAlwaysPending} onCheckedChange={(checked) => updateSettlement({ highRiskAlwaysPending: checked })} disabled={!config.settlement.enabled} />
        <NarrativeMemoryToggle label="使用 LLM 提取事件" description="关闭后仅使用规则与已有运行时状态提取章后事件。" checked={config.settlement.useLlmExtraction} onCheckedChange={(checked) => updateSettlement({ useLlmExtraction: checked })} disabled={!config.settlement.enabled} />
        <NarrativeMemoryToggle label="高风险待审时阻断写作" description="默认只提醒，不阻断；开启后需先处理高风险待审事件。" checked={config.settlement.blockWriteOnHighRiskPending} onCheckedChange={(checked) => updateSettlement({ blockWriteOnHighRiskPending: checked })} />
        <label data-slot="narrative-memory-confidence" className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
          <span className="min-w-0 text-sm font-medium">自动结算最低置信度</span>
          <Input
            aria-label="自动结算最低置信度"
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={config.settlement.minConfidence}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value) && value >= 0 && value <= 1) updateSettlement({ minConfidence: value });
            }}
            className="h-8 w-24 text-right"
          />
        </label>
      </div>

      <div className="space-y-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">当前故事状态</p>
        <NarrativeMemoryToggle label="关闭被新事实取代的旧记录" description="同一实体、主题的新状态落库时，将旧事实标记为在当前章失效，保证账本收敛。" checked={config.ledger.closeSupersededFacts} onCheckedChange={(checked) => updateLedger({ closeSupersededFacts: checked })} />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">写前召回</p>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">Token 预算
            <Input
              aria-label="叙事记忆 token 预算"
              type="number"
              min={500}
              max={100000}
              step={500}
              value={config.retrieval.maxTokens}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isInteger(value) && value >= 500 && value <= 100000) updateRetrieval({ maxTokens: value });
              }}
              className="h-8 w-24 text-right"
            />
          </label>
        </div>
        <NarrativeMemoryToggle label="状态通道" description="召回当前角色、地点、运行态和实体相关的账本事实。" checked={config.retrieval.channels.state} onCheckedChange={(checked) => updateChannel("state", checked)} />
        <NarrativeMemoryToggle label="时间线通道" description="召回近期章节和前章衔接信息。" checked={config.retrieval.channels.timeline} onCheckedChange={(checked) => updateChannel("timeline", checked)} />
        <NarrativeMemoryToggle label="伏笔通道" description="召回已埋设、待推进的伏笔和对应提醒。" checked={config.retrieval.channels.hooks} onCheckedChange={(checked) => updateChannel("hooks", checked)} />
        <NarrativeMemoryToggle label="结构化事实通道" description="按场景实体召回当前账本事实及一跳关联。" checked={config.retrieval.channels.facts} onCheckedChange={(checked) => updateChannel("facts", checked)} />
        <NarrativeMemoryToggle label="风格通道" description="注入书籍预设、节拍模板和风格提示。" checked={config.retrieval.channels.style} onCheckedChange={(checked) => updateChannel("style", checked)} />
        <NarrativeMemoryToggle label="语义召回" description="使用向量/语义候选；需要书籍可用的语义索引或提供方。" checked={config.retrieval.semanticEnabled && config.retrieval.channels.semantic} onCheckedChange={(checked) => updateRetrieval({ semanticEnabled: checked, channels: { ...config.retrieval.channels, semantic: checked } })} />
        <NarrativeMemoryToggle label="Wave 重排" description="对已召回上下文进行关联扩展和能量重排，默认关闭以保证稳定预算。" checked={config.retrieval.waveEnabled} onCheckedChange={(checked) => updateRetrieval({ waveEnabled: checked })} />
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
        {saved && <span className="text-xs text-primary">已保存</span>}
        <Button size="sm" onClick={() => void save()} disabled={saving}>
          {saving && <Loader2 className="mr-1 size-3.5 animate-spin" />}
          保存叙事记忆设置
        </Button>
      </div>
    </div>
  );
}

// ===========================================================================
// Tab 4: 辅助工具
// ===========================================================================

function ToolsTab({ sessionId }: { sessionId?: string }) {
  const [enabledTools, setEnabledTools] = useState<Set<string>>(() => {
    const stored = loadToolConfig(sessionId);
    return stored ?? new Set(ROLE_DEFAULTS);
  });

  useEffect(() => {
    const stored = loadToolConfig(sessionId);
    setEnabledTools(stored ?? new Set(ROLE_DEFAULTS));
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    saveToolConfig(sessionId, enabledTools);

    // 同步到后端：未勾选的工具进入 deny 列表
    const allOptionalIds = OPTIONAL_TOOLS.map((t) => t.id);
    const deny = allOptionalIds.filter((id) => !enabledTools.has(id));
    void fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionConfig: { toolPolicy: { deny } } }),
    }).catch(() => {
      /* best-effort */
    });
  }, [sessionId, enabledTools]);

  const handleToggle = useCallback((toolId: string) => {
    setEnabledTools((prev) => {
      const next = new Set(prev);
      if (next.has(toolId)) {
        next.delete(toolId);
      } else {
        next.add(toolId);
      }
      return next;
    });
  }, []);

  if (!sessionId) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-2">
        <Wrench className="size-6 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">请在写作会话中配置工具开关</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground">
        勾选 Agent 写作时可主动调用的辅助工具。未勾选的工具将被禁用。
      </p>
      <div className="space-y-1.5">
        {OPTIONAL_TOOLS.map((tool) => {
          const checked = enabledTools.has(tool.id);
          return (
            <label
              key={tool.id}
              className="flex cursor-pointer items-center gap-2 select-none rounded-md border border-border p-2 hover:bg-muted/50 transition-colors"
              title={tool.id}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => handleToggle(tool.id)}
                className="size-4 accent-primary shrink-0"
              />
              <span
                className={cn(
                  "text-sm font-medium",
                  checked ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {tool.label}
              </span>
              <span className="ml-auto text-[10px] text-muted-foreground/70 font-mono">
                {tool.id}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

// ===========================================================================
// 主组件
// ===========================================================================

const TABS: ReadonlyArray<{ id: ConfigTab; label: string; icon: typeof Settings2 }> = [
  { id: "presets", label: "写作预设", icon: Settings2 },
  { id: "beats", label: "节拍模板", icon: ListMusic },
  { id: "memory", label: "叙事记忆", icon: BrainCircuit },
  { id: "tools", label: "辅助工具", icon: Wrench },
];

export function WritingConfigSection(props: { bookId?: string; sessionId?: string }) {
  const { bookId, sessionId } = props;
  const [activeTab, setActiveTab] = useState<ConfigTab>("presets");

  const needsBook = activeTab === "presets" || activeTab === "beats" || activeTab === "memory";

  return (
    <div className="flex flex-col gap-3">
      {/* Tab 按钮组 */}
      <div className="flex items-center gap-1 border-b border-border">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab 内容 */}
      <div>
        {needsBook && !bookId ? (
          <div className="flex flex-col items-center justify-center py-8 gap-2">
            <AlertCircle className="size-6 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">请先选择书籍</p>
          </div>
        ) : (
          <>
            {activeTab === "presets" && bookId && <PresetsTab bookId={bookId} />}
            {activeTab === "beats" && bookId && <BeatsTab bookId={bookId} />}
            {activeTab === "memory" && bookId && <NarrativeMemorySettingsSection bookId={bookId} />}
            {activeTab === "tools" && <ToolsTab sessionId={sessionId} />}
          </>
        )}
      </div>
    </div>
  );
}
