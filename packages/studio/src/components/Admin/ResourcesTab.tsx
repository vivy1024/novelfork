/**
 * 资源监控标签页
 */

import { useEffect, useState, type ReactNode } from "react";
import { Activity, Cpu, HardDrive, Network, Search, Server } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchJson } from "../../hooks/use-api";

interface ResourceStats {
  cpu: { usage: number; cores: number };
  memory: { used: number; total: number };
  disk: { used: number; total: number };
  network: { sent: number; received: number };
}

interface ResourcesResponse {
  stats?: ResourceStats | null;
}

export function ResourcesTab() {
  const [stats, setStats] = useState<ResourceStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanRequestCount, setScanRequestCount] = useState(0);
  const [lastScanRequestLabel, setLastScanRequestLabel] = useState<string | null>(null);
  const [scanFeedback, setScanFeedback] = useState<string | null>(null);

  useEffect(() => {
    void loadResources();
  }, []);

  const loadResources = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJson<ResourcesResponse>("/api/admin/resources");
      setStats(data.stats ?? null);
    } catch (loadError) {
      setStats(null);
      setError(loadError instanceof Error ? loadError.message : "加载运行资源快照失败");
    } finally {
      setLoading(false);
    }
  };

  const requestStorageScan = () => {
    const now = new Date();
    setScanRequestCount((current) => current + 1);
    setLastScanRequestLabel(
      new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(now),
    );
    setScanFeedback("已记录一次占位扫描请求。后续接入真实任务后，这里会展示扫描进度、结果摘要与异常资源列表。");
  };

  const memoryUsagePercent = stats && stats.memory.total > 0 ? (stats.memory.used / stats.memory.total) * 100 : 0;
  const diskUsagePercent = stats && stats.disk.total > 0 ? (stats.disk.used / stats.disk.total) * 100 : 0;
  const networkTotal = stats ? stats.network.sent + stats.network.received : 0;
  const diskSnapshot =
    stats && stats.disk.total > 0 ? `${formatBytes(stats.disk.used)} / ${formatBytes(stats.disk.total)}` : "待接入";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold text-foreground">资源 / 存储面板</h2>
            <Badge variant="secondary">运行资源已接入</Badge>
            <Badge variant="outline">存储扫描待接入</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            在现有 /api/admin/resources 快照之上，先把“运行资源 + 存储扫描”双区块结构站住；后续再逐步补齐真实扫描链路。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void loadResources()} disabled={loading}>
            {loading ? "刷新中…" : "刷新运行快照"}
          </Button>
          <Button onClick={requestStorageScan}>启动存储扫描（占位）</Button>
        </div>
      </div>

      <section className="space-y-4" aria-labelledby="runtime-resources-heading">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id="runtime-resources-heading" className="text-lg font-semibold text-foreground">
            运行资源
          </h3>
          <Badge variant="secondary">已接入</Badge>
          <Badge variant="outline">/api/admin/resources</Badge>
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
            action={<Button variant="outline" onClick={() => void loadResources()}>重试加载</Button>}
          />
        ) : !stats ? (
          <InlineStateCard
            title="暂无运行资源快照"
            description="当前接口未返回 stats 字段；运行资源区块已站住，后续接入后会自动展示最新快照。"
            icon={Activity}
            action={<Button variant="outline" onClick={() => void loadResources()}>重新拉取</Button>}
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
              value={formatBytes(networkTotal)}
              description={stats ? `↑ ${formatBytes(stats.network.sent)} · ↓ ${formatBytes(stats.network.received)}` : "暂无数据"}
              ratio={networkTotal > 0 ? Math.min((stats.network.sent / networkTotal) * 100, 100) : undefined}
              ratioLabel="发送占比"
              accent="amber"
            />
          </div>
        )}
      </section>

      <section className="space-y-4" aria-labelledby="storage-scan-heading">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id="storage-scan-heading" className="text-lg font-semibold text-foreground">
            存储扫描
          </h3>
          <Badge variant="outline">待接入</Badge>
          <Badge variant="outline">结构已预留</Badge>
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
                  先把扫描动作、状态位与结果槽位放进管理中心；当前点击按钮只记录一次前端占位请求，不依赖新增后端接口。
                </CardDescription>
              </div>
              <Button onClick={requestStorageScan}>立即扫描（占位）</Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <SummaryCard
                  title="扫描请求"
                  value={scanRequestCount > 0 ? `${scanRequestCount} 次` : "未启动"}
                  description={scanRequestCount > 0 ? "已记录占位扫描动作" : "等待首次手动扫描"}
                />
                <SummaryCard
                  title="最近请求"
                  value={lastScanRequestLabel ?? "待接入"}
                  description={lastScanRequestLabel ? "已写入占位时间戳" : "待接入真实任务时间"}
                />
                <SummaryCard
                  title="结果摘要"
                  value="待接入"
                  description="目录体积、文件数、异常资源将在真实扫描后填充"
                />
              </div>

              {scanFeedback && (
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-sm text-foreground">
                  {scanFeedback}
                </div>
              )}

              <div className="rounded-xl border border-dashed border-border/70 p-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">预留结果区</div>
                <p className="text-sm text-muted-foreground">
                  后续接入后，这里可展示：项目目录占用排行、附件/素材统计、缓存/导出体积、异常孤儿文件、最近扫描历史。
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Server className="size-4 text-primary" />
                接入状态
              </CardTitle>
              <CardDescription>明确区分当前已经可用的信号与后续待补的真实存储数据。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">已接入</div>
                <StatusRow
                  title="运行资源快照"
                  description="已通过 /api/admin/resources 接入系统级 CPU / 内存 / 磁盘 / 网络快照。"
                  badge={<Badge variant="secondary">已接入</Badge>}
                />
                <StatusRow
                  title="磁盘占用快照"
                  description={`当前可复用的磁盘快照：${diskSnapshot}`}
                  badge={<Badge variant={stats?.disk.total ? "secondary" : "outline"}>{stats?.disk.total ? "已接入" : "部分接入"}</Badge>}
                />
                <StatusRow
                  title="手动刷新动作"
                  description="已支持手动刷新运行快照，后续可与扫描任务串联。"
                  badge={<Badge variant="secondary">已接入</Badge>}
                />
              </div>

              <div className="space-y-3">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">待接入</div>
                <StatusRow
                  title="项目目录扫描"
                  description="统计书籍目录、章节文件与工作区实际占用。"
                  badge={<Badge variant="outline">待接入</Badge>}
                />
                <StatusRow
                  title="素材 / 附件库统计"
                  description="汇总图片、参考资料、导出产物与缓存目录规模。"
                  badge={<Badge variant="outline">待接入</Badge>}
                />
                <StatusRow
                  title="扫描结果列表"
                  description="展示最近扫描时间、耗时、异常项与清理建议。"
                  badge={<Badge variant="outline">待接入</Badge>}
                />
              </div>

              <div className="rounded-xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
                当前阶段优先把面板结构与动作文案站住，等后端提供真实字段后，再把这一区替换成实际扫描结果与历史记录。
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
            {ratioLabel && <p className="text-xs text-muted-foreground">{ratioLabel}</p>}
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

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}
