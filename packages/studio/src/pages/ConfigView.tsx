import { fetchJson, putApi, useApi } from "../hooks/use-api";
import { useEffect, useState, useCallback } from "react";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import { useInkOS } from "../providers/inkos-context";
import { FolderOpen, Plus, Trash2, Check, Zap, Pencil } from "lucide-react";

const ROUTING_AGENTS = [
  "writer",
  "auditor",
  "reviser",
  "architect",
  "radar",
  "chapter-analyzer",
] as const;

interface AgentOverride {
  readonly model: string;
  readonly provider: string;
  readonly baseUrl: string;
}

type OverridesMap = Record<string, AgentOverride>;

interface ProjectInfo {
  readonly name: string;
  readonly language: string;
  readonly model: string;
  readonly provider: string;
  readonly baseUrl: string;
  readonly stream: boolean;
  readonly temperature: number;
  readonly maxTokens: number;
}

interface Nav {
  toDashboard: () => void;
}

interface SaveProjectConfigOptions {
  readonly putApiImpl?: typeof putApi;
}

export async function saveProjectConfig(
  form: Record<string, unknown>,
  options: SaveProjectConfigOptions = {},
): Promise<void> {
  const putApiImpl = options.putApiImpl ?? putApi;
  await putApiImpl("/project", form);
}

export function normalizeOverridesDraft(
  data?: { readonly overrides?: OverridesMap } | null,
): OverridesMap {
  return Object.fromEntries(
    Object.entries(data?.overrides ?? {}).map(([agent, override]) => [
      agent,
      { ...override },
    ]),
  ) as OverridesMap;
}

