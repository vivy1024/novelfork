/**
 * P1-7: AIGC 检测配置 (DetectionConfig)
 * 配置外部 AIGC 检测提供商（GPTZero / Originality / 自定义）
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { RefreshCw, RotateCcw, Save, ShieldCheck } from "lucide-react";

import { fetchJson } from "../hooks/use-api";
import { useColors } from "../hooks/use-colors";
import type { TFunction } from "../hooks/use-i18n";
import type { Theme } from "../hooks/use-theme";

interface Nav {
  toWorkflow?: () => void;
}

interface DetectionForm {
  provider: "gptzero" | "originality" | "custom";
  apiUrl: string;
  apiKeyEnv: string;
  threshold: number;
  enabled: boolean;
  autoRewrite: boolean;
  maxRetries: number;
}

const DEFAULTS: DetectionForm = {
  provider: "custom",
  apiUrl: "",
  apiKeyEnv: "",
  threshold: 0.5,
  enabled: false,
  autoRewrite: false,
  maxRetries: 3,
};

const PROVIDERS = [
  { value: "gptzero", label: "GPTZero" },
  { value: "originality", label: "Originality.ai" },
  { value: "custom", label: "自定义" },
] as const;

export function DetectionConfigView({ nav, theme }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const [form, setForm] = useState<DetectionForm>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchJson<{ detection?: DetectionForm }>("/project");
      if (data?.detection) {
        setForm({ ...DEFAULTS, ...data.detection });
      } else {
        setForm(DEFAULTS);
      }
    } catch {
      // 刷新失败时保留当前输入，避免覆盖工作流里的临时修改。
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await fetchJson("/project", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ detection: form }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      alert(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="py-20 text-center text-sm text-muted-foreground">加载中...</div>;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="AIGC 检测配置"
        description="在工作流配置台统一设置检测提供商、阈值和自动改写策略。"
        actions={
          <>
            {nav.toWorkflow && (
              <button onClick={() => nav.toWorkflow?.()} className="rounded-md border border-border/70 bg-background/70 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted/70">
                工作流总览
              </button>
            )}
            <button onClick={() => void loadConfig()} className={`rounded-md px-3 py-2 text-xs font-medium ${c.btnSecondary} flex items-center gap-1`}>
              <RefreshCw size={12} />刷新
            </button>
            <button onClick={() => setForm(DEFAULTS)} className={`rounded-md px-3 py-2 text-xs font-medium ${c.btnSecondary} flex items-center gap-1`}>
              <RotateCcw size={12} />恢复默认
            </button>
            <button onClick={handleSave} disabled={saving} className={`rounded-md px-3 py-2 text-xs font-medium ${c.btnPrimary} disabled:opacity-50 flex items-center gap-1`}>
              <Save size={12} />{saving ? "保存中..." : saved ? "已保存" : "保存"}
            </button>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <MiniStat title="启用状态" value={form.enabled ? "已启用" : "未启用"} note="总开关控制检测流程" />
        <MiniStat title="检测阈值" value={form.threshold.toFixed(2)} note="0 ~ 1 的置信度阈值" />
        <MiniStat title="最大重试" value={String(form.maxRetries)} note="失败后的自动重试次数" />
      </div>

      <div className={`divide-y divide-border/40 rounded-lg border ${c.cardStatic} ${!form.enabled ? "opacity-50 pointer-events-none" : ""}`}>
        <ConfigRow label="检测提供商">
          <select
            value={form.provider}
            onChange={(e) => setForm({ ...form, provider: e.target.value as DetectionForm["provider"] })}
            className={`${c.input} w-48 rounded px-2 py-1 text-sm`}
          >
            {PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </ConfigRow>
        <ConfigRow label="API URL">
          <input
            type="text"
            value={form.apiUrl}
            onChange={(e) => setForm({ ...form, apiUrl: e.target.value })}
            placeholder="https://api.gptzero.me/v2/predict"
            className={`${c.input} w-80 rounded px-2 py-1 font-mono text-sm`}
          />
        </ConfigRow>
        <ConfigRow label="API Key 环境变量名">
          <input
            type="text"
            value={form.apiKeyEnv}
            onChange={(e) => setForm({ ...form, apiKeyEnv: e.target.value })}
            placeholder="GPTZERO_API_KEY"
            className={`${c.input} w-56 rounded px-2 py-1 font-mono text-sm`}
          />
        </ConfigRow>
        <ConfigRow label="阈值 (0-1)">
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={form.threshold}
              onChange={(e) => setForm({ ...form, threshold: Number(e.target.value) })}
              className="w-32"
            />
            <span className="w-10 text-right font-mono text-sm">{form.threshold.toFixed(2)}</span>
          </div>
        </ConfigRow>
        <ConfigRow label="最大重试次数">
          <input
            type="number"
            value={form.maxRetries}
            min={1}
            max={10}
            onChange={(e) => setForm({ ...form, maxRetries: Number(e.target.value) })}
            className={`${c.input} w-20 rounded px-2 py-1 text-right font-mono text-sm`}
          />
        </ConfigRow>
        <ConfigRow label="自动改写">
          <button
            onClick={() => setForm({ ...form, autoRewrite: !form.autoRewrite })}
            className={`relative h-5 w-10 rounded-full transition-colors ${form.autoRewrite ? "bg-primary" : "bg-muted"}`}
          >
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${form.autoRewrite ? "translate-x-5" : "translate-x-0.5"}`} />
          </button>
        </ConfigRow>
      </div>
    </div>
  );
}

function SectionHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur-sm lg:flex-row lg:items-start lg:justify-between">
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">Workflow Workbench</p>
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

function MiniStat({ title, value, note }: { title: string; value: string; note: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/70 p-4 shadow-sm">
      <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{title}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{value}</div>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{note}</p>
    </div>
  );
}

function ConfigRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
