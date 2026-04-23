import { useEffect, useMemo, useState } from "react";
import { FileText, RefreshCw, Search } from "lucide-react";

import { PageEmptyState } from "@/components/layout/PageEmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { fetchJson } from "../../hooks/use-api";

interface AdminLogEntry {
  timestamp?: string;
  level?: string;
  tag?: string;
  message: string;
  raw: string;
  source: "json" | "text";
  narrator?: string;
  requestKind?: string;
  provider?: string;
  model?: string;
  runId?: string;
}

interface AdminLogsSnapshot {
  sourcePath: string;
  exists: boolean;
  refreshedAt: string;
  updatedAt: string | null;
  sizeBytes: number;
  limit: number;
  totalEntries: number;
  refreshHintMs: number;
  entries: AdminLogEntry[];
  filters?: { runId?: string | null };
}

interface LogsTabProps {
  runId?: string;
  onInspectRun?: (runId: string) => void;
  onNavigateSection?: (section: "requests" | "logs" | "resources", options?: { runId?: string }) => void;
  onOpenRun?: (runId: string) => void;
}

const LEVEL_CLASSNAMES: Record<string, string> = {
  error: "text-destructive",
  warn: "text-amber-500",
  info: "text-primary/70",
  debug: "text-muted-foreground/70",
};

