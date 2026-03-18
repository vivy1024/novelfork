import { useApi, postApi } from "../hooks/use-api";
import { useState } from "react";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";

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
      await fetch("/api/project", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
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
        <Row label="Base URL" value={data.baseUrl} mono />

        {editing ? (
          <>
            <EditRow
              label={t("config.language")}
              value={form.language as string}
              onChange={(v) => setForm({ ...form, language: v })}
              type="select"
              options={[{ value: "zh", label: "Chinese" }, { value: "en", label: "English" }]}
              c={c}
            />
            <EditRow
              label="Temperature"
              value={String(form.temperature)}
              onChange={(v) => setForm({ ...form, temperature: parseFloat(v) })}
              type="number"
              c={c}
            />
            <EditRow
              label="Max Tokens"
              value={String(form.maxTokens)}
              onChange={(v) => setForm({ ...form, maxTokens: parseInt(v, 10) })}
              type="number"
              c={c}
            />
            <EditRow
              label="Stream"
              value={String(form.stream)}
              onChange={(v) => setForm({ ...form, stream: v === "true" })}
              type="select"
              options={[{ value: "true", label: "Enabled" }, { value: "false", label: "Disabled" }]}
              c={c}
            />
          </>
        ) : (
          <>
            <Row label={t("config.language")} value={data.language === "en" ? "English" : "Chinese"} />
            <Row label="Temperature" value={String(data.temperature)} mono />
            <Row label="Max Tokens" value={String(data.maxTokens)} mono />
            <Row label="Stream" value={data.stream ? "Enabled" : "Disabled"} />
          </>
        )}
      </div>

      {editing && (
        <div className="flex gap-2 justify-end">
          <button onClick={() => setEditing(false)} className={`px-4 py-2.5 text-sm rounded-md ${c.btnSecondary}`}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving} className={`px-4 py-2.5 text-sm rounded-md ${c.btnPrimary} disabled:opacity-50`}>
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      )}
    </div>
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
