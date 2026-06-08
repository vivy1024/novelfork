import { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
} from "lucide-react";
import { cn } from "@/lib/utils";

// ===========================================================================
// 写作配置统一 Section
// 整合：写作预设 / 节拍模板 / 辅助工具开关 三块逻辑
// ===========================================================================

type ConfigTab = "presets" | "beats" | "tools";

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
  { id: "jingwei.read", label: "经纬" },
  { id: "chapter.read", label: "章节" },
  { id: "cockpit.snapshot", label: "快照" },
  { id: "cockpit.list_open_hooks", label: "伏笔" },
  { id: "character.check_consistency", label: "角色一致性" },
  { id: "presets.check_compliance", label: "合规检查" },
  { id: "narrative.read_line", label: "叙事线" },
  { id: "hooks.manage", label: "钩子管理" },
];

/** 默认启用的工具 ID（写作角色基线） */
const ROLE_DEFAULTS: readonly string[] = [
  "jingwei.read",
  "chapter.read",
  "cockpit.snapshot",
  "cockpit.list_open_hooks",
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
          conflictGroup: p.conflictGroup,
          postWriteChecks: p.postWriteChecks,
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

    return () => {
      cancelled = true;
    };
  }, [bookId]);

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

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      try {
        // 1. 加载可用模板列表
        const beatsRes = await fetch("/api/presets/beats");
        let allTemplates: BeatTemplate[] = [];
        if (beatsRes.ok) {
          const beatsData = await beatsRes.json();
          allTemplates = beatsData.beats ?? [];
          if (!cancelled) setTemplates(allTemplates);
        }

        // 2. 加载书籍当前选中的节拍模板
        const bookRes = await fetch(`/api/books/${encodeURIComponent(bookId)}`);
        if (bookRes.ok) {
          const bookData = await bookRes.json();
          const beatTemplateId = bookData.beatTemplateId;
          if (beatTemplateId && !cancelled) {
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
      } catch {
        /* ignore load errors */
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
        await fetch(`/api/books/${encodeURIComponent(bookId)}/beat-template`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ beatTemplateId: template.id }),
        });
      } catch {
        /* best-effort */
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
// Tab 3: 辅助工具
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
  { id: "tools", label: "辅助工具", icon: Wrench },
];

export function WritingConfigSection(props: { bookId?: string; sessionId?: string }) {
  const { bookId, sessionId } = props;
  const [activeTab, setActiveTab] = useState<ConfigTab>("presets");

  const needsBook = activeTab === "presets" || activeTab === "beats";

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
            {activeTab === "tools" && <ToolsTab sessionId={sessionId} />}
          </>
        )}
      </div>
    </div>
  );
}
