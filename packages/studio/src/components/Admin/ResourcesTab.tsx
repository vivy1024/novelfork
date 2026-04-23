/**
 * 资源监控标签页
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Activity, Cpu, HardDrive, Network, RefreshCw, Search, Server } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchJson } from "../../hooks/use-api";

interface ResourceStats {
  cpu: { usage: number; cores: number };
  memory: { used: number; total: number; free: number; usagePercent: number };
  disk: { used: number; total: number; free: number; usagePercent: number };
  network: { sent: number; received: number; available: boolean };
  sampledAt: string;
}


interface StorageChild {
  name: string;
  relativePath: string;
  kind: "file" | "directory";
  totalBytes: number;
}

interface StorageTarget {
  id: string;
  label: string;
  relativePath: string;
  absolutePath: string;
  status: "ready" | "missing" | "error";
  totalBytes: number;
  fileCount: number;
  directoryCount: number;
  lastModifiedAt: string | null;
  largestChildren: StorageChild[];
  error?: string;
}

interface StorageSummary {
  scannedTargets: number;
  existingTargets: number;
  totalBytes: number;
  fileCount: number;
  directoryCount: number;
  largestTargetId: string | null;
  largestTargetLabel: string | null;
  largestTargetBytes: number;
}

interface StorageSnapshot {
  rootPath: string;
  scannedAt: string;
  scanDurationMs: number;
  mode: "fresh" | "cached";
  ageMs: number;
  ttlMs: number;
  summary: StorageSummary;
  targets: StorageTarget[];
}

interface StartupActionSummary {
  kind: string;
  scope: "book" | "library";
  status: "success" | "skipped" | "failed";
  reason: string;
  note?: string;
  bookId?: string;
}

interface StartupSummarySnapshot {
  delivery: {
    staticMode: "embedded" | "filesystem" | "missing";
    indexHtmlReady: boolean;
    compileSmokeStatus: "success" | "skipped" | "failed" | "unknown";
  };
  recoveryReport: {
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    actions: StartupActionSummary[];
    counts: {
      success: number;
      skipped: number;
      failed: number;
    };
  };
  failures: Array<{
    bookId?: string;
    phase: "project-bootstrap" | "migration" | "search-index" | "static-delivery" | "compile-smoke";
    message: string;
  }>;
}

interface ResourcesResponse {
  stats?: ResourceStats | null;
  storage?: StorageSnapshot | null;
  startup?: StartupSummarySnapshot | null;
}

export function ResourcesTab() {
  const [data, setData] = useState<ResourcesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"runtime" | "storage" | null>(null);

  useEffect(() => {
    void loadResources();
  }, []);

  const loadResources = async ({ forceRefresh = false }: { forceRefresh?: boolean } = {}) => {
    setLoading(true);
    setError(null);
    setPendingAction(forceRefresh ? "storage" : "runtime");

    try {
      const data = await fetchJson<ResourcesResponse>(forceRefresh ? "/api/admin/resources?refresh=1" : "/api/admin/resources");
      setData(data);
    } catch (loadError) {
      setData(null);
      setError(loadError instanceof Error ? loadError.message : "加载运行资源快照失败");
    } finally {
      setLoading(false);
      setPendingAction(null);
    }
  };

  const stats = data?.stats ?? null;
  const storage = data?.storage ?? null;
  const startup = data?.startup ?? null;

  const memoryUsagePercent = stats?.memory.usagePercent ?? 0;
  const diskUsagePercent = stats?.disk.usagePercent ?? 0;
  const networkTotal = stats ? stats.network.sent + stats.network.received : 0;

  const storageOverview = useMemo(() => {
    if (!storage) {
      return {
        statusLabel: "待接入",
        summaryLabel: "暂无扫描结果",
        freshnessLabel: "尚未接入真实扫描快照",
      };
    }

    if (storage.mode === "cached") {
      return {
        statusLabel: "缓存快照",
        summaryLabel: `${storage.summary.existingTargets}/${storage.summary.scannedTargets} 个目标已扫描`,
        freshnessLabel: `${formatDuration(storage.ageMs)}前生成，可手动重扫`,
      };
    }

    return {
      statusLabel: "最新快照",
      summaryLabel: `${storage.summary.existingTargets}/${storage.summary.scannedTargets} 个目标已扫描`,
      freshnessLabel: `扫描耗时 ${storage.scanDurationMs}ms`,
    };
  }, [storage]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold text-foreground">资源 / 存储面板</h2>
            <Badge variant="secondary">运行资源已接入</Badge>
            <Badge variant={storage ? "secondary" : "outline"}>{storage ? "存储扫描已接入" : "存储扫描待接入"}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            同一个 /api/admin/resources 现在同时返回运行快照与项目存储扫描；默认读缓存，手动重扫可强制刷新目录占用结果。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void loadResources()} disabled={loading && pendingAction === "runtime"}>
            <RefreshCw className="size-4" />
            {loading && pendingAction === "runtime" ? "刷新中…" : "刷新运行快照"}
          </Button>
          <Button onClick={() => void loadResources({ forceRefresh: true })} disabled={loading && pendingAction === "storage"}>
            <Search className="size-4" />
            {loading && pendingAction === "storage" ? "重扫中…" : "重扫存储"}
          </Button>
        </div>
      </div>

      <section className="space-y-4" aria-labelledby="runtime-resources-heading">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id="runtime-resources-heading" className="text-lg font-semibold text-foreground">
            运行资源
          </h3>
          <Badge variant="secondary">已接入</Badge>
          <Badge variant="outline">/api/admin/resources</Badge>
          {stats?.sampledAt ? <Badge variant="outline">采样 {formatShortDateTime(stats.sampledAt)}</Badge> : null}
        </div>

        {loading && !stats && !error ? (
          <InlineStateCard
            title="正在拉取运行资源快照"
            description="正在从 /api/admin/resources 读取 CPU、内存、磁盘与网络快照。"
            icon={Activity}
          />
        ) : error ? (
          <InlineStateCard
            title="运行资源快照加载失败"
            description={error}
            icon={Activity}
            action={
              <Button variant="outline" onClick={() => void loadResources()}>
                重试加载
              </Button>
            }
          />
        ) : !stats ? (
          <InlineStateCard
            title="暂无运行资源快照"
            description="当前接口未返回 stats 字段；运行资源区块已站住，后续接入后会自动展示最新快照。"
            icon={Activity}
            action={
              <Button variant="outline" onClick={() => void loadResources()}>
                重新拉取
              </Button>
            }
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              icon={Cpu}
              title="CPU 使用率"
              value={`${stats.cpu.usage.toFixed(1)}%`}
              description={`${stats.cpu.cores} 核心`}
              ratio={Math.min(stats.cpu.usage, 100)}
              ratioLabel="CPU 负载"
              accent="blue"
            />
            <MetricCard
              icon={Activity}
              title="内存使用"
              value={`${memoryUsagePercent.toFixed(1)}%`}
              description={`${formatBytes(stats.memory.used)} / ${formatBytes(stats.memory.total)}`}
              ratio={Math.min(memoryUsagePercent, 100)}
              ratioLabel="内存占用"
              accent="violet"
            />
            <MetricCard
              icon={HardDrive}
              title="磁盘快照"
              value={stats.disk.total > 0 ? `${diskUsagePercent.toFixed(1)}%` : "待接入"}
              description={
                stats.disk.total > 0 ? `${formatBytes(stats.disk.used)} / ${formatBytes(stats.disk.total)}` : "当前 API 暂未返回磁盘统计"
              }
              ratio={stats.disk.total > 0 ? Math.min(diskUsagePercent, 100) : undefined}
              ratioLabel={stats.disk.total > 0 ? "磁盘占用" : undefined}
              accent="emerald"
              badge={stats.disk.total > 0 ? undefined : <Badge variant="outline">未接入</Badge>}
            />
            <MetricCard
              icon={Network}
              title="网络流量"
              value={stats.network.available ? formatBytes(networkTotal) : "待接入"}
              description={
                stats.network.available
                  ? `↑ ${formatBytes(stats.network.sent)} · ↓ ${formatBytes(stats.network.received)}`
                  : "当前运行环境未提供系统级网络字节统计"
              }
              ratio={stats.network.available && networkTotal > 0 ? Math.min((stats.network.sent / networkTotal) * 100, 100) : undefined}
              ratioLabel={stats.network.available ? "发送占比" : undefined}
              accent="amber"
              badge={stats.network.available ? undefined : <Badge variant="outline">未接入</Badge>}
            />
          </div>
        )}
      </section>

      <section className="space-y-4" aria-labelledby="storage-scan-heading">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id="storage-scan-heading" className="text-lg font-semibold text-foreground">
            存储扫描
          </h3>
          <Badge variant={storage ? "secondary" : "outline"}>{storageOverview.statusLabel}</Badge>
          {storage ? <Badge variant="outline">TTL {Math.round(storage.ttlMs / 1000)}s</Badge> : null}
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.9fr)]">
          <Card>
            <CardHeader className="gap-3 md:flex-row md:items-start md:justify-between">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Search className="size-4 text-primary" />
                  存储扫描工作台
                </CardTitle>
                <CardDescription>
                  {storage
                    ? `根目录：${storage.rootPath}`
                    : "等待后端返回项目存储扫描结果。"}
                </CardDescription>
              </div>
              <Button onClick={() => void loadResources({ forceRefresh: true })} disabled={loading && pendingAction === "storage"}>
                {loading && pendingAction === "storage" ? "重扫中…" : "立即重扫"}
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-4">
                <SummaryCard
                  title="扫描目标"
                  value={storage ? `${storage.summary.existingTargets}/${storage.summary.scannedTargets}` : "待接入"}
                  description={storage ? "已存在目标 / 配置目标" : "等待首次扫描"}
                />
                <SummaryCard
                  title="最近扫描"
                  value={storage ? formatShortDateTime(storage.scannedAt) : "待接入"}
                  description={storage ? storageOverview.freshnessLabel : "暂无生成时间"}
                />
                <SummaryCard
                  title="结果摘要"
                  value={storage ? formatBytes(storage.summary.totalBytes) : "待接入"}
                  description={storage ? `${storage.summary.fileCount.toLocaleString()} 文件 · ${storage.summary.directoryCount.toLocaleString()} 目录` : "暂无容量汇总"}
                />
                <SummaryCard
                  title="最大目标"
                  value={storage?.summary.largestTargetLabel ?? "待接入"}
                  description={storage ? formatBytes(storage.summary.largestTargetBytes) : "暂无排行"}
                />
              </div>

              {storage ? (
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-sm text-foreground">
                  <div className="font-medium">{storage.mode === "cached" ? "当前展示缓存快照" : "当前展示最新重扫结果"}</div>
                  <div className="mt-1 text-muted-foreground">
                    {storageOverview.summaryLabel}，{storageOverview.freshnessLabel}。
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
                  等待后端返回真实扫描结构后，这里会展示目录体积、目标状态与最近扫描结果。
                </div>
              )}

              {storage?.targets?.length ? (
                <div className="space-y-3">
                  {storage.targets.map((target) => (
                    <div key={target.id} className="rounded-xl border border-border/70 p-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-sm font-medium text-foreground">{target.label}</div>
                            <Badge variant={target.status === "ready" ? "secondary" : target.status === "missing" ? "outline" : "destructive"}>
                              {target.status === "ready" ? "已扫描" : target.status === "missing" ? "缺失" : "异常"}
                            </Badge>
                            <Badge variant="outline">{target.relativePath}</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">{target.absolutePath}</p>
                        </div>
                        <div className="text-right text-sm text-muted-foreground">
                          <div>{formatBytes(target.totalBytes)}</div>
                          <div>{target.fileCount.toLocaleString()} 文件 · {target.directoryCount.toLocaleString()} 目录</div>
                        </div>
                      </div>

                      {target.error ? <div className="mt-3 text-sm text-destructive">{target.error}</div> : null}

                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span>最近修改：{target.lastModifiedAt ? formatShortDateTime(target.lastModifiedAt) : "—"}</span>
                        {target.largestChildren.length ? (
                          <span>Top 子项：{target.largestChildren.map((child) => `${child.name} ${formatBytes(child.totalBytes)}`).join(" · ")}</span>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Server className="size-4 text-primary" />
                接入状态
              </CardTitle>
              <CardDescription>明确区分当前已经可用的信号、缓存策略与下一步仍待补齐的运维细节。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">已接入</div>
                <StatusRow
                  title="启动恢复报告"
                  description={startup
                    ? `静态交付 ${startup.delivery.staticMode} / compile smoke ${startup.delivery.compileSmokeStatus} / success ${startup.recoveryReport.counts.success} / failed ${startup.recoveryReport.counts.failed}。`
                    : "等待后端返回 startup recovery / delivery summary。"}
                  badge={<Badge variant={startup ? "secondary" : "outline"}>{startup ? "已接入" : "待接入"}</Badge>}
                />
                <StatusRow
                  title="运行资源快照"
                  description={stats?.sampledAt ? `最近采样 ${formatShortDateTime(stats.sampledAt)}，CPU / 内存 / 磁盘 / 网络均来自 /api/admin/resources。` : "已通过 /api/admin/resources 接入系统级 CPU / 内存 / 磁盘 / 网络快照。"}
                  badge={<Badge variant="secondary">已接入</Badge>}
                />
                <StatusRow
                  title="项目目录扫描"
                  description={storage ? `最近扫描 ${formatShortDateTime(storage.scannedAt)}，共命中 ${storage.summary.existingTargets} 个目标。` : "后端尚未返回 storage 字段。"}
                  badge={<Badge variant={storage ? "secondary" : "outline"}>{storage ? "已接入" : "待接入"}</Badge>}
                />
                <StatusRow
                  title="刷新机制"
                  description={storage ? `默认 ${Math.round(storage.ttlMs / 1000)} 秒内读缓存；“重扫存储”会强制刷新一次后端扫描结果。` : "等待接入后端刷新策略。"}
                  badge={<Badge variant={storage ? "secondary" : "outline"}>{storage ? "已接入" : "待接入"}</Badge>}
                />
                <StatusRow
                  title="容量热点"
                  description={storage?.summary.largestTargetLabel ? `${storage.summary.largestTargetLabel} 当前是最大扫描目标，体积 ${formatBytes(storage.summary.largestTargetBytes)}。` : "等待真实扫描结果返回容量排行。"}
                  badge={<Badge variant={storage?.summary.largestTargetLabel ? "secondary" : "outline"}>{storage?.summary.largestTargetLabel ? "已接入" : "待接入"}</Badge>}
                />
              </div>

              <div className="space-y-3">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">待接入</div>
                <StatusRow
                  title="repair / migration 决策链"
                  description={startup?.failures.length
                    ? `当前已有 ${startup.failures.length} 条启动失败记录，但还缺少可直接执行的 repair / migration 操作入口。`
                    : "后续需要把 runtime repair / migration 决策从摘要推进到可执行入口。"}
                  badge={<Badge variant="outline">待接入</Badge>}
                />
                <StatusRow
                  title="异常资源列表"
                  description="按文件级别列出损坏附件、孤儿缓存和可疑大文件，而不止目录汇总。"
                  badge={<Badge variant="outline">待接入</Badge>}
                />
                <StatusRow
                  title="清理建议"
                  description="结合扫描历史给出缓存清理、导出产物回收与附件治理建议。"
                  badge={<Badge variant="outline">待接入</Badge>}
                />
                <StatusRow
                  title="扫描历史队列"
                  description="保留最近多次扫描的时间序列，方便观察容量增长与异常波动。"
                  badge={<Badge variant="outline">待接入</Badge>}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  title,
  value,
  description,
  ratio,
  ratioLabel,
  badge,
  accent,
}: {
  icon: typeof Cpu;
  title: string;
  value: string;
  description: string;
  ratio?: number;
  ratioLabel?: string;
  badge?: ReactNode;
  accent: "blue" | "violet" | "emerald" | "amber";
}) {
  const accentClassName = {
    blue: "border-sky-500/20 bg-sky-500/5",
    violet: "border-violet-500/20 bg-violet-500/5",
    emerald: "border-emerald-500/20 bg-emerald-500/5",
    amber: "border-amber-500/20 bg-amber-500/5",
  }[accent];

  const barClassName = {
    blue: "bg-sky-500",
    violet: "bg-violet-500",
    emerald: "bg-emerald-500",
    amber: "bg-amber-500",
  }[accent];

  return (
    <Card size="sm" className={accentClassName}>
      <CardHeader className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <CardDescription className="flex items-center gap-2">
            <Icon className="size-4 text-primary" />
            {title}
          </CardDescription>
          {badge}
        </div>
        <CardTitle className="text-3xl">{value}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {ratio !== undefined ? (
          <div className="space-y-1.5">
            <div className="h-2 rounded-full bg-muted/80">
              <div className={`h-2 rounded-full ${barClassName}`} style={{ width: `${Math.max(0, Math.min(ratio, 100))}%` }} />
            </div>
            {ratioLabel ? <p className="text-xs text-muted-foreground">{ratioLabel}</p> : null}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">暂未提供百分比数据</p>
        )}
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function SummaryCard({ title, value, description }: { title: string; value: string; description: string }) {
  return (
    <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{title}</div>
      <div className="mt-2 text-2xl font-semibold text-foreground">{value}</div>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function StatusRow({ title, description, badge }: { title: string; description: string; badge: ReactNode }) {
  return (
    <div className="rounded-xl border border-border/70 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="text-sm font-medium text-foreground">{title}</div>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {badge}
      </div>
    </div>
  );
}

function InlineStateCard({
  title,
  description,
  icon: Icon,
  action,
}: {
  title: string;
  description: string;
  icon: typeof Activity;
  action?: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Icon className="size-4 text-primary" />
            {title}
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        {action}
      </CardHeader>
    </Card>
  );
}

function formatShortDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDuration(durationMs: number) {
  if (durationMs < 1_000) return `${durationMs}ms`;
  if (durationMs < 60_000) return `${(durationMs / 1_000).toFixed(1)}s`;
  return `${(durationMs / 60_000).toFixed(1)}m`;
}

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}
