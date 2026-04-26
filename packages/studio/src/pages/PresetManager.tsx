import { useState, useMemo, useCallback } from "react";
import { useApi, fetchJson } from "../hooks/use-api";
import { notify } from "@/lib/notify";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Shield,
  Sparkles,
  BookOpen,
  AlertTriangle,
  Clock,
  Layers,
  Package,
  Music,
} from "lucide-react";

interface Preset {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly description: string;
  readonly promptInjection: string;
  readonly compatibleGenres?: ReadonlyArray<string>;
  readonly conflictGroup?: string;
}

interface PresetBundle {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly description: string;
  readonly genreIds: ReadonlyArray<string>;
  readonly toneId?: string;
  readonly settingBaseId?: string;
  readonly logicRiskIds: ReadonlyArray<string>;
  readonly difficulty: string;
  readonly prerequisites?: ReadonlyArray<string>;
  readonly suitableFor?: ReadonlyArray<string>;
  readonly notSuitableFor?: ReadonlyArray<string>;
}

interface BeatTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly beats: ReadonlyArray<{ readonly name: string; readonly purpose: string; readonly wordRatio: number }>;
}

const CATEGORY_TABS = [
  { key: "bundle", label: "推荐组合", icon: Package },
  { key: "tone", label: "文风", icon: BookOpen },
  { key: "setting-base", label: "时代基底", icon: Clock },
  { key: "logic-risk", label: "逻辑自检", icon: AlertTriangle },
  { key: "anti-ai", label: "AI味过滤", icon: Shield },
  { key: "literary", label: "文学技法", icon: Sparkles },
  { key: "beat", label: "叙事节拍", icon: Music },
  { key: "genre", label: "流派", icon: Layers },
] as const;

