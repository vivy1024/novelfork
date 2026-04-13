/**
 * P1-7: AIGC 检测配置 (DetectionConfig)
 * 配置外部 AIGC 检测提供商（GPTZero / Originality / 自定义）
 */
import { useState, useEffect } from "react";
import { fetchJson } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import { ShieldCheck, Save, RotateCcw } from "lucide-react";

interface Nav {
  toDashboard: () => void;
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

export function DetectionConfigView({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const [form, setForm] = useState<DetectionForm>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetchJson<{ detection?: DetectionForm }>("/project")
      .then((data) => {
        if (data?.detection) {
          setForm({ ...DEFAULTS, ...data.detection });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

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

  if (loading) return <div className="text-muted-foreground py-20 text-center text-sm">Loading...</div>;

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>首页</button>
        <span className="text-border">/</span>
        <span className="text-foreground">AIGC 检测配置</span>
      </div>

      <div className="flex items-baseline justify-between">
        <h1 className="font-serif text-3xl">AIGC 检测配置</h1>
        <div className="flex gap-2">
          <button onClick={() => setForm(DEFAULTS)} className={`px-3 py-2 text-xs rounded-md ${c.btnSecondary} flex items-center gap-1`}>
            <RotateCcw size={12} />恢复默认
          </button>
          <button onClick={handleSave} disabled={saving} className={`px-3 py-2 text-xs rounded-md ${c.btnPrimary} disabled:opacity-50 flex items-center gap-1`}>
            <Save size={12} />{saving ? "保存中..." : saved ? "已保存" : "保存"}
          </button>
        </div>
      </div>

      {/* 启用开关 */}
      <div className={`border ${c.cardStatic} rounded-lg`}>
        <div className="flex justify-between items-center px-4 py-3">
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className={form.enabled ? "text-primary" : "text-muted-foreground"} />
            <span className="text-sm font-medium">启用 AIGC 检测</span>
          </div>
          <button
            onClick={() => setForm({ ...form, enabled: !form.enabled })}
            className={`w-10 h-5 rounded-full transition-colors relative ${form.enabled ? "bg-primary" : "bg-muted"}`}
          >
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.enabled ? "translate-x-5" : "translate-x-0.5"}`} />
          </button>
        </div>
      </div>

      {/* 配置表单 */}
      <div className={`border ${c.cardStatic} rounded-lg divide-y divide-border/40 ${!form.enabled ? "opacity-50 pointer-events-none" : ""}`}>
        <div className="flex justify-between items-center px-4 py-2.5">
          <span className="text-muted-foreground text-sm">检测提供商</span>
          <select value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value as DetectionForm["provider"] })}
            className={`${c.input} rounded px-2 py-1 text-sm w-48`}>
            {PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
        <div className="flex justify-between items-center px-4 py-2.5">
          <span className="text-muted-foreground text-sm">API URL</span>
          <input type="text" value={form.apiUrl} onChange={(e) => setForm({ ...form, apiUrl: e.target.value })}
            placeholder="https://api.gptzero.me/v2/predict" className={`${c.input} rounded px-2 py-1 text-sm w-64 font-mono`} />
        </div>
        <div className="flex justify-between items-center px-4 py-2.5">
          <span className="text-muted-foreground text-sm">API Key 环境变量名</span>
          <input type="text" value={form.apiKeyEnv} onChange={(e) => setForm({ ...form, apiKeyEnv: e.target.value })}
            placeholder="GPTZERO_API_KEY" className={`${c.input} rounded px-2 py-1 text-sm w-48 font-mono`} />
        </div>
        <div className="flex justify-between items-center px-4 py-2.5">
          <span className="text-muted-foreground text-sm">阈值 (0-1)</span>
          <div className="flex items-center gap-2">
            <input type="range" min={0} max={1} step={0.05} value={form.threshold}
              onChange={(e) => setForm({ ...form, threshold: Number(e.target.value) })} className="w-32" />
            <span className="font-mono text-sm w-10 text-right">{form.threshold.toFixed(2)}</span>
          </div>
        </div>
        <div className="flex justify-between items-center px-4 py-2.5">
          <span className="text-muted-foreground text-sm">最大重试次数</span>
          <input type="number" value={form.maxRetries} min={1} max={10}
            onChange={(e) => setForm({ ...form, maxRetries: Number(e.target.value) })}
            className={`${c.input} rounded px-2 py-1 text-sm w-20 text-right font-mono`} />
        </div>
        <div className="flex justify-between items-center px-4 py-2.5">
          <div>
            <span className="text-muted-foreground text-sm">自动改写</span>
            <span className="text-xs text-muted-foreground/60 ml-2">检测不通过时自动触发 anti-detect 修订</span>
          </div>
          <button
            onClick={() => setForm({ ...form, autoRewrite: !form.autoRewrite })}
            className={`w-10 h-5 rounded-full transition-colors relative ${form.autoRewrite ? "bg-primary" : "bg-muted"}`}
          >
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.autoRewrite ? "translate-x-5" : "translate-x-0.5"}`} />
          </button>
        </div>
      </div>
    </div>
  );
}