export function LogsTab({ runId, onInspectRun, onNavigateSection, onOpenRun }: LogsTabProps = {}) {
  const [snapshot, setSnapshot] = useState<AdminLogsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(200);
  const [query, setQuery] = useState("");

  const loadLogs = async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      const params = new URLSearchParams({ limit: String(limit) });
      if (runId) {
        params.set("runId", runId);
      }
      const data = await fetchJson<AdminLogsSnapshot>(`/api/admin/logs?${params.toString()}`);
      setSnapshot(data);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载日志失败");
      if (!silent) {
        setSnapshot(null);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void loadLogs();
  }, [limit, runId]);

  useEffect(() => {
    const refreshHintMs = snapshot?.refreshHintMs ?? 5_000;
    const timer = window.setInterval(() => {
      void loadLogs({ silent: true });
    }, refreshHintMs);
    return () => window.clearInterval(timer);
  }, [snapshot?.refreshHintMs, limit, runId]);

  const filteredEntries = useMemo(() => {
    if (!snapshot) return [];
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return snapshot.entries;
    return snapshot.entries.filter((entry) => entry.raw.toLowerCase().includes(normalizedQuery) || entry.message.toLowerCase().includes(normalizedQuery));
  }, [query, snapshot]);

  if (loading && !snapshot && !error) {
    return <div className="py-10 text-center text-sm text-muted-foreground">正在加载日志…</div>;
  }

  if (error && !snapshot) {
    return (
      <PageEmptyState
        title="日志加载失败"
        description={error}
        action={
          <Button variant="outline" onClick={() => void loadLogs()}>
            重试
          </Button>
        }
      />
    );
  }

  if (!snapshot) {
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold text-foreground">运行日志</h2>
            <Badge variant={snapshot.exists ? "secondary" : "outline"}>{snapshot.exists ? "已接入" : "日志文件缺失"}</Badge>
            <Badge variant="outline">轮询 {Math.round(snapshot.refreshHintMs / 1000)}s</Badge>
            {runId ? <Badge variant="secondary">当前聚焦 {runId}</Badge> : null}
          </div>
          <p className="text-sm text-muted-foreground">直接读取真实日志文件尾部，不填充任何假数据；支持手动刷新与本地过滤。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={limit}
            onChange={(event) => setLimit(Number(event.target.value))}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
          >
            <option value={100}>100 条</option>
            <option value={200}>200 条</option>
            <option value={500}>500 条</option>
          </select>
          <Button variant="outline" onClick={() => void loadLogs({ silent: true })} disabled={refreshing}>
            <RefreshCw className="size-4" />
            {refreshing ? "刷新中…" : "刷新日志"}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <SummaryCard title="日志文件" value={snapshot.exists ? "已找到" : "未找到"} description={snapshot.sourcePath} />
        <SummaryCard title="文件大小" value={formatBytes(snapshot.sizeBytes)} description={snapshot.updatedAt ? `最近更新 ${formatDateTime(snapshot.updatedAt)}` : "暂无更新时间"} />
        <SummaryCard title="总行数" value={snapshot.totalEntries.toLocaleString()} description="日志文件实际记录数" />
        <SummaryCard title="当前展示" value={filteredEntries.length.toLocaleString()} description={`最近 ${snapshot.limit} 条中的筛选结果`} />
      </div>

      <Card>
        <CardHeader className="gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileText className="size-4 text-primary" />
              日志 Tail
            </CardTitle>
            <CardDescription>
              {snapshot.exists ? `最近刷新 ${formatDateTime(snapshot.refreshedAt)}，日志源 ${snapshot.sourcePath}` : "当前没有找到日志文件；这里会在日志出现后自动接入。"}
            </CardDescription>
            {runId ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="outline" size="xs" onClick={() => onInspectRun?.(runId)} aria-label={`定位运行 ${runId}`}>
                  定位运行 {runId}
                </Button>
                <Button variant="outline" size="xs" onClick={() => onNavigateSection?.("requests", { runId })} aria-label={`查看请求 ${runId}`}>
                  查看请求 {runId}
                </Button>
              </div>
            ) : null}
          </div>
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="筛选 message / raw 文本" className="pl-9" />
          </div>
        </CardHeader>
        <CardContent>
          {!snapshot.exists ? (
            <PageEmptyState title="暂无日志文件" description="后端当前没有检测到 novelfork.log，后续一旦产生真实日志，这里会自动展示尾部内容。" />
          ) : filteredEntries.length === 0 ? (
            <PageEmptyState title="没有匹配日志" description={query ? "当前筛选条件没有命中任何日志行。" : "日志文件存在，但当前展示范围内没有可解析内容。"} />
          ) : (
            <div className="max-h-[620px] overflow-y-auto rounded-xl border border-border/70 bg-muted/20 p-3">
              <div className="space-y-2 font-mono text-sm">
                {filteredEntries.map((entry, index) => (
                  <div key={`${entry.raw}-${index}`} className="rounded-lg border border-border/50 bg-background/80 p-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      {entry.timestamp ? <span className="text-muted-foreground">{formatDateTime(entry.timestamp)}</span> : null}
                      {entry.level ? <span className={LEVEL_CLASSNAMES[entry.level] ?? "text-muted-foreground"}>{entry.level.toUpperCase()}</span> : null}
                      {entry.tag ? <Badge variant="outline">{entry.tag}</Badge> : null}
                      <Badge variant={entry.source === "json" ? "secondary" : "outline"}>{entry.source === "json" ? "JSON" : "文本"}</Badge>
                    </div>
                    {(entry.narrator || entry.requestKind || entry.provider || entry.model || entry.runId) ? (
                      <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                        {entry.narrator ? <Badge variant="outline">{entry.narrator}</Badge> : null}
                        {entry.requestKind ? <Badge variant="outline">{entry.requestKind}</Badge> : null}
                        {entry.provider ? <Badge variant="secondary">{entry.provider}</Badge> : null}
                        {entry.model ? <Badge variant="outline">{entry.model}</Badge> : null}
                        {entry.runId ? <Badge variant="outline">{entry.runId}</Badge> : null}
                        {entry.runId && onOpenRun ? (
                          <Button type="button" variant="outline" size="xs" onClick={() => onOpenRun(entry.runId!)}>
                            打开 Pipeline
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="mt-2 whitespace-pre-wrap break-all text-foreground">{entry.message}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
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

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("zh-CN");
}

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, index)).toFixed(2)} ${units[index]}`;
}
