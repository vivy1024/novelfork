import { Loader2, BarChart3 } from "lucide-react";

import { PageEmptyState } from "@/components/layout/PageEmptyState";
import { PageScaffold } from "@/components/layout/PageScaffold";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useApi } from "../hooks/use-api";
import { useColors } from "../hooks/use-colors";
import type { TFunction } from "../hooks/use-i18n";
import type { Theme } from "../hooks/use-theme";

interface AnalyticsData {
  readonly bookId: string;
  readonly totalChapters: number;
  readonly totalWords: number;
  readonly avgWordsPerChapter: number;
  readonly statusDistribution: Record<string, number>;
}

interface Nav {
  toBook: (id: string) => void;
  toDashboard: () => void;
}

export function Analytics({ bookId, nav, theme, t }: { bookId: string; nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { data, loading, error } = useApi<AnalyticsData>(`/books/${bookId}/analytics`);

  if (loading) {
    return (
      <PageScaffold
        title={t("analytics.title")}
        description="汇总章节、字数与状态分布，快速确认当前书籍的推进质量。"
        actions={<Button variant="outline" onClick={() => nav.toBook(bookId)}>返回书籍</Button>}
      >
        <div className="flex min-h-[240px] items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" />
          {t("common.loading")}
        </div>
      </PageScaffold>
    );
  }

  if (error) {
    return (
      <PageScaffold
        title={t("analytics.title")}
        description="汇总章节、字数与状态分布，快速确认当前书籍的推进质量。"
        actions={<Button variant="outline" onClick={() => nav.toBook(bookId)}>返回书籍</Button>}
      >
        <PageEmptyState
          title={t("common.error")}
          description={error}
          icon={BarChart3}
        />
      </PageScaffold>
    );
  }

  if (!data) return null;

  const statuses = Object.entries(data.statusDistribution);
  const totalFromDist = statuses.reduce((sum, [, count]) => sum + count, 0);

  return (
    <PageScaffold
      title={t("analytics.title")}
      description="汇总章节、字数与状态分布，快速确认当前书籍的推进质量。"
      actions={<Button variant="outline" onClick={() => nav.toBook(bookId)}>返回书籍</Button>}
    >
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label={t("analytics.totalChapters")} value={data.totalChapters.toString()} c={c} />
        <StatCard label={t("analytics.totalWords")} value={data.totalWords.toLocaleString()} c={c} />
        <StatCard label={t("analytics.avgWords")} value={data.avgWordsPerChapter.toLocaleString()} c={c} />
      </div>

      {statuses.length > 0 ? (
        <Card className={c.cardStatic}>
          <CardContent className="space-y-4 p-5">
            <div>
              <h2 className="text-sm font-medium text-foreground">{t("analytics.statusDist")}</h2>
              <p className="text-xs text-muted-foreground">查看不同章节状态的占比，识别待审、已完成与异常堆积。</p>
            </div>
            <div className="space-y-3">
              {statuses.map(([status, count]) => (
                <div key={status}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="text-muted-foreground">{status}</span>
                    <span className="text-foreground">{count}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-secondary/80">
                    <div
                      className="h-full rounded-full bg-zinc-500 transition-all"
                      style={{ width: `${totalFromDist > 0 ? (count / totalFromDist) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : (
        <PageEmptyState
          title="暂无状态分布"
          description="这本书还没有可统计的章节状态，等章节进入审核或完结后会在这里出现分布图。"
          icon={BarChart3}
        />
      )}
    </PageScaffold>
  );
}

function StatCard({ label, value, c }: { label: string; value: string; c: ReturnType<typeof useColors> }) {
  return (
    <Card className={c.cardStatic}>
      <CardContent className="p-5">
        <div className={`mb-1 text-sm ${c.muted}`}>{label}</div>
        <div className="text-2xl font-semibold tabular-nums text-foreground">{value}</div>
      </CardContent>
    </Card>
  );
}