export function ConfigView({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { mode, workspace, selectWorkspace } = useInkOS();
  const isTauri = mode === "tauri";
  const isStandalone = mode === "standalone";
  const { data, loading, error, refetch } = useApi<ProjectInfo>(isTauri ? null : "/project");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Record<string, unknown>>({});

  if (!isTauri && loading) return <div className="text-muted-foreground py-20 text-center text-sm">Loading...</div>;
  if (!isTauri && error) return <div className="text-destructive py-20 text-center">Error: {error}</div>;
  if (!isTauri && !data) return null;

  const startEdit = () => {
    if (!data) return;
    setForm({
      temperature: data.temperature,
      maxTokens: data.maxTokens,
      stream: data.stream,
      language: data.language,
    });
    setEditing(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveProjectConfig(form);
      setEditing(false);
      refetch();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto space-y-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.home")}</button>
        <span className="text-border">/</span>
        <span className="text-foreground">{t("bread.config")}</span>
      </div>

      <div className="flex items-baseline justify-between">
        <h1 className="font-serif text-3xl">{t("config.title")}</h1>
        {isStandalone && !editing && (
          <button onClick={startEdit} className={`px-3 py-2 text-xs rounded-md ${c.btnSecondary}`}>
            Edit
          </button>
        )}
      </div>

      {/* Tauri workspace info */}
      {isTauri && (
        <TauriWorkspaceSection workspace={workspace} selectWorkspace={selectWorkspace} theme={theme} t={t} />
      )}

      {/* Project config (web modes only) */}
      {!isTauri && data && (
        <>
          <div className={`border ${c.cardStatic} rounded-lg divide-y divide-border/40`}>
            <Row label={t("config.project")} value={data.name} />
            <Row label={t("config.provider")} value={data.provider} />
            <Row label={t("config.model")} value={data.model} />
            <Row label={t("config.baseUrl")} value={data.baseUrl} mono />

            {editing ? (
              <>
                <EditRow
                  label={t("config.language")}
                  value={form.language as string}
                  onChange={(v) => setForm({ ...form, language: v })}
                  type="select"
                  options={[{ value: "zh", label: t("config.chinese") }, { value: "en", label: t("config.english") }]}
                  c={c}
                />
                <EditRow
                  label={t("config.temperature")}
                  value={String(form.temperature)}
                  onChange={(v) => setForm({ ...form, temperature: parseFloat(v) })}
                  type="number"
                  c={c}
                />
                <EditRow
                  label={t("config.maxTokens")}
                  value={String(form.maxTokens)}
                  onChange={(v) => setForm({ ...form, maxTokens: parseInt(v, 10) })}
                  type="number"
                  c={c}
                />
                <EditRow
                  label={t("config.stream")}
                  value={String(form.stream)}
                  onChange={(v) => setForm({ ...form, stream: v === "true" })}
                  type="select"
                  options={[{ value: "true", label: t("config.enabled") }, { value: "false", label: t("config.disabled") }]}
                  c={c}
                />
              </>
            ) : (
              <>
                <Row label={t("config.language")} value={data.language === "en" ? t("config.english") : t("config.chinese")} />
                <Row label={t("config.temperature")} value={String(data.temperature)} mono />
                <Row label={t("config.maxTokens")} value={String(data.maxTokens)} mono />
                <Row label={t("config.stream")} value={data.stream ? t("config.enabled") : t("config.disabled")} />
              </>
            )}
          </div>

          {editing && (
            <div className="flex gap-2 justify-end">
              <button onClick={() => setEditing(false)} className={`px-4 py-2.5 text-sm rounded-md ${c.btnSecondary}`}>
                {t("config.cancel")}
              </button>
              <button onClick={handleSave} disabled={saving} className={`px-4 py-2.5 text-sm rounded-md ${c.btnPrimary} disabled:opacity-50`}>
                {saving ? t("config.saving") : t("config.save")}
              </button>
            </div>
          )}
        </>
      )}

      {/* LLM settings — Tauri reads from localStorage, web from server */}
      {isTauri ? (
        <TauriLlmSettings theme={theme} t={t} />
      ) : (
        <MyLlmSettings theme={theme} t={t} />
      )}

      {/* Model routing — standalone only */}
      {isStandalone && <ModelRoutingSection theme={theme} t={t} />}
    </div>
  );
}

function emptyOverride(): AgentOverride {
  return { model: "", provider: "", baseUrl: "" };
}

function TauriWorkspaceSection({ workspace, selectWorkspace, theme, t }: {
  workspace?: string | null;
  selectWorkspace?: () => Promise<string | null>;
  theme: Theme;
  t: TFunction;
}) {
  const c = useColors(theme);
  const [switching, setSwitching] = useState(false);

  const handleSwitch = async () => {
    if (!selectWorkspace) return;
    setSwitching(true);
    try {
      await selectWorkspace();
      window.location.reload();
    } catch {
      // user cancelled
    } finally {
      setSwitching(false);
    }
  };

  return (
    <>
      <h2 className="font-serif text-xl">{t("config.workspace")}</h2>
      <div className={`border ${c.cardStatic} rounded-lg divide-y divide-border/40`}>
        <div className="flex justify-between items-center px-4 py-3">
          <span className="text-muted-foreground text-sm flex items-center gap-2">
            <FolderOpen size={14} />
            {t("config.workspacePath")}
          </span>
          <span className="font-mono text-sm truncate max-w-[280px]" title={workspace ?? ""}>
            {workspace ?? "未选择"}
          </span>
        </div>
      </div>
      {selectWorkspace && (
        <div className="flex justify-end">
          <button
            onClick={handleSwitch}
            disabled={switching}
            className={`px-4 py-2.5 text-sm rounded-md ${c.btnSecondary} disabled:opacity-50`}
          >
            {switching ? "切换中..." : t("config.switchWorkspace")}
          </button>
        </div>
      )}
    </>
  );
}

type LLMProvider = "openai" | "anthropic" | "ollama" | "custom";

interface LLMProfileView {
  readonly name: string;
  readonly provider: LLMProvider;
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
}

const PROVIDER_PRESETS: Record<LLMProvider, { label: string; placeholder: string; defaultModel: string }> = {
  openai: { label: "OpenAI 兼容", placeholder: "https://api.openai.com/v1", defaultModel: "gpt-4o" },
  anthropic: { label: "Anthropic", placeholder: "https://api.anthropic.com", defaultModel: "claude-sonnet-4-20250514" },
  ollama: { label: "Ollama 本地", placeholder: "http://localhost:11434", defaultModel: "llama3" },
  custom: { label: "自定义", placeholder: "https://your-api.com/v1", defaultModel: "gpt-4o" },
};

function TauriLlmSettings({ theme, t }: { theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const [profiles, setProfiles] = useState<LLMProfileView[]>([]);
  const [active, setActive] = useState("");
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<LLMProfileView>({
    name: "", provider: "openai", apiKey: "", baseUrl: "", model: "gpt-4o",
  });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchJson<{ profiles: LLMProfileView[]; active: string }>("/llm/profiles");
      setProfiles(data.profiles);
      setActive(data.active);
    } catch { /* no profiles yet */ }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleActivate = async (name: string) => {
    await fetchJson("/llm/active", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setActive(name);
    setTestResult(null);
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`删除配置「${name}」？`)) return;
    await fetchJson(`/llm/profiles/${encodeURIComponent(name)}`, { method: "DELETE" });
    await refresh();
    setTestResult(null);
  };

  const startAdd = () => {
    setForm({ name: "", provider: "openai", apiKey: "", baseUrl: "", model: "gpt-4o" });
    setAdding(true);
    setEditingIdx(null);
    setTestResult(null);
  };

  const startEdit = (idx: number) => {
    const p = profiles[idx];
    setForm({ ...p, apiKey: "" }); // don't prefill masked key
    setEditingIdx(idx);
    setAdding(false);
    setTestResult(null);
  };

  const handleSave = async () => {
    try {
      if (adding) {
        await fetchJson("/llm/profiles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
      } else if (editingIdx !== null) {
        const oldName = profiles[editingIdx].name;
        await fetchJson(`/llm/profiles/${encodeURIComponent(oldName)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
      }
      setAdding(false);
      setEditingIdx(null);
      await refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "保存失败");
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetchJson<{ ok: boolean; reply?: string; error?: string }>("/llm/test", { method: "POST" });
      setTestResult(res.ok ? { ok: true, msg: res.reply ?? "OK" } : { ok: false, msg: res.error ?? "失败" });
    } catch (e) {
      setTestResult({ ok: false, msg: e instanceof Error ? e.message : "测试失败" });
    } finally {
      setTesting(false);
    }
  };

  const isEditing = adding || editingIdx !== null;
  const preset = PROVIDER_PRESETS[form.provider] ?? PROVIDER_PRESETS.openai;

  return (
    <>
      <div className="flex items-baseline justify-between">
        <h2 className="font-serif text-xl mt-4">LLM 配置</h2>
        <div className="flex gap-2">
          {!isEditing && (
            <button onClick={handleTest} disabled={testing || profiles.length === 0}
              className={`px-3 py-2 text-xs rounded-md ${c.btnSecondary} disabled:opacity-50 flex items-center gap-1`}>
              <Zap size={12} />{testing ? "测试中..." : "测试连接"}
            </button>
          )}
          {!isEditing && (
            <button onClick={startAdd} className={`px-3 py-2 text-xs rounded-md ${c.btnPrimary} flex items-center gap-1`}>
              <Plus size={12} />新增配置
            </button>
          )}
        </div>
      </div>

      {testResult && (
        <div className={`text-sm px-3 py-2 rounded-md ${testResult.ok ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"}`}>
          {testResult.ok ? `连接成功: ${testResult.msg}` : `连接失败: ${testResult.msg}`}
        </div>
      )}

      {/* 配置列表 */}
      {!isEditing && profiles.length === 0 && (
        <div className="text-muted-foreground text-sm py-8 text-center">
          尚未添加 LLM 配置，点击「新增配置」开始
        </div>
      )}

      {!isEditing && profiles.map((p, i) => (
        <div key={p.name} className={`border rounded-lg ${p.name === active ? "border-primary/50 ring-1 ring-primary/20" : "border-border"} ${c.cardStatic}`}>
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2">
              {p.name === active && <Check size={14} className="text-primary" />}
              <span className={`font-medium text-sm ${p.name === active ? "text-primary" : ""}`}>{p.name}</span>
              <span className="text-xs text-muted-foreground px-1.5 py-0.5 rounded bg-muted">
                {PROVIDER_PRESETS[p.provider]?.label ?? p.provider}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {p.name !== active && (
                <button onClick={() => handleActivate(p.name)} title="激活"
                  className={`p-1.5 rounded-md text-xs ${c.btnSecondary}`}>
                  <Check size={12} />
                </button>
              )}
              <button onClick={() => startEdit(i)} title="编辑"
                className={`p-1.5 rounded-md text-xs ${c.btnSecondary}`}>
                <Pencil size={12} />
              </button>
              <button onClick={() => handleDelete(p.name)} title="删除"
                className="p-1.5 rounded-md text-xs text-red-500 hover:bg-red-500/10">
                <Trash2 size={12} />
              </button>
            </div>
          </div>
          <div className="border-t border-border/40 px-4 py-2 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
            <div>模型: <span className="text-foreground">{p.model}</span></div>
            <div>Base URL: <span className="font-mono text-foreground">{p.baseUrl || "(默认)"}</span></div>
            <div>API Key: <span className="font-mono text-foreground">{p.apiKey || "未设置"}</span></div>
          </div>
        </div>
      ))}

      {/* 编辑/新增表单 */}
      {isEditing && (
        <>
          <div className={`border ${c.cardStatic} rounded-lg divide-y divide-border/40`}>
            <div className="flex justify-between items-center px-4 py-2.5">
              <span className="text-muted-foreground text-sm">配置名称</span>
              <input type="text" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="例: GPT-4o / Claude / 本地Ollama"
                className={`${c.input} rounded px-2 py-1 text-sm w-56`} />
            </div>
            <div className="flex justify-between items-center px-4 py-2.5">
              <span className="text-muted-foreground text-sm">协议类型</span>
              <select value={form.provider}
                onChange={(e) => {
                  const pv = e.target.value as LLMProvider;
                  const pr = PROVIDER_PRESETS[pv];
                  setForm({ ...form, provider: pv, model: form.model || pr.defaultModel });
                }}
                className={`${c.input} rounded px-2 py-1 text-sm w-56`}>
                {Object.entries(PROVIDER_PRESETS).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
            {form.provider !== "ollama" && (
              <div className="flex justify-between items-center px-4 py-2.5">
                <span className="text-muted-foreground text-sm">API Key</span>
                <input type="password" value={form.apiKey}
                  onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                  placeholder={editingIdx !== null ? "留空保持不变" : "sk-..."}
                  className={`${c.input} rounded px-2 py-1 text-sm w-56`} />
              </div>
            )}
            <div className="flex justify-between items-center px-4 py-2.5">
              <span className="text-muted-foreground text-sm">Base URL</span>
              <input type="text" value={form.baseUrl}
                onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                placeholder={preset.placeholder}
                className={`${c.input} rounded px-2 py-1 text-sm w-56`} />
            </div>
            <div className="flex justify-between items-center px-4 py-2.5">
              <span className="text-muted-foreground text-sm">模型</span>
              <input type="text" value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                placeholder={preset.defaultModel}
                className={`${c.input} rounded px-2 py-1 text-sm w-56`} />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setAdding(false); setEditingIdx(null); }}
              className={`px-4 py-2.5 text-sm rounded-md ${c.btnSecondary}`}>
              取消
            </button>
            <button onClick={handleSave}
              className={`px-4 py-2.5 text-sm rounded-md ${c.btnPrimary}`}>
              {adding ? "添加" : "保存"}
            </button>
          </div>
        </>
      )}
    </>
  );
}

interface LlmSettingsData {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly provider: string;
  readonly hasApiKey: boolean;
}

function MyLlmSettings({ theme, t }: { theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { data, loading, error, refetch } = useApi<LlmSettingsData>("/auth/llm-settings");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ apiKey: "", baseUrl: "", model: "", provider: "" });

  if (loading) return <div className="text-muted-foreground py-8 text-center text-sm">Loading LLM settings...</div>;
  if (error) return <div className="text-destructive py-8 text-center text-sm">Error: {error}</div>;
  if (!data) return null;

  const startEdit = () => {
    setForm({
      apiKey: "", // Don't pre-fill API key for security
      baseUrl: data.baseUrl,
      model: data.model,
      provider: data.provider,
    });
    setEditing(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: Record<string, string> = {};
      // Only send apiKey if user actually typed something new
      if (form.apiKey.trim()) payload.apiKey = form.apiKey;
      payload.baseUrl = form.baseUrl;
      payload.model = form.model;
      payload.provider = form.provider;

      await fetchJson("/auth/llm-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setEditing(false);
      refetch();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to save LLM settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="flex items-baseline justify-between">
        <h2 className="font-serif text-xl mt-4">{t("config.myLlm") ?? "My LLM Settings"}</h2>
        {!editing && (
          <button onClick={startEdit} className={`px-3 py-2 text-xs rounded-md ${c.btnSecondary}`}>
            Edit
          </button>
        )}
      </div>

      <div className={`border ${c.cardStatic} rounded-lg divide-y divide-border/40`}>
        {editing ? (
          <>
            <div className="flex justify-between items-center px-4 py-2.5">
              <span className="text-muted-foreground text-sm">{t("config.provider") ?? "Provider"}</span>
              <input
                type="text"
                value={form.provider}
                onChange={(e) => setForm({ ...form, provider: e.target.value })}
                placeholder="openai"
                className={`${c.input} rounded px-2 py-1 text-sm w-48`}
              />
            </div>
            <div className="flex justify-between items-center px-4 py-2.5">
              <span className="text-muted-foreground text-sm">API Key</span>
              <input
                type="password"
                value={form.apiKey}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                placeholder={data.hasApiKey ? "••••••••(keep current)" : "sk-..."}
                className={`${c.input} rounded px-2 py-1 text-sm w-48`}
              />
            </div>
            <div className="flex justify-between items-center px-4 py-2.5">
              <span className="text-muted-foreground text-sm">Base URL</span>
              <input
                type="text"
                value={form.baseUrl}
                onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                placeholder="https://api.openai.com/v1"
                className={`${c.input} rounded px-2 py-1 text-sm w-48`}
              />
            </div>
            <div className="flex justify-between items-center px-4 py-2.5">
              <span className="text-muted-foreground text-sm">{t("config.model") ?? "Model"}</span>
              <input
                type="text"
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                placeholder="gpt-4o"
                className={`${c.input} rounded px-2 py-1 text-sm w-48`}
              />
            </div>
          </>
        ) : (
          <>
            <Row label={t("config.provider") ?? "Provider"} value={data.provider || "(default)"} />
            <Row label="API Key" value={data.hasApiKey ? data.apiKey : "Not set"} mono />
            <Row label="Base URL" value={data.baseUrl || "(default)"} mono />
            <Row label={t("config.model") ?? "Model"} value={data.model || "(default)"} />
          </>
        )}
      </div>

      {editing && (
        <div className="flex gap-2 justify-end">
          <button onClick={() => setEditing(false)} className={`px-4 py-2.5 text-sm rounded-md ${c.btnSecondary}`}>
            {t("config.cancel") ?? "Cancel"}
          </button>
          <button onClick={handleSave} disabled={saving} className={`px-4 py-2.5 text-sm rounded-md ${c.btnPrimary} disabled:opacity-50`}>
            {saving ? (t("config.saving") ?? "Saving...") : (t("config.save") ?? "Save")}
          </button>
        </div>
      )}
    </>
  );
}

function ModelRoutingSection({ theme, t }: { theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { data, loading, error, refetch } = useApi<{ overrides: OverridesMap }>(
    "/project/model-overrides",
  );
  const [overrides, setOverrides] = useState<OverridesMap>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setOverrides(normalizeOverridesDraft(data));
  }, [data]);

  if (loading) return <div className="text-muted-foreground py-8 text-center text-sm">Loading model overrides...</div>;
  if (error) return <div className="text-destructive py-8 text-center text-sm">Error: {error}</div>;

  const updateAgent = (agent: string, field: keyof AgentOverride, value: string) => {
    const current = overrides[agent] ?? emptyOverride();
    setOverrides({
      ...overrides,
      [agent]: { ...current, [field]: value },
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetchJson("/project/model-overrides", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides }),
      });
      refetch();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to save model overrides");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <h2 className="font-serif text-xl mt-4">{t("config.modelRouting")}</h2>

      <div className={`border ${c.cardStatic} rounded-lg overflow-hidden`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/40 text-muted-foreground text-left">
              <th className="px-4 py-2.5 font-medium">{t("config.agent")}</th>
              <th className="px-4 py-2.5 font-medium">{t("config.model")}</th>
              <th className="px-4 py-2.5 font-medium">{t("config.provider")}</th>
              <th className="px-4 py-2.5 font-medium">{t("config.baseUrl")}</th>
            </tr>
          </thead>
          <tbody>
            {ROUTING_AGENTS.map((agent) => {
              const row = overrides[agent] ?? emptyOverride();
              return (
                <tr key={agent} className="border-b border-border/40 last:border-b-0">
                  <td className="px-4 py-2 font-mono text-foreground/80">{agent}</td>
                  <td className="px-4 py-2">
                    <input
                      type="text"
                      value={row.model}
                      onChange={(e) => updateAgent(agent, "model", e.target.value)}
                      placeholder={t("config.default")}
                      className={`${c.input} rounded px-2 py-1 text-sm w-full`}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="text"
                      value={row.provider}
                      onChange={(e) => updateAgent(agent, "provider", e.target.value)}
                      placeholder={t("config.optional")}
                      className={`${c.input} rounded px-2 py-1 text-sm w-full`}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="text"
                      value={row.baseUrl}
                      onChange={(e) => updateAgent(agent, "baseUrl", e.target.value)}
                      placeholder={t("config.optional")}
                      className={`${c.input} rounded px-2 py-1 text-sm w-full`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className={`px-4 py-2.5 text-sm rounded-md ${c.btnPrimary} disabled:opacity-50`}
        >
          {saving ? t("config.saving") : t("config.saveOverrides")}
        </button>
      </div>
    </>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between px-4 py-3">
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className={mono ? "font-mono text-sm" : "text-sm"}>{value}</span>
    </div>
  );
}

function EditRow({ label, value, onChange, type, options, c }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type: "number" | "select";
  options?: ReadonlyArray<{ value: string; label: string }>;
  c: ReturnType<typeof useColors>;
}) {
  return (
    <div className="flex justify-between items-center px-4 py-2.5">
      <span className="text-muted-foreground text-sm">{label}</span>
      {type === "select" && options ? (
        <select value={value} onChange={(e) => onChange(e.target.value)} className={`${c.input} rounded px-2 py-1 text-sm w-32`}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <input type="number" value={value} onChange={(e) => onChange(e.target.value)} className={`${c.input} rounded px-2 py-1 text-sm w-32 text-right`} />
      )}
    </div>
  );
}
