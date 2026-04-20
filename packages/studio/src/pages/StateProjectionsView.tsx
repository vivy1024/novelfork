import { useEffect, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Layers, RefreshCw, TrendingUp, type LucideIcon } from "lucide-react";

import { PageEmptyState } from "@/components/layout/PageEmptyState";
import { PageScaffold } from "@/components/layout/PageScaffold";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { fetchJson } from "../hooks/use-api";
import { useColors } from "../hooks/use-colors";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";

interface StateSnapshot {
  currentChapter: number;
  totalChapters: number;
  wordCount: number;
  activeHooks: number;
  unresolvedConflicts: number;
  resourceBalance: Record<string, number>;
  emotionalArcs: Array<{ character: string; state: string; trend: string }>;
  lastUpdated: string;
}

interface Props {
  bookId: string;
  nav: any;
  theme: Theme;
  t: TFunction;
}

export function StateProjectionsView({ bookId, nav, theme, t }: Props) {
  const c = useColors(theme);
  const [snapshot, setSnapshot] = useState<StateSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void loadSnapshot();
  }, [bookId]);

  async function loadSnapshot() {
    setLoading(true);
    setError("");
    try {
      const data = await fetchJson<StateSnapshot>(`/api/books/${bookId}/state`);
      setSnapshot(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <PageScaffold
        title="状态投影"
        description="查看运行时状态快照、章节进度和剧情资源账本。"
        actions={
          <>
            <Button variant="outline" onClick={() => nav.toDashboard?.()}>返回书单</Button>
            <Button variant="outline" onClick={() => void loadSnapshot()}>
              <RefreshCw className="mr-2 size-4" />
              刷新
            </Button>
          </>
        }
      >
        <div className="flex min-h-[220px] items-center justify-center text-sm text-muted-foreground">
          <Activity className="mr-2 size-4 animate-spin" />
          加载状态快照...
        </div>
      </PageScaffold>
    );
  }

  if (error) {
    return (
      <PageScaffold
        title="状态投影"
        description="查看运行时状态快照、章节进度和剧情资源账本。"
        actions={
          <>
            <Button variant="outline" onClick={() => nav.toDashboard?.()}>返回书单</Button>
            <Button variant="outline" onClick={() => void loadSnapshot()}>
              <RefreshCw className="mr-2 size-4" />
              刷新
            </Button>
          </>
        }
      >
        <Card className="border-destructive/20 bg-destructive/5">
          <CardContent className="flex items-center gap-2 p-4 text-sm text-destructive">
            <AlertTriangle className="size-4" />
            {error}
          </CardContent>
        </Card>
      </PageScaffold>
    );
  }

  if (!snapshot) {
    return (
      <PageScaffold
        title="状态投影"
        description="查看运行时状态快照、章节进度和剧情资源账本。"
        actions={
          <>
            <Button variant="outline" onClick={() => nav.toDashboard?.()}>返回书单</Button>
            <Button variant="outline" onClick={() => void loadSnapshot()}>
              <RefreshCw className="mr-2 size-4" />
              刷新
            </Button>
          </>
        }
      >
        <PageEmptyState
          title="无状态数据"
          description="当前书籍还没有生成状态快照，刷新或继续写作后这里会出现投影结果。"
          icon={Layers}
        />
      </PageScaffold>
    );
  }

  return (
    <PageScaffold
      title="状态投影"
      description={`运行时状态快照 · 最后更新: ${new Date(snapshot.lastUpdated).toLocaleString("zh-CN")}`}
      actions={
        <>
          <Button variant="outline" onClick={() => nav.toDashboard?.()}>返回书单</Button>
          <Button variant="outline" onClick={() => void loadSnapshot()}>
            <RefreshCw className="mr-2 size-4" />
            刷新
          </Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <StatCard
          title="章节进度"
          icon={Layers}
          value={`${snapshot.currentChapter} / ${snapshot.totalChapters}`}
          description={`${snapshot.wordCount.toLocaleString()} 字`}
          c={c}
        />
        <StatCard
          title="伏笔状态"
          icon={AlertTriangle}
          value={snapshot.activeHooks.toString()}
          description="活跃伏笔"
          accent={snapshot.activeHooks > 0 ? "text-amber-500" : "text-emerald-500"}
          c={c}
        />
        <StatCard
          title="冲突追踪"
          icon={TrendingUp}
          value={snapshot.unresolvedConflicts.toString()}
          description="未解决冲突"
          accent={snapshot.unresolvedConflicts > 0 ? "text-red-500" : "text-emerald-500"}
          c={c}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className={c.cardStatic}>
          <CardContent className="space-y-3 p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Activity className="size-5" />
              资源账本
            </h3>
            {Object.keys(snapshot.resourceBalance).length === 0 ? (
              <PageEmptyState
                title="暂无资源记录"
                description="当角色、道具或世界资源发生变化时，这里会同步显示账本。"
                icon={Activity}
              />
            ) : (
              <div className="space-y-2">
                {Object.entries(snapshot.resourceBalance).map(([resource, balance]) => (
                  <div key={resource} className="flex items-center justify-between rounded-xl bg-secondary/50 p-3">
                    <span className="text-sm text-foreground">{resource}</span>
                    <span className={`font-mono text-sm ${balance >= 0 ? "text-green-500" : "text-red-500"}`}>
                      {balance >= 0 ? "+" : ""}{balance}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className={c.cardStatic}>
          <CardContent className="space-y-3 p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <TrendingUp className="size-5" />
              情绪弧线
            </h3>
            {snapshot.emotionalArcs.length === 0 ? (
              <PageEmptyState
                title="暂无情绪弧线数据"
                description="角色情绪曲线会随着章节推进逐步累积。"
                icon={TrendingUp}
              />
            ) : (
              <div className="space-y-3">
                {snapshot.emotionalArcs.map((arc, idx) => (
                  <div key={idx} className="rounded-xl bg-secondary/50 p-3">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-foreground">{arc.character}</span>
                      <span
                        className={`rounded px-2 py-1 text-xs ${
                          arc.trend === "up"
                            ? "bg-green-500/20 text-green-500"
                            : arc.trend === "down"
                              ? "bg-red-500/20 text-red-500"
                              : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {arc.trend === "up" ? "↑" : arc.trend === "down" ? "↓" : "→"}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">{arc.state}</div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className={c.cardStatic}>
        <CardContent className="flex items-center gap-2 p-4 text-sm text-emerald-600">
          <CheckCircle2 className="size-4" />
          状态快照已同步
        </CardContent>
      </Card>
    </PageScaffold>
  );
}

function StatCard({
  title,
  value,
  description,
  icon: Icon,
  accent,
  c,
}: {
  title: string;
  value: string;
  description: string;
  icon: LucideIcon;
  accent?: string;
  c: ReturnType<typeof useColors>;
}) {
  return (
    <Card className={c.cardStatic}>
      <CardContent className="space-y-2 p-5">
        <div className="flex items-center gap-2 text-foreground">
          <Icon className="size-5 text-primary" />
          <h3 className="font-semibold">{title}</h3>
        </div>
        <div className={`text-3xl font-bold tabular-nums ${accent ?? "text-foreground"}`}>{value}</div>
        <div className="text-sm text-muted-foreground">{description}</div>
      </CardContent>
    </Card>
  );
}
