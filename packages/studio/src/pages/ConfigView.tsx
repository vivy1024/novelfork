import { fetchJson, putApi, useApi } from "../hooks/use-api";
import { useEffect, useState } from "react";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";

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
  const { data, loading, error, refetch } = useApi<ProjectInfo>("/project");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Record<string, unknown>>({});

  if (loading) return <div className="text-muted-foreground py-20 text-center text-sm">Loading...</div>;
  if (error) return <div className="text-destructive py-20 text-center">Error: {error}</div>;
  if (!data) return null;

  const startEdit = () => {
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
        {!editing && (
          <button onClick={startEdit} className={`px-3 py-2 text-xs rounded-md ${c.btnSecondary}`}>
            Edit
          </button>
        )}
      </div>

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

      <ModelRoutingSection theme={theme} t={t} />
    </div>
  );
}

function emptyOverride(): AgentOverride {
  return { model: "", provider: "", baseUrl: "" };
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
