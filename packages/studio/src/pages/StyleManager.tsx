import { useState } from "react";
import { BarChart3, Upload, Wand2 } from "lucide-react";

import { PageEmptyState } from "@/components/layout/PageEmptyState";
import { PageScaffold } from "@/components/layout/PageScaffold";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchJson, postApi, useApi } from "../hooks/use-api";
import { useColors } from "../hooks/use-colors";
import type { TFunction } from "../hooks/use-i18n";
import type { Theme } from "../hooks/use-theme";

interface StyleProfile {
  readonly sourceName: string;
  readonly avgSentenceLength: number;
  readonly sentenceLengthStdDev: number;
  readonly avgParagraphLength: number;
  readonly vocabularyDiversity: number;
  readonly topPatterns: ReadonlyArray<string>;
  readonly rhetoricalFeatures: ReadonlyArray<string>;
}

interface BookSummary {
  readonly id: string;
  readonly title: string;
}

interface Nav { toDashboard: () => void }

export interface StyleStatusNotice {
  readonly tone: "error" | "success" | "info";
  readonly message: string;
}

export function buildStyleStatusNotice(analyzeStatus: string, importStatus: string): StyleStatusNotice | null {
  const message = analyzeStatus.trim() || importStatus.trim();
  if (!message) return null;
  if (message.startsWith("Error:")) {
    return { tone: "error", message };
  }
  if (message.endsWith("...")) {
    return { tone: "info", message };
  }
  return { tone: "success", message };
}

export function StyleManager({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const [text, setText] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [profile, setProfile] = useState<StyleProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [analyzeStatus, setAnalyzeStatus] = useState("");
  const [importBookId, setImportBookId] = useState("");
  const [importStatus, setImportStatus] = useState("");
  const { data: booksData } = useApi<{ books: ReadonlyArray<BookSummary> }>("/books");
  const statusNotice = buildStyleStatusNotice(analyzeStatus, importStatus);

  const handleAnalyze = async () => {
    if (!text.trim()) return;
    setLoading(true);
    setProfile(null);
    setAnalyzeStatus("");
    try {
      const data = await fetchJson<StyleProfile>("/style/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, sourceName: sourceName || "sample" }),
      });
      setProfile(data);
    } catch (e) {
      setAnalyzeStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLoading(false);
  };

  const handleImport = async () => {
    if (!importBookId || !text.trim()) return;
    setImportStatus("Importing...");
    try {
      await postApi(`/books/${importBookId}/style/import`, { text, sourceName: sourceName || "sample" });
      setImportStatus("Style guide imported successfully!");
    } catch (e) {
      setImportStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <PageScaffold
      title={t("style.title")}
      description="分析一段样本文字的风格特征，并把结果导入到指定书籍中形成可复用的写作参考。"
      actions={<Button variant="outline" onClick={nav.toDashboard}>返回书单</Button>}
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className={c.cardStatic}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wand2 className="size-5 text-primary" />
              {t("style.title")}
            </CardTitle>
            <CardDescription>先输入样本文字，再抽取句长、段落、词汇和修辞特征。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {t("style.sourceName")}
              </label>
              <input
                type="text"
                value={sourceName}
                onChange={(e) => setSourceName(e.target.value)}
                placeholder={t("style.sourceExample")}
                className="w-full rounded-xl border border-border bg-secondary/30 px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {t("style.textSample")}
              </label>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={12}
                placeholder={t("style.pasteHint")}
                className="h-[320px] w-full resize-none rounded-xl border border-border bg-secondary/30 px-3 py-2 font-mono text-sm outline-none focus:border-primary"
              />
            </div>
            <div className="flex flex-wrap gap-3">
              <Button onClick={handleAnalyze} disabled={!text.trim() || loading}>
                <BarChart3 className="mr-2 size-4" />
                {loading ? t("style.analyzing") : t("style.analyze")}
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {profile ? (
            <Card className={c.cardStatic}>
              <CardHeader>
                <CardTitle>{t("style.results")}</CardTitle>
                <CardDescription>这些指标会帮助你把风格特征转成更稳定的写作提示。</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <Metric label={t("style.avgSentence")} value={profile.avgSentenceLength.toFixed(1)} />
                  <Metric label={t("style.vocabDiversity")} value={`${(profile.vocabularyDiversity * 100).toFixed(0)}%`} />
                  <Metric label={t("style.avgParagraph")} value={profile.avgParagraphLength.toFixed(0)} />
                  <Metric label={t("style.sentenceStdDev")} value={profile.sentenceLengthStdDev.toFixed(1)} />
                </div>

                {profile.topPatterns.length > 0 && (
                  <div>
                    <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">{t("style.topPatterns")}</div>
                    <div className="flex flex-wrap gap-2">
                      {profile.topPatterns.map((p) => (
                        <span key={p} className="rounded-md bg-secondary px-2 py-1 text-xs text-foreground">
                          {p}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {profile.rhetoricalFeatures.length > 0 && (
                  <div>
                    <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">{t("style.rhetoricalFeatures")}</div>
                    <div className="flex flex-wrap gap-2">
                      {profile.rhetoricalFeatures.map((f) => (
                        <span key={f} className="rounded-md bg-primary/10 px-2 py-1 text-xs text-primary">
                          {f}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-3 border-t border-border pt-4">
                  <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Upload size={14} />
                    {t("style.importToBook")}
                  </h4>
                  <select
                    value={importBookId}
                    onChange={(e) => setImportBookId(e.target.value)}
                    className="w-full rounded-xl border border-border bg-secondary/30 px-3 py-2 text-sm outline-none"
                  >
                    <option value="">{t("style.selectBook")}</option>
                    {booksData?.books.map((b) => (
                      <option key={b.id} value={b.id}>{b.title}</option>
                    ))}
                  </select>
                  <Button variant="secondary" onClick={handleImport} disabled={!importBookId}>
                    {t("style.importGuide")}
                  </Button>
                  {importStatus && <div className="text-xs text-muted-foreground">{importStatus}</div>}
                </div>
              </CardContent>
            </Card>
          ) : !loading ? (
            <PageEmptyState
              title={t("style.emptyHint")}
              description="先输入样本，再查看风格分析结果与导入选项。"
              icon={BarChart3}
            />
          ) : (
            <div className="flex min-h-[240px] items-center justify-center text-sm text-muted-foreground">
              分析中…
            </div>
          )}
        </div>
      </div>

      {statusNotice && (
        <Card
          className={
            statusNotice.tone === "error"
              ? "border-destructive/20 bg-destructive/5"
              : statusNotice.tone === "info"
                ? c.cardStatic
                : "border-emerald-500/20 bg-emerald-500/5"
          }
        >
          <CardContent
            className={`p-4 text-sm ${
              statusNotice.tone === "error"
                ? "text-destructive"
                : statusNotice.tone === "info"
                  ? "text-muted-foreground"
                  : "text-emerald-600"
            }`}
          >
            {statusNotice.message}
          </CardContent>
        </Card>
      )}
    </PageScaffold>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-secondary/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-bold text-foreground">{value}</div>
    </div>
  );
}
