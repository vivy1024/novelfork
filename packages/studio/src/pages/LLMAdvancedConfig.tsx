/**
 * P1-9: LLM 高级参数暴露
 * 编辑 thinkingBudget、apiFormat、extra headers、按 agent 独立配置
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Plus, RefreshCw, RotateCcw, Save, Sliders, Trash2 } from "lucide-react";

import { PageEmptyState } from "@/components/layout/PageEmptyState";
import { fetchJson } from "../hooks/use-api";
import { useColors } from "../hooks/use-colors";
import type { TFunction } from "../hooks/use-i18n";
import type { Theme } from "../hooks/use-theme";

interface Nav {
  toWorkflow?: () => void;
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

export function LLMAdvancedConfig({ nav, theme }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const [form, setForm] = useState<LLMAdvancedForm>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchJson<{ llm?: Partial<LLMAdvancedForm> }>("/project");
      if (data?.llm) {
        setForm({
          thinkingBudget: data.llm.thinkingBudget ?? 0,
          apiFormat: data.llm.apiFormat ?? "chat",
          extra: (data.llm.extra as Record<string, string>) ?? {},
          headers: (data.llm.headers as Record<string, string>) ?? {},
        });
      } else {
        setForm(DEFAULTS);
      }
    } catch {
      // 保持当前表单状态，避免刷新失败时打断工作流。
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

  const kvCount = Object.keys(form.extra).length + Object.keys(form.headers).length;
  const handleReset = () => setForm(DEFAULTS);

  if (loading) return <div className="py-20 text-center text-sm text-muted-foreground">加载中...</div>;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="LLM 高级参数"
        description="在工作流配置台统一调整 thinking budget、API 格式、额外请求参数和自定义 headers。"
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
            <button onClick={handleReset} className={`rounded-md px-3 py-2 text-xs font-medium ${c.btnSecondary} flex items-center gap-1`}>
              <RotateCcw size={12} />恢复默认
            </button>
            <button onClick={handleSave} disabled={saving} className={`rounded-md px-3 py-2 text-xs font-medium ${c.btnPrimary} disabled:opacity-50 flex items-center gap-1`}>
              <Save size={12} />{saving ? "保存中..." : saved ? "已保存" : "保存"}
            </button>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <MiniStat title="Thinking Budget" value={String(form.thinkingBudget)} note="0 = 关闭 extended thinking" />
        <MiniStat title="API Format" value={form.apiFormat} note="chat / responses" />
        <MiniStat title="自定义项" value={String(kvCount)} note="extra + headers 键值组" />
      </div>

      <div className="space-y-6">
        <div>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
            <Sliders size={16} />请求参数
          </h2>
          <div className={`divide-y divide-border/40 rounded-lg border ${c.cardStatic}`}>
            <ConfigRow label="Thinking Budget" hint="Claude extended thinking token 预算（0=关闭）">
              <input
                type="number"
                value={form.thinkingBudget}
                min={0}
                max={100000}
                step={1000}
                onChange={(e) => setForm({ ...form, thinkingBudget: Number(e.target.value) })}
                className={`${c.input} w-28 rounded px-2 py-1 text-right font-mono text-sm`}
              />
            </ConfigRow>
            <ConfigRow label="API Format" hint="chat = Chat Completions，responses = Responses API">
              <select
                value={form.apiFormat}
                onChange={(e) => setForm({ ...form, apiFormat: e.target.value as "chat" | "responses" })}
                className={`${c.input} w-36 rounded px-2 py-1 text-sm`}
              >
                <option value="chat">chat</option>
                <option value="responses">responses</option>
              </select>
            </ConfigRow>
          </div>
        </div>

        <KVSection
          title="Extra 请求参数"
          desc="附加到 LLM 请求体的额外字段。"
          entries={form.extra}
          field="extra"
          c={c}
          onAdd={() => addKV("extra")}
          onUpdate={(ok, nk, v) => updateKV("extra", ok, nk, v)}
          onRemove={(k) => removeKV("extra", k)}
        />

        <KVSection
          title="自定义 Headers"
          desc="附加到 LLM 请求的 HTTP 头。"
          entries={form.headers}
          field="headers"
          c={c}
          onAdd={() => addKV("headers")}
          onUpdate={(ok, nk, v) => updateKV("headers", ok, nk, v)}
          onRemove={(k) => removeKV("headers", k)}
        />
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

function ConfigRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{label}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
      {children}
    </div>
  );
}

function KVSection({
  title,
  desc,
  entries,
  field,
  c,
  onAdd,
  onUpdate,
  onRemove,
}: {
  title: string;
  desc: string;
  entries: Record<string, string>;
  field: string;
  c: ReturnType<typeof useColors>;
  onAdd: () => void;
  onUpdate: (oldKey: string, newKey: string, value: string) => void;
  onRemove: (key: string) => void;
}) {
  const pairs = Object.entries(entries);
  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">{title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
        </div>
        <button onClick={onAdd} className={`rounded-md px-2 py-1 text-xs font-medium ${c.btnSecondary} flex items-center gap-1`}>
          <Plus size={12} />添加
        </button>
      </div>
      <div className={`rounded-lg border ${c.cardStatic}`}>
        {pairs.length === 0 ? (
          <PageEmptyState
            title={`暂无${title}`}
            description={desc}
            action={
              <button onClick={onAdd} className={`rounded-md px-3 py-2 text-sm font-medium ${c.btnPrimary}`}>
                添加第一项
              </button>
            }
          />
        ) : (
          <div className="divide-y divide-border/40">
            {pairs.map(([key, value], i) => (
              <div key={`${field}-${i}`} className="flex items-center gap-2 px-4 py-2">
                <input
                  type="text"
                  value={key}
                  placeholder="key"
                  onChange={(e) => onUpdate(key, e.target.value, value)}
                  className={`${c.input} w-40 rounded px-2 py-1 font-mono text-sm`}
                />
                <span className="text-muted-foreground">=</span>
                <input
                  type="text"
                  value={value}
                  placeholder="value"
                  onChange={(e) => onUpdate(key, key, e.target.value)}
                  className={`${c.input} flex-1 rounded px-2 py-1 font-mono text-sm`}
                />
                <button onClick={() => onRemove(key)} className="rounded p-1 text-red-500 hover:bg-red-500/10">
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
