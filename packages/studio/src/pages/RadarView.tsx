import { useMemo, useState } from "react";
import { BookOpen, Loader2, Target, TrendingUp } from "lucide-react";

import { PageEmptyState } from "@/components/layout/PageEmptyState";
import { PageScaffold } from "@/components/layout/PageScaffold";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { fetchJson, useApi } from "../hooks/use-api";
import { useColors } from "../hooks/use-colors";
import type { TFunction } from "../hooks/use-i18n";
import type { Theme } from "../hooks/use-theme";
import type { AdminSection, SettingsSection } from "../routes";
import { describeLlmError, type LlmErrorInfo } from "../lib/llm-error";
import type { AuthorMaterialPersistenceInfo } from "../shared/author-materials";

interface BookSummary {
  readonly id: string;
  readonly title: string;
}

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
  readonly persisted?: AuthorMaterialPersistenceInfo;
}

interface Nav {
  toDashboard: () => void;
  toImport?: () => void;
  toTruth?: (bookId: string) => void;
  toAdmin?: (section?: AdminSection) => void;
  toSettings?: (section?: SettingsSection) => void;
}

export function RadarView({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { data: booksData } = useApi<{ books: ReadonlyArray<BookSummary> }>("/books");
  const [selectedBookId, setSelectedBookId] = useState("");
  const [result, setResult] = useState<RadarResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorInfo, setErrorInfo] = useState<LlmErrorInfo | null>(null);
  const [showRawError, setShowRawError] = useState(false);

  const selectedBookTitle = useMemo(
    () => booksData?.books.find((book) => book.id === selectedBookId)?.title ?? "",
    [booksData?.books, selectedBookId],
  );

  const handleScan = async () => {
    setLoading(true);
    setErrorInfo(null);
    setShowRawError(false);
    setResult(null);
    try {
      const data = await fetchJson<RadarResult>("/radar/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selectedBookId ? { bookId: selectedBookId } : {}),
      });
      setResult(data);
    } catch (e) {
      setErrorInfo(describeLlmError(e, "zh"));
    }
    setLoading(false);
  };

  const handleErrorAction = () => {
    if (!errorInfo) return;
    if (errorInfo.code === "LLM_CONFIG_MISSING" && nav.toAdmin) {
      nav.toAdmin("providers");
      return;
    }
    if (errorInfo.code === "LLM_QUOTA_EXHAUSTED" && nav.toAdmin) {
      nav.toAdmin("providers");
      return;
    }
    if (errorInfo.code === "LLM_NETWORK_ERROR" && nav.toSettings) {
      nav.toSettings("advanced");
    }
  };

  const showAction = Boolean(
    errorInfo?.actionLabel
    && ((errorInfo.code === "LLM_CONFIG_MISSING" || errorInfo.code === "LLM_QUOTA_EXHAUSTED") && nav.toAdmin
      || errorInfo.code === "LLM_NETWORK_ERROR" && nav.toSettings),
  );

  return (
    <PageScaffold
      title={t("radar.title")}
      description="先看市场，再决定题材：雷达结果会收口到作者可审阅结果区，不会直接写进故事经纬。"
      actions={
        <>
          <Button variant="outline" onClick={nav.toDashboard}>返回书单</Button>
          {nav.toImport ? (
            <Button variant="outline" onClick={nav.toImport}>去素材导入</Button>
          ) : null}
          <Button onClick={handleScan} disabled={loading}>
            {loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Target className="mr-2 size-4" />}
            {loading ? t("radar.scanning") : "扫描并收口"}
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <Card className={c.cardStatic}>
          <CardContent className="space-y-4 p-5 text-sm">
            <div className="space-y-1">
              <div className="font-medium text-foreground">作者化市场雷达</div>
              <p className="leading-relaxed text-muted-foreground">
                这里调用后台抓取 / 可读化能力做题材扫描，但不会提供独立 Browser 入口；
                结果只会沉淀为可审阅素材，供你后续筛选、摘录和转化。
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
              <label className="space-y-2">
                <span className="text-xs font-medium text-muted-foreground">收口到哪本书的作者结果区</span>
                <select
                  value={selectedBookId}
                  onChange={(event) => setSelectedBookId(event.target.value)}
                  className="w-full rounded-lg border border-border bg-secondary/30 px-3 py-2 text-sm"
                >
                  <option value="">仅查看本次结果（不落库）</option>
                  {booksData?.books.map((book) => (
                    <option key={book.id} value={book.id}>
                      {book.title}
                    </option>
                  ))}
                </select>
              </label>
              {selectedBookId && nav.toTruth ? (
                <Button variant="outline" onClick={() => nav.toTruth?.(selectedBookId)}>
                  <BookOpen className="mr-2 size-4" />
                  打开审阅区
                </Button>
              ) : null}
            </div>
            <div className="rounded-lg border border-dashed border-border/70 bg-background/70 px-3 py-3 text-xs leading-relaxed text-muted-foreground">
              {selectedBookId
                ? `本次扫描会覆盖保存到《${selectedBookTitle || selectedBookId}》的 market_radar.md，方便作者后续回看和删改。`
                : "未选择书籍时只显示即时结果，不会写入任何故事经纬或素材文件。"}
            </div>
          </CardContent>
        </Card>

        {errorInfo && (
          <Card className="border-destructive/20 bg-destructive/5">
            <CardContent className="space-y-3 p-4 text-sm">
              <div className="space-y-1">
                <div className="font-medium text-destructive">{errorInfo.title}</div>
                <p className="leading-relaxed text-destructive/90">{errorInfo.description}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {showAction && (
                  <Button size="sm" variant="outline" onClick={handleErrorAction}>
                    {errorInfo.actionLabel}
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={handleScan} disabled={loading}>
                  重新扫描
                </Button>
                {errorInfo.rawMessage && errorInfo.code !== "UNKNOWN" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowRawError((prev) => !prev)}
                  >
                    {showRawError ? "隐藏原始错误" : "查看原始错误"}
                  </Button>
                )}
              </div>
              {showRawError && errorInfo.rawMessage && (
                <pre className="max-h-40 overflow-auto rounded-md bg-destructive/10 p-2 text-xs text-destructive/80 whitespace-pre-wrap">
                  {errorInfo.rawMessage}
                </pre>
              )}
            </CardContent>
          </Card>
        )}

        {result?.persisted ? (
          <Card className="border-emerald-500/20 bg-emerald-500/5">
            <CardContent className="space-y-3 p-4 text-sm">
              <div className="font-medium text-emerald-700">已收口到作者结果区</div>
              <p className="leading-relaxed text-emerald-700/90">
                本次市场扫描已保存到 <code className="rounded bg-emerald-500/10 px-1 py-0.5">{result.persisted.path}</code>，
                你可以先审阅、删改，再决定是否把其中结论转成题材方向或故事经纬条目。
              </p>
              {nav.toTruth ? (
                <Button size="sm" variant="outline" onClick={() => nav.toTruth?.(result.persisted!.bookId)}>
                  打开结果文件
                </Button>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {result ? (
          <div className="space-y-6">
            <Card className={c.cardStatic}>
              <CardContent className="space-y-3 p-5">
                <div>
                  <h2 className="text-sm font-medium text-foreground">{t("radar.summary")}</h2>
                  <p className="text-xs text-muted-foreground">先看市场概览，再决定哪些部分值得转化为题材、标签或连载节奏判断。</p>
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
            description="点击右上角的“扫描并收口”，把市场判断沉淀为作者可审阅结果。"
            icon={TrendingUp}
          />
        )}
      </div>
    </PageScaffold>
  );
}
