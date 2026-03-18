import { useApi, postApi } from "../hooks/use-api";
import { useState } from "react";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";

interface GenreInfo {
  readonly id: string;
  readonly name: string;
  readonly source: "project" | "builtin";
  readonly language: "zh" | "en";
}

interface GenreDetail {
  readonly profile: {
    readonly name: string;
    readonly id: string;
    readonly language: string;
    readonly chapterTypes: ReadonlyArray<string>;
    readonly fatigueWords: ReadonlyArray<string>;
    readonly numericalSystem: boolean;
    readonly powerScaling: boolean;
    readonly pacingRule: string;
    readonly auditDimensions: ReadonlyArray<number>;
  };
  readonly body: string;
}

interface Nav {
  toDashboard: () => void;
}

export function GenreManager({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { data, refetch } = useApi<{ genres: ReadonlyArray<GenreInfo> }>("/genres");
  const [selected, setSelected] = useState<string | null>(null);
  const { data: detail } = useApi<GenreDetail>(selected ? `/genres/${selected}` : "");

  const handleCopy = async (id: string) => {
    await postApi(`/genres/${id}/copy`);
    alert(`Copied ${id} to project genres/`);
    refetch();
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.home")}</button>
        <span className="text-border">/</span>
        <span>{t("create.genre")}</span>
      </div>

      <h1 className="font-serif text-3xl">{t("create.genre")}</h1>

      <div className="grid grid-cols-[250px_1fr] gap-6">
        {/* Genre list */}
        <div className={`border ${c.cardStatic} rounded-lg overflow-hidden`}>
          {data?.genres.map((g) => (
            <button
              key={g.id}
              onClick={() => setSelected(g.id)}
              className={`w-full text-left px-4 py-3 border-b border-border/40 transition-colors ${
                selected === g.id ? "bg-primary/10 text-primary" : "hover:bg-muted/30"
              }`}
            >
              <div className="text-sm font-medium">{g.name}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {g.id} · {g.language} · {g.source}
              </div>
            </button>
          ))}
        </div>

        {/* Detail panel */}
        <div className={`border ${c.cardStatic} rounded-lg p-6 min-h-[400px]`}>
          {selected && detail ? (
            <div className="space-y-6">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-xl font-medium">{detail.profile.name}</h2>
                  <div className="text-sm text-muted-foreground mt-1">
                    {detail.profile.id} · {detail.profile.language} ·
                    {detail.profile.numericalSystem ? " Numerical" : ""}
                    {detail.profile.powerScaling ? " Power" : ""}
                  </div>
                </div>
                <button
                  onClick={() => handleCopy(selected)}
                  className={`px-3 py-1.5 text-sm ${c.btnSecondary} rounded-md`}
                >
                  Copy to Project
                </button>
              </div>

              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Chapter Types</div>
                <div className="flex gap-2 flex-wrap">
                  {detail.profile.chapterTypes.map((t) => (
                    <span key={t} className="px-2 py-1 text-xs bg-secondary rounded">{t}</span>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Fatigue Words</div>
                <div className="flex gap-2 flex-wrap">
                  {detail.profile.fatigueWords.slice(0, 15).map((w) => (
                    <span key={w} className="px-2 py-1 text-xs bg-secondary rounded">{w}</span>
                  ))}
                  {detail.profile.fatigueWords.length > 15 && (
                    <span className="text-xs text-muted-foreground">+{detail.profile.fatigueWords.length - 15}</span>
                  )}
                </div>
              </div>

              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Pacing</div>
                <div className="text-sm">{detail.profile.pacingRule || "—"}</div>
              </div>

              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Rules</div>
                <pre className="text-sm leading-relaxed whitespace-pre-wrap font-mono text-foreground/80 bg-muted/30 p-4 rounded-md max-h-[300px] overflow-y-auto">
                  {detail.body || "—"}
                </pre>
              </div>
            </div>
          ) : (
            <div className="text-muted-foreground text-sm italic flex items-center justify-center h-full">
              Select a genre to view details
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
