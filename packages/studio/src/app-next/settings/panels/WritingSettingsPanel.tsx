import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/ui/simple-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson, putApi } from "@/hooks/use-api";
import type { WritingSettings } from "@/types/settings";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_WRITING: WritingSettings = {
  defaultTone: "concise",
  antiAiStrength: 70,
  sentenceLength: "medium",
  dialogueRatio: 40,
  defaultPov: "third-limited",
  dailyWordTarget: 3000,
  chapterMinWords: 2000,
  chapterMaxWords: 5000,
  reminderEnabled: false,
  reminderTime: "20:00",
  beatDensity: "standard",
  targetPlatforms: ["自由"],
  contentRating: "all-ages",
  customSensitiveWords: "",
};

const STYLE_OPTIONS = [
  { value: "concise", label: "简洁" },
  { value: "ornate", label: "华丽" },
  { value: "colloquial", label: "口语化" },
  { value: "literary", label: "文学性" },
];

const SENTENCE_LENGTH_OPTIONS = [
  { value: "short", label: "短句优先" },
  { value: "medium", label: "中等" },
  { value: "long", label: "长句优先" },
];

const POV_OPTIONS = [
  { value: "first", label: "第一人称" },
  { value: "third-limited", label: "第三人称有限" },
  { value: "third-omniscient", label: "第三人称全知" },
  { value: "second", label: "第二人称" },
];

const BEAT_DENSITY_OPTIONS = [
  { value: "compact", label: "紧凑" },
  { value: "standard", label: "标准" },
  { value: "relaxed", label: "舒缓" },
];

const RATING_OPTIONS = [
  { value: "all-ages", label: "全年龄" },
  { value: "teen", label: "青少年" },
  { value: "adult", label: "成人" },
];

const PLATFORM_LIST = [
  { id: "起点", label: "起点" },
  { id: "番茄", label: "番茄" },
  { id: "晋江", label: "晋江" },
  { id: "刺猬猫", label: "刺猬猫" },
  { id: "自由", label: "自由" },
] as const;

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-border pt-4">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function FieldRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <span className="text-sm text-muted-foreground">{label}</span>
        {description && (
          <p className="text-xs text-muted-foreground/70">{description}</p>
        )}
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dirty check
// ---------------------------------------------------------------------------

