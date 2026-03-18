import { useApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";

interface ProjectInfo {
  readonly name: string;
  readonly language: string;
  readonly model: string;
  readonly provider: string;
}

interface Nav {
  toDashboard: () => void;
}

export function ConfigView({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { data, loading, error } = useApi<ProjectInfo>("/project");

  if (loading) return <div className={c.muted}>Loading...</div>;
  if (error) return <div className="text-red-400">Error: {error}</div>;
  if (!data) return null;

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div className={`flex items-center gap-2 text-sm ${c.muted}`}>
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.home")}</button>
        <span>/</span>
        <span className={c.subtle}>{t("bread.config")}</span>
      </div>

      <h1 className="text-2xl font-semibold">{t("config.title")}</h1>

      <div className={`border ${c.cardStatic} rounded-lg divide-y ${c.tableDivide}`}>
        <Row label={t("config.project")} value={data.name} c={c} />
        <Row label={t("config.language")} value={data.language === "en" ? "English" : "Chinese"} c={c} />
        <Row label={t("config.provider")} value={data.provider} c={c} />
        <Row label={t("config.model")} value={data.model} c={c} />
      </div>

      <p className={`text-sm ${c.muted}`}>
        {t("config.editHint")} <code className={`${c.code} px-1.5 py-0.5 rounded`}>inkos config set &lt;key&gt; &lt;value&gt;</code>
      </p>
    </div>
  );
}

function Row({ label, value, c }: { label: string; value: string; c: ReturnType<typeof useColors> }) {
  return (
    <div className="flex justify-between px-4 py-3">
      <span className={c.subtle}>{label}</span>
      <span className={c.mono}>{value}</span>
    </div>
  );
}
