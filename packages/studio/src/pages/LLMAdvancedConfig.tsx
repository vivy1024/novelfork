/**
 * P1-9: LLM 高级参数暴露
 * 编辑 thinkingBudget、apiFormat、extra headers、按 agent 独立配置
 */
import { useState, useEffect } from "react";
import { fetchJson } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import { Sliders, Save, RotateCcw, Plus, Trash2 } from "lucide-react";

interface Nav {
  toDashboard: () => void;
  toConfig: () => void;
}

interface LLMAdvancedForm {
  thinkingBudget: number;
  apiFormat: "chat" | "responses";
  extra: Record<string, string>;
  headers: Record<string, string>;
}

const DEFAULTS: LLMAdvancedForm = {
  thinkingBudget: 0,
  apiFormat: "chat",
  extra: {},
  headers: {},
};

export function LLMAdvancedConfig({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const [form, setForm] = useState<LLMAdvancedForm>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetchJson<{ llm?: Partial<LLMAdvancedForm> }>("/project")
      .then((data) => {
        if (data?.llm) {
          setForm({
            thinkingBudget: data.llm.thinkingBudget ?? 0,
            apiFormat: data.llm.apiFormat ?? "chat",
            extra: (data.llm.extra as Record<string, string>) ?? {},
            headers: (data.llm.headers as Record<string, string>) ?? {},
          });
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
        body: JSON.stringify({
          llm: {
            thinkingBudget: form.thinkingBudget,
            apiFormat: form.apiFormat,
            extra: Object.keys(form.extra).length > 0 ? form.extra : undefined,
            headers: Object.keys(form.headers).length > 0 ? form.headers : undefined,
          },
        }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      alert(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const addKV = (field: "extra" | "headers") => {
    setForm({ ...form, [field]: { ...form[field], "": "" } });
  };

  const updateKV = (field: "extra" | "headers", oldKey: string, newKey: string, value: string) => {
    const entries = Object.entries(form[field]).map(([k, v]) =>
      k === oldKey ? [newKey, value] : [k, v],
    );
    setForm({ ...form, [field]: Object.fromEntries(entries) });
  };

  const removeKV = (field: "extra" | "headers", key: string) => {
    const copy = { ...form[field] };
    delete copy[key];
    setForm({ ...form, [field]: copy });
  };

  if (loading) return <div className="text-muted-foreground py-20 text-center text-sm">Loading...</div>;

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>首页</button>
        <span className="text-border">/</span>
        <button onClick={nav.toConfig} className={c.link}>配置</button>
        <span className="text-border">/</span>
        <span className="text-foreground">LLM 高级参数</span>
      </div>

      <div className="flex items-baseline justify-between">
        <h1 className="font-serif text-3xl">LLM 高级参数</h1>
        <div className="flex gap-2">
          <button onClick={() => setForm(DEFAULTS)} className={`px-3 py-2 text-xs rounded-md ${c.btnSecondary} flex items-center gap-1`}>
            <RotateCcw size={12} />恢复默认
          </button>
          <button onClick={handleSave} disabled={saving} className={`px-3 py-2 text-xs rounded-md ${c.btnPrimary} disabled:opacity-50 flex items-center gap-1`}>
            <Save size={12} />{saving ? "保存中..." : saved ? "已保存" : "保存"}
          </button>
        </div>
      </div>

      {/* 基础高级参数 */}
      <div>
        <h2 className="text-sm uppercase tracking-wide text-muted-foreground font-medium flex items-center gap-2 mb-3">
          <Sliders size={16} />请求参数
        </h2>
        <div className={`border ${c.cardStatic} rounded-lg divide-y divide-border/40`}>
          <div className="flex justify-between items-center px-4 py-2.5">
            <div>
              <span className="text-sm">Thinking Budget</span>
              <span className="text-xs text-muted-foreground ml-2">Claude extended thinking token 预算（0=关闭）</span>
            </div>
            <input type="number" value={form.thinkingBudget} min={0} max={100000} step={1000}
              onChange={(e) => setForm({ ...form, thinkingBudget: Number(e.target.value) })}
              className={`${c.input} rounded px-2 py-1 text-sm w-28 text-right font-mono`} />
          </div>
          <div className="flex justify-between items-center px-4 py-2.5">
            <div>
              <span className="text-sm">API Format</span>
              <span className="text-xs text-muted-foreground ml-2">chat = Chat Completions, responses = Responses API</span>
            </div>
            <select value={form.apiFormat} onChange={(e) => setForm({ ...form, apiFormat: e.target.value as "chat" | "responses" })}
              className={`${c.input} rounded px-2 py-1 text-sm w-36`}>
              <option value="chat">chat</option>
              <option value="responses">responses</option>
            </select>
          </div>
        </div>
      </div>

      {/* Extra 参数 */}
      <KVSection title="Extra 请求参数" desc="附加到 LLM 请求体的额外字段"
        entries={form.extra} field="extra" c={c}
        onAdd={() => addKV("extra")} onUpdate={(ok, nk, v) => updateKV("extra", ok, nk, v)} onRemove={(k) => removeKV("extra", k)} />

      {/* 自定义 Headers */}
      <KVSection title="自定义 Headers" desc="附加到 LLM 请求的 HTTP 头"
        entries={form.headers} field="headers" c={c}
        onAdd={() => addKV("headers")} onUpdate={(ok, nk, v) => updateKV("headers", ok, nk, v)} onRemove={(k) => removeKV("headers", k)} />
    </div>
  );
}

function KVSection({ title, desc, entries, field, c, onAdd, onUpdate, onRemove }: {
  title: string; desc: string; entries: Record<string, string>; field: string;
  c: ReturnType<typeof useColors>;
  onAdd: () => void;
  onUpdate: (oldKey: string, newKey: string, value: string) => void;
  onRemove: (key: string) => void;
}) {
  const pairs = Object.entries(entries);
  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-sm uppercase tracking-wide text-muted-foreground font-medium">{title}</h2>
        <button onClick={onAdd} className={`px-2 py-1 text-xs rounded-md ${c.btnSecondary} flex items-center gap-1`}>
          <Plus size={12} />添加
        </button>
      </div>
      <div className={`border ${c.cardStatic} rounded-lg`}>
        {pairs.length === 0 ? (
          <div className="text-muted-foreground text-sm py-6 text-center">{desc}</div>
        ) : (
          <div className="divide-y divide-border/40">
            {pairs.map(([key, value], i) => (
              <div key={`${field}-${i}`} className="flex items-center gap-2 px-4 py-2">
                <input type="text" value={key} placeholder="key"
                  onChange={(e) => onUpdate(key, e.target.value, value)}
                  className={`${c.input} rounded px-2 py-1 text-sm w-40 font-mono`} />
                <span className="text-muted-foreground">=</span>
                <input type="text" value={value} placeholder="value"
                  onChange={(e) => onUpdate(key, key, e.target.value)}
                  className={`${c.input} rounded px-2 py-1 text-sm flex-1 font-mono`} />
                <button onClick={() => onRemove(key)} className="p-1 text-red-500 hover:bg-red-500/10 rounded">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}