function isEqual(a: WritingSettings, b: WritingSettings): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function WritingSettingsPanel() {
  const [form, setForm] = useState<WritingSettings>(DEFAULT_WRITING);
  const savedRef = useRef<WritingSettings>(DEFAULT_WRITING);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = !isEqual(form, savedRef.current);

  // Load settings from API
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const config = await fetchJson<{ writing?: WritingSettings }>("/api/settings/user");
        if (cancelled) return;
        const writing = { ...DEFAULT_WRITING, ...(config.writing ?? {}) };
        setForm(writing);
        savedRef.current = writing;
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await putApi("/api/settings/user", { writing: form });
      savedRef.current = { ...form };
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [form]);

  const handleCancel = useCallback(() => {
    setForm(savedRef.current);
  }, []);

  const togglePlatform = (platformId: string) => {
    setForm((prev) => {
      const exists = prev.targetPlatforms.includes(platformId);
      return {
        ...prev,
        targetPlatforms: exists
          ? prev.targetPlatforms.filter((p) => p !== platformId)
          : [...prev.targetPlatforms, platformId],
      };
    });
  };

  if (loading) {
    return <div className="py-8 text-center text-sm text-muted-foreground">加载中...</div>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-16">
      {error && (
        <div className="rounded border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* ---- AI 写作风格 ---- */}
      <Section title="AI 写作风格">
        <FieldRow label="默认文风偏好" description="新建书籍时的默认文风基调">
          <SimpleSelect
            value={form.defaultTone}
            onValueChange={(v) => setForm((s) => ({ ...s, defaultTone: v as WritingSettings["defaultTone"] }))}
            options={STYLE_OPTIONS}
            aria-label="默认文风偏好"
          />
        </FieldRow>

        <FieldRow label="去AI味强度" description="AI 味过滤器的默认检测灵敏度（%）">
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={100}
              value={form.antiAiStrength}
              onChange={(e) => setForm((s) => ({ ...s, antiAiStrength: Number(e.target.value) }))}
              className="h-2 w-28 cursor-pointer accent-primary"
              aria-label="去AI味强度"
            />
            <span className="w-8 text-right text-xs text-muted-foreground">
              {form.antiAiStrength}
            </span>
          </div>
        </FieldRow>

        <FieldRow label="句长控制" description="生成文本的平均句长偏好">
          <SimpleSelect
            value={form.sentenceLength}
            onValueChange={(v) => setForm((s) => ({ ...s, sentenceLength: v as WritingSettings["sentenceLength"] }))}
            options={SENTENCE_LENGTH_OPTIONS}
            aria-label="句长控制"
          />
        </FieldRow>

        <FieldRow label="对话比例目标" description="章节中对话内容的目标占比（%）">
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={100}
              value={form.dialogueRatio}
              onChange={(e) => setForm((s) => ({ ...s, dialogueRatio: Number(e.target.value) }))}
              className="h-2 w-28 cursor-pointer accent-primary"
              aria-label="对话比例目标"
            />
            <span className="w-8 text-right text-xs text-muted-foreground">
              {form.dialogueRatio}
            </span>
          </div>
        </FieldRow>

        <FieldRow label="默认人称视角" description="新建书籍时的默认叙事视角">
          <SimpleSelect
            value={form.defaultPov}
            onValueChange={(v) => setForm((s) => ({ ...s, defaultPov: v as WritingSettings["defaultPov"] }))}
            options={POV_OPTIONS}
            aria-label="默认人称视角"
          />
        </FieldRow>
      </Section>

      {/* ---- 日更目标与节奏 ---- */}
      <Section title="日更目标与节奏">
        <FieldRow label="每日字数目标" description="每日写作字数目标，用于进度追踪">
          <Input
            type="number"
            min={0}
            value={form.dailyWordTarget}
            onChange={(e) => setForm((d) => ({ ...d, dailyWordTarget: Math.max(0, Number(e.target.value) || 0) }))}
            className="w-24"
            aria-label="每日字数目标"
          />
        </FieldRow>

        <FieldRow label="章节字数范围" description="单章节的字数上下限">
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              value={form.chapterMinWords}
              onChange={(e) => setForm((d) => ({ ...d, chapterMinWords: Math.max(0, Number(e.target.value) || 0) }))}
              className="w-20"
              aria-label="章节最小字数"
            />
            <span className="text-xs text-muted-foreground">—</span>
            <Input
              type="number"
              min={0}
              value={form.chapterMaxWords}
              onChange={(e) => setForm((d) => ({ ...d, chapterMaxWords: Math.max(0, Number(e.target.value) || 0) }))}
              className="w-20"
              aria-label="章节最大字数"
            />
          </div>
        </FieldRow>

        <FieldRow label="更新频率提醒" description="启用后在设定时间提醒写作">
          <div className="flex items-center gap-2">
            <Switch
              checked={form.reminderEnabled}
              onCheckedChange={(v) => setForm((d) => ({ ...d, reminderEnabled: v }))}
              aria-label="更新频率提醒开关"
            />
            {form.reminderEnabled && (
              <Input
                type="time"
                value={form.reminderTime}
                onChange={(e) => setForm((d) => ({ ...d, reminderTime: e.target.value }))}
                className="w-24"
                aria-label="提醒时间"
              />
            )}
          </div>
        </FieldRow>

        <FieldRow label="节拍密度偏好" description="章节内情节节拍的密度偏好">
          <SimpleSelect
            value={form.beatDensity}
            onValueChange={(v) => setForm((d) => ({ ...d, beatDensity: v as WritingSettings["beatDensity"] }))}
            options={BEAT_DENSITY_OPTIONS}
            aria-label="节拍密度偏好"
          />
        </FieldRow>
      </Section>

      {/* ---- 平台合规 ---- */}
      <Section title="平台合规">
        <FieldRow label="目标平台" description="选择目标发布平台，自动应用对应合规规则">
          <div className="flex flex-wrap gap-2">
            {PLATFORM_LIST.map((platform) => (
              <label key={platform.id} className="flex items-center gap-1 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.targetPlatforms.includes(platform.id)}
                  onChange={() => togglePlatform(platform.id)}
                  className="accent-primary"
                />
                <span className="text-muted-foreground">{platform.label}</span>
              </label>
            ))}
          </div>
        </FieldRow>

        <FieldRow label="分级标准" description="内容分级标准，影响敏感词检测范围">
          <SimpleSelect
            value={form.contentRating}
            onValueChange={(v) => setForm((c) => ({ ...c, contentRating: v as WritingSettings["contentRating"] }))}
            options={RATING_OPTIONS}
            aria-label="分级标准"
          />
        </FieldRow>

        <div className="space-y-1">
          <div>
            <span className="text-sm text-muted-foreground">自定义敏感词</span>
            <p className="text-xs text-muted-foreground/70">额外的自定义敏感词列表，每行一个</p>
          </div>
          <Textarea
            value={form.customSensitiveWords}
            onChange={(e) => setForm((c) => ({ ...c, customSensitiveWords: e.target.value }))}
            placeholder="每行一个敏感词..."
            rows={4}
            aria-label="自定义敏感词"
          />
        </div>
      </Section>

      {/* ---- Sticky bottom bar ---- */}
      {dirty && (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 backdrop-blur px-6 py-3">
          <div className="mx-auto flex max-w-2xl items-center justify-end gap-3">
            <Button variant="ghost" onClick={handleCancel} disabled={saving}>
              取消变更
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "保存中..." : "保存变更"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
