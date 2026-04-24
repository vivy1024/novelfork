import { useEffect, useState, type ReactNode } from "react";
import { FolderGit2, GitBranch, RefreshCw, Terminal } from "lucide-react";

import { PageEmptyState } from "@/components/layout/PageEmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchJson } from "../../hooks/use-api";

interface AdminWorktreeItem {
  path: string;
  relativePath: string;
  branch: string;
  head: string;
  shortHead: string;
  bare: boolean;
  isPrimary: boolean;
  isExternal?: boolean;
  dirty: boolean;
  changeCount: number;
  status: {
    modified: number;
    added: number;
    deleted: number;
    untracked: number;
  };
}

interface AdminWorktreeSnapshot {
  rootPath: string;
  refreshedAt: string;
  refreshHintMs: number;
  status: "ready" | "error";
  error?: string;
  summary: {
    total: number;
    dirty: number;
    clean: number;
    bare: number;
  };
  worktrees: AdminWorktreeItem[];
}

export function WorktreesTab() {
  const [snapshot, setSnapshot] = useState<AdminWorktreeSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showExternal, setShowExternal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadWorktrees = async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      const data = await fetchJson<AdminWorktreeSnapshot>("/api/admin/worktrees");
      setSnapshot(data);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载 worktree 失败");
      if (!silent) {
        setSnapshot(null);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void loadWorktrees();
  }, []);

  useEffect(() => {
    const refreshHintMs = snapshot?.refreshHintMs ?? 10_000;
    const timer = window.setInterval(() => {
      void loadWorktrees({ silent: true });
    }, refreshHintMs);

    return () => window.clearInterval(timer);
  }, [snapshot?.refreshHintMs]);

  if (loading && !snapshot && !error) {
    return <div className="py-10 text-center text-sm text-muted-foreground">正在加载 Worktree…</div>;
  }

  if (error && !snapshot) {
    return (
      <PageEmptyState
        title="Worktree 加载失败"
        description={error}
        action={
          <Button variant="outline" onClick={() => void loadWorktrees()}>
            重试
          </Button>
        }
      />
    );
  }

  if (!snapshot) {
    return null;
  }

  const hiddenExternalCount = snapshot.worktrees.filter((worktree) => worktree.isExternal).length;
  const visibleWorktrees = showExternal
    ? snapshot.worktrees
    : snapshot.worktrees.filter((worktree) => !worktree.isExternal);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold text-foreground">Worktree</h2>
            <Badge variant={snapshot.status === "ready" ? "secondary" : "destructive"}>{snapshot.status === "ready" ? "列表已接入" : "读取失败"}</Badge>
            <Badge variant="outline">轮询 {Math.round(snapshot.refreshHintMs / 1000)}s</Badge>
          </div>
          <p className="text-sm text-muted-foreground">接入真实 git worktree 列表与变更计数；创建、删除、终端和容器入口本轮不伪造能力。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {hiddenExternalCount > 0 && (
            <Button variant="outline" onClick={() => setShowExternal((prev) => !prev)}>
              {showExternal ? "隐藏外部 Worktree" : `显示外部 Worktree（${hiddenExternalCount}）`}
            </Button>
          )}
          <Button variant="outline" onClick={() => void loadWorktrees({ silent: true })} disabled={refreshing}>
            <RefreshCw className="size-4" />
            {refreshing ? "刷新中…" : "刷新 Worktree"}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <SummaryCard title="工作树总数" value={snapshot.summary.total.toLocaleString()} description="含主仓库与附加 worktree" />
        <SummaryCard title="脏 worktree" value={snapshot.summary.dirty.toLocaleString()} description="含未提交或未跟踪变更" />
        <SummaryCard title="干净 worktree" value={snapshot.summary.clean.toLocaleString()} description="当前无变更工作树" />
        <SummaryCard title="Bare" value={snapshot.summary.bare.toLocaleString()} description={`根目录：${snapshot.rootPath}`} />
      </div>

      {snapshot.status === "error" ? (
        <PageEmptyState title="无法读取 Worktree" description={snapshot.error ?? "读取 worktree 列表失败"} />
      ) : visibleWorktrees.length === 0 ? (
        <PageEmptyState title="暂无 Worktree" description="当前过滤条件下没有可显示的 worktree 记录。" />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.85fr)]">
          <div className="space-y-4">
            {visibleWorktrees.map((worktree) => (
              <Card key={worktree.path}>
                <CardHeader className="gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="flex items-center gap-2 text-lg">
                        <FolderGit2 className="size-4 text-primary" />
                        {worktree.branch}
                      </CardTitle>
                      {worktree.isPrimary ? <Badge variant="secondary">主仓库</Badge> : null}
                      {worktree.isExternal ? <Badge variant="outline">外部项目</Badge> : null}
                      {worktree.dirty ? <Badge variant="destructive">有变更</Badge> : <Badge variant="outline">干净</Badge>}
                      {worktree.bare ? <Badge variant="outline">Bare</Badge> : null}
                    </div>
                    <CardDescription>{worktree.path}</CardDescription>
                  </div>
                  <div className="text-right text-sm text-muted-foreground">
                    <div>HEAD {worktree.shortHead || "—"}</div>
                    <div className="mt-1">{worktree.relativePath}</div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <InlineMetric label="修改" value={String(worktree.status.modified)} />
                    <InlineMetric label="新增" value={String(worktree.status.added)} />
                    <InlineMetric label="删除" value={String(worktree.status.deleted)} />
                    <InlineMetric label="未跟踪" value={String(worktree.status.untracked)} />
                    <InlineMetric label="总变更" value={String(worktree.changeCount)} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <GitBranch className="size-4 text-primary" />
                接入状态
              </CardTitle>
              <CardDescription>明确哪些能力已经落地，哪些仍留接口但不展示假按钮。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <StatusRow
                title="Worktree 列表"
                description="已接入 /api/admin/worktrees，统一返回主仓库与附加 worktree 的真实状态。"
                badge={<Badge variant="secondary">已接入</Badge>}
              />
              <StatusRow
                title="变更计数"
                description="每个 worktree 会汇总 modified / added / deleted / untracked 四类计数。"
                badge={<Badge variant="secondary">已接入</Badge>}
              />
              <StatusRow
                title="终端入口"
                description="当前仅展示真实路径与分支信息，不伪造打开终端能力。"
                badge={<Badge variant="outline">待接入</Badge>}
                icon={<Terminal className="size-4 text-muted-foreground" />}
              />
              <StatusRow
                title="容器入口"
                description="尚未检测到可验证的容器执行器，因此先保留接口说明。"
                badge={<Badge variant="outline">待接入</Badge>}
              />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ title, value, description }: { title: string; value: string; description: string }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-2xl break-all">{value}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 text-xs text-muted-foreground break-all">{description}</CardContent>
    </Card>
  );
}

function InlineMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-full border border-border/70 px-3 py-1.5">
      <span className="font-medium text-foreground">{label}</span>
      <span className="ml-2">{value}</span>
    </div>
  );
}

function StatusRow({
  title,
  description,
  badge,
  icon,
}: {
  title: string;
  description: string;
  badge: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border/70 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            {icon}
            {title}
          </div>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {badge}
      </div>
    </div>
  );
}
