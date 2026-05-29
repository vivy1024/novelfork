/**
 * AgentRuntimeHardeningPanel — Agent 运行时加固设置
 *
 * 包含：
 * - YOLO 模式开关
 * - 安全反思开关（仅 YOLO 开启时可见）
 * - 循环检测灵敏度
 * - Token 消耗警告阈值
 * - 最大连续失败次数
 */

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { fetchJson, putApi } from "@/hooks/use-api";
import { USER_SETTINGS_API_PATH } from "@/app-next/backend-contract";
import type { RuntimeControlSettings, UserConfig } from "@/types/settings";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function parseNum(raw: string, fallback: number, min: number, max: number) {
  if (raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? clamp(n, min, max) : fallback;
}

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      <div className="space-y-3 rounded-lg border border-border p-4">{children}</div>
    </div>
  );
}

function FieldRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <span className="text-sm">{label}</span>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subset of RuntimeControlSettings relevant to this panel
// ---------------------------------------------------------------------------

interface HardeningConfig {
  yoloMode: boolean;
  safetyReflection: boolean;
  loopDetectionThreshold: number;
  tokenConsumptionWarnRatio: number;
  maxConsecutiveFailures: number;
}

const DEFAULTS: HardeningConfig = {
  yoloMode: false,
  safetyReflection: true,
  loopDetectionThreshold: 60,
  tokenConsumptionWarnRatio: 80,
  maxConsecutiveFailures: 5,
};

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function AgentRuntimeHardeningPanel() {
  const [config, setConfig] = useState<HardeningConfig | null>(null);
  const savedRef = useRef<HardeningConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchJson<UserConfig>(USER_SETTINGS_API_PATH)
      .then((data) => {
        if (cancelled) return;
        const rc = data.runtimeControls ?? {} as Partial<RuntimeControlSettings>;
        const hardening: HardeningConfig = {
          yoloMode: rc.yoloMode ?? DEFAULTS.yoloMode,
          safetyReflection: rc.safetyReflection ?? DEFAULTS.safetyReflection,
          loopDetectionThreshold: rc.loopDetectionThreshold ?? DEFAULTS.loopDetectionThreshold,
          tokenConsumptionWarnRatio: rc.tokenConsumptionWarnRatio ?? DEFAULTS.tokenConsumptionWarnRatio,
          maxConsecutiveFailures: rc.maxConsecutiveFailures ?? DEFAULTS.maxConsecutiveFailures,
        };
        setConfig(hardening);
        savedRef.current = { ...hardening };
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const isDirty = config && savedRef.current && JSON.stringify(config) !== JSON.stringify(savedRef.current);

  async function handleSave() {
    if (!config) return;
    setSaving(true);
    setError(null);
    try {
      await putApi<UserConfig>(USER_SETTINGS_API_PATH, {
        runtimeControls: {
          yoloMode: config.yoloMode,
          safetyReflection: config.safetyReflection,
          loopDetectionThreshold: config.loopDetectionThreshold,
          tokenConsumptionWarnRatio: config.tokenConsumptionWarnRatio,
          maxConsecutiveFailures: config.maxConsecutiveFailures,
        },
      });
      savedRef.current = { ...config };
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function patch(partial: Partial<HardeningConfig>) {
    setConfig((c) => c ? { ...c, ...partial } : c);
  }

  if (loading) return <p className="py-8 text-center text-sm text-muted-foreground">正在读取 Agent 运行时加固配置…</p>;
  if (!config) return <p className="py-8 text-center text-sm text-destructive">加载失败：{error}</p>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1 text-foreground">Agent 运行时</h2>
        <p className="text-sm text-muted-foreground">运行时加固：YOLO 模式、循环检测、Token 消耗监控和连续失败保护。</p>
      </div>

      {/* ── YOLO 模式 ── */}
      <Section title="YOLO 模式" description="全部允许模式下跳过所有确认，适合信任度高的场景。">
        <FieldRow label="YOLO 模式" description="开启后 Agent 将跳过所有工具执行确认">
          <Switch
            checked={config.yoloMode}
            onCheckedChange={(v) => patch({ yoloMode: v })}
            aria-label="YOLO 模式"
          />
        </FieldRow>
        {config.yoloMode && (
          <FieldRow label="安全反思" description="即使在 YOLO 模式下，仍对高风险操作进行二次反思确认">
            <Switch
              checked={config.safetyReflection}
              onCheckedChange={(v) => patch({ safetyReflection: v })}
              aria-label="安全反思"
            />
          </FieldRow>
        )}
      </Section>

      {/* ── 健康监控 ── */}
      <Section title="健康监控" description="配置运行时健康检测的灵敏度和阈值。">
        <FieldRow label="循环检测灵敏度" description="检测 Agent 陷入重复循环的灵敏度（0-100%，越高越敏感）">
          <div className="flex items-center gap-2">
            <Input
              type="number"
              className="w-20"
              min={0}
              max={100}
              value={config.loopDetectionThreshold}
              onChange={(e) => patch({ loopDetectionThreshold: parseNum(e.target.value, DEFAULTS.loopDetectionThreshold, 0, 100) })}
              aria-label="循环检测灵敏度"
            />
            <span className="text-xs text-muted-foreground">%</span>
          </div>
        </FieldRow>
        <Separator />
        <FieldRow label="Token 消耗警告阈值" description="单轮对话 Token 消耗达到上下文窗口此比例时发出警告（0-100%）">
          <div className="flex items-center gap-2">
            <Input
              type="number"
              className="w-20"
              min={0}
              max={100}
              value={config.tokenConsumptionWarnRatio}
              onChange={(e) => patch({ tokenConsumptionWarnRatio: parseNum(e.target.value, DEFAULTS.tokenConsumptionWarnRatio, 0, 100) })}
              aria-label="Token 消耗警告阈值"
            />
            <span className="text-xs text-muted-foreground">%</span>
          </div>
        </FieldRow>
        <Separator />
        <FieldRow label="最大连续失败次数" description="Agent 连续失败达到此次数时自动暂停（1-20）">
          <Input
            type="number"
            className="w-20"
            min={1}
            max={20}
            value={config.maxConsecutiveFailures}
            onChange={(e) => patch({ maxConsecutiveFailures: parseNum(e.target.value, DEFAULTS.maxConsecutiveFailures, 1, 20) })}
            aria-label="最大连续失败次数"
          />
        </FieldRow>
      </Section>

      {/* ── Error ── */}
      {error && <p className="text-sm text-destructive">错误：{error}</p>}

      {/* ── Dirty bar ── */}
      {isDirty && (
        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border bg-background px-4 py-3 -mx-4">
          <Button variant="outline" size="sm" onClick={() => { setConfig(savedRef.current ? { ...savedRef.current } : null); }}>取消变更</Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? "保存中..." : "保存变更"}
          </Button>
        </div>
      )}
    </div>
  );
}