const DIFFICULTY_COLORS: Record<string, string> = {
  easy: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  hard: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

export default function PresetManager({ bookId }: { readonly bookId?: string }) {
  const [activeTab, setActiveTab] = useState("bundle");

  const { data: allPresetsData } = useApi<{ presets: Preset[] }>("/api/presets");
  const { data: bundlesData } = useApi<{ bundles: PresetBundle[] }>("/api/presets/bundles");
  const { data: beatsData } = useApi<{ beats: BeatTemplate[] }>("/api/presets/beats");
  const { data: bookPresetsData, refetch: refetchBookPresets } = useApi<{
    enabledPresetIds: string[];
    enabledPresets: Preset[];
  }>(bookId ? `/api/books/${bookId}/presets` : null);

  const allPresets = allPresetsData?.presets ?? [];
  const bundles = bundlesData?.bundles ?? [];
  const beats = beatsData?.beats ?? [];
  const enabledIds = new Set(bookPresetsData?.enabledPresetIds ?? []);

  const presetsByCategory = useMemo(() => {
    const map = new Map<string, Preset[]>();
    for (const p of allPresets) {
      const list = map.get(p.category) ?? [];
      list.push(p);
      map.set(p.category, list);
    }
    return map;
  }, [allPresets]);

  const togglePreset = useCallback(
    async (presetId: string, enabled: boolean) => {
      if (!bookId) return;
      const current = bookPresetsData?.enabledPresetIds ?? [];
      const next = enabled
        ? [...current, presetId]
        : current.filter((id) => id !== presetId);

      try {
        await fetchJson(`/api/books/${bookId}/presets`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabledPresetIds: next }),
        });
        void refetchBookPresets();
        notify.success(enabled ? "已启用预设" : "已禁用预设");
      } catch {
        notify.error("更新预设失败");
      }
    },
    [bookId, bookPresetsData, refetchBookPresets],
  );

  const applyBundle = useCallback(
    async (bundle: PresetBundle) => {
      if (!bookId) return;
      const current = new Set(bookPresetsData?.enabledPresetIds ?? []);
      const bundlePresetIds = [
        bundle.toneId,
        bundle.settingBaseId,
        ...bundle.logicRiskIds,
      ].filter(Boolean) as string[];

      for (const id of bundlePresetIds) current.add(id);

      try {
        await fetchJson(`/api/books/${bookId}/presets`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabledPresetIds: Array.from(current) }),
        });
        void refetchBookPresets();
        notify.success(`已应用组合「${bundle.name}」`);
      } catch {
        notify.error("应用组合失败");
      }
    },
    [bookId, bookPresetsData, refetchBookPresets],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">
          预设管理
        </h2>
        {bookId && (
          <Badge variant="outline">
            已启用 {enabledIds.size} 项
          </Badge>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <ScrollArea className="w-full">
          <TabsList className="flex flex-wrap gap-1">
            {CATEGORY_TABS.map(({ key, label, icon: Icon }) => (
              <TabsTrigger key={key} value={key} className="flex items-center gap-1.5 text-sm">
                <Icon className="h-3.5 w-3.5" />
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </ScrollArea>

        {/* Bundles tab */}
        <TabsContent value="bundle" className="space-y-3">
          {bundles.length === 0 && <EmptyState text="暂无推荐组合" />}
          {bundles.map((bundle) => (
            <BundleCard
              key={bundle.id}
              bundle={bundle}
              bookId={bookId}
              enabledIds={enabledIds}
              onApply={() => applyBundle(bundle)}
            />
          ))}
        </TabsContent>

        {/* Beat tab */}
        <TabsContent value="beat" className="space-y-3">
          {beats.length === 0 && <EmptyState text="暂无叙事节拍模板" />}
          {beats.map((bt) => (
            <BeatCard key={bt.id} beat={bt} />
          ))}
        </TabsContent>

        {/* Generic category tabs */}
        {CATEGORY_TABS.filter((t) => t.key !== "bundle" && t.key !== "beat").map(({ key }) => (
          <TabsContent key={key} value={key} className="space-y-3">
            {(presetsByCategory.get(key) ?? []).length === 0 && (
              <EmptyState text={`暂无${CATEGORY_TABS.find((t) => t.key === key)?.label ?? key}预设`} />
            )}
            {(presetsByCategory.get(key) ?? []).map((preset) => (
              <PresetCard
                key={preset.id}
                preset={preset}
                enabled={enabledIds.has(preset.id)}
                bookId={bookId}
                onToggle={(enabled) => togglePreset(preset.id, enabled)}
              />
            ))}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function EmptyState({ text }: { readonly text: string }) {
  return (
    <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
      {text}
    </div>
  );
}

function PresetCard({
  preset,
  enabled,
  bookId,
  onToggle,
}: {
  readonly preset: Preset;
  readonly enabled: boolean;
  readonly bookId?: string;
  readonly onToggle: (enabled: boolean) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{preset.name}</CardTitle>
          {bookId && (
            <Switch
              checked={enabled}
              onCheckedChange={onToggle}
              aria-label={`启用/禁用 ${preset.name}`}
            />
          )}
        </div>
        <CardDescription>{preset.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {preset.compatibleGenres && preset.compatibleGenres.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {preset.compatibleGenres.map((g) => (
              <Badge key={g} variant="secondary" className="text-xs">
                {g}
              </Badge>
            ))}
          </div>
        )}
        {preset.conflictGroup && (
          <p className="text-xs text-muted-foreground">
            冲突组：{preset.conflictGroup}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function BundleCard({
  bundle,
  bookId,
  enabledIds,
  onApply,
}: {
  readonly bundle: PresetBundle;
  readonly bookId?: string;
  readonly enabledIds: Set<string>;
  readonly onApply: () => void;
}) {
  const allApplied = [bundle.toneId, bundle.settingBaseId, ...bundle.logicRiskIds]
    .filter(Boolean)
    .every((id) => enabledIds.has(id!));

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">{bundle.name}</CardTitle>
            <Badge className={DIFFICULTY_COLORS[bundle.difficulty] ?? ""}>
              {bundle.difficulty}
            </Badge>
          </div>
          {bookId && (
            <button
              type="button"
              onClick={onApply}
              disabled={allApplied}
              className="rounded-md bg-primary px-3 py-1 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:bg-muted disabled:text-muted-foreground disabled:opacity-70"
            >
              {allApplied ? "已应用" : "应用组合"}
            </button>
          )}
        </div>
        <CardDescription>{bundle.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap gap-1.5 text-xs">
          {bundle.toneId && <Badge variant="outline">文风: {bundle.toneId}</Badge>}
          {bundle.settingBaseId && <Badge variant="outline">基底: {bundle.settingBaseId}</Badge>}
          {bundle.logicRiskIds.map((id) => (
            <Badge key={id} variant="outline">逻辑: {id}</Badge>
          ))}
        </div>
        {bundle.suitableFor && bundle.suitableFor.length > 0 && (
          <p className="text-xs text-muted-foreground">
            适用：{bundle.suitableFor.join("、")}
          </p>
        )}
        {bundle.notSuitableFor && bundle.notSuitableFor.length > 0 && (
          <p className="text-xs text-muted-foreground">
            不适用：{bundle.notSuitableFor.join("、")}
          </p>
        )}
        {bundle.prerequisites && bundle.prerequisites.length > 0 && (
          <p className="text-xs text-muted-foreground">
            前置：{bundle.prerequisites.join("、")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function BeatCard({
  beat,
}: {
  readonly beat: BeatTemplate;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card>
      <CardHeader className="pb-2 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{beat.name}</CardTitle>
          <Badge variant="secondary">{beat.beats.length} 节拍</Badge>
        </div>
        <CardDescription>{beat.description}</CardDescription>
      </CardHeader>
      {expanded && (
        <CardContent>
          <div className="space-y-1.5">
            {beat.beats.map((b, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <Badge variant="outline" className="shrink-0 text-xs tabular-nums">
                  {Math.round(b.wordRatio * 100)}%
                </Badge>
                <div>
                  <span className="font-medium">{b.name}</span>
                  <span className="text-muted-foreground ml-1.5">{b.purpose}</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
