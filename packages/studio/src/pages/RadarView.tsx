import { useState } from "react";
import { Loader2, Target, TrendingUp } from "lucide-react";

import { PageEmptyState } from "@/components/layout/PageEmptyState";
import { PageScaffold } from "@/components/layout/PageScaffold";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { fetchJson } from "../hooks/use-api";
import { useColors } from "../hooks/use-colors";
import type { TFunction } from "../hooks/use-i18n";
import type { Theme } from "../hooks/use-theme";

interface Recommendation {
  readonly confidence: number;
  readonly platform: string;
  readonly genre: string;
  readonly concept: string;
  readonly reasoning: string;
  readonly benchmarkTitles: ReadonlyArray<string>;
}

interface RadarResult {
  readonly marketSummary: string;
  readonly recommendations: ReadonlyArray<Recommendation>;
}

interface Nav { toDashboard: () => void }

export function RadarView({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const [result, setResult] = useState<RadarResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleScan = async () => {
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const data = await fetchJson<RadarResult>("/radar/scan", { method: "POST" });
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  };

  return (
    <PageScaffold
      title={t("radar.title")}
      description="先扫描内容市场，再给出题材、平台与概念层面的选题建议。"
      actions={
        <>
          <Button variant="outline" onClick={nav.toDashboard}>返回书单</Button>
          <Button onClick={handleScan} disabled={loading}>
            {loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Target className="mr-2 size-4" />}
            {loading ? t("radar.scanning") : t("radar.scan")}
          </Button>
        </>
      }
    >
      {error && (
        <Card className="border-destructive/20 bg-destructive/5">
          <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {result ? (
        <div className="space-y-6">
          <Card className={c.cardStatic}>
            <CardContent className="space-y-3 p-5">
              <div>
                <h2 className="text-sm font-medium text-foreground">{t("radar.summary")}</h2>
                <p className="text-xs text-muted-foreground">市场概览会帮助你把选题放到更合适的平台与受众区间。</p>
              </div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{result.marketSummary}</p>
            </CardContent>
          </Card>

          {result.recommendations.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {result.recommendations.map((rec, i) => (
                <Card key={i} className={c.cardStatic}>
                  <CardContent className="space-y-3 p-5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        {rec.platform} · {rec.genre}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                          rec.confidence >= 0.7
                            ? "bg-emerald-500/10 text-emerald-600"
                            : rec.confidence >= 0.4
                              ? "bg-amber-500/10 text-amber-600"
                              : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {(rec.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                    <p className="text-sm font-semibold text-foreground">{rec.concept}</p>
                    <p className="text-xs leading-relaxed text-muted-foreground">{rec.reasoning}</p>
                    {rec.benchmarkTitles.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {rec.benchmarkTitles.map((bt) => (
                          <span key={bt} className="rounded-md bg-secondary px-2 py-1 text-[10px] text-foreground/80">
                            {bt}
                          </span>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <PageEmptyState
              title="暂无推荐结果"
              description="这次扫描没有生成可用的题材建议，稍后可以重新扫描或换一个采样方向。"
              icon={TrendingUp}
            />
          )}
        </div>
      ) : loading ? (
        <div className="flex min-h-[240px] items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" />
          {t("radar.scanning")}
        </div>
      ) : (
        <PageEmptyState
          title={t("radar.emptyHint")}
          description="点击右上角的扫描按钮，生成平台、题材和概念层面的内容雷达。"
          icon={TrendingUp}
        />
      )}
    </PageScaffold>
  );
}
