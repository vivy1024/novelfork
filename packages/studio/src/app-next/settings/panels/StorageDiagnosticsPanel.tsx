import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Archive,
  Boxes,
  Database,
  FolderOpen,
  HardDrive,
  Loader2,
  RefreshCw,
  ScanSearch,
  Trash2,
} from "lucide-react";

import {
  createStorageClient,
  RUNTIME_STORAGE_SCAN_PATH,
  type DatabaseCleanupPreviewResult,
  type DatabaseCleanupTarget,
  type DatabaseStorageBreakdown,
  type DatabaseStorageCategorySummary,
  type DatabaseStorageTableSummary,
  type StorageCategoryResult,
  type StorageCleanupTarget,
  type StorageScanResult,
} from "@/app-next/runtime-admin";
import { runtimeFetch } from "@/app-next/runtime/auth";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { notify } from "@/lib/notify";

const storageClient = createStorageClient();

const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  database: "Runtime 数据库",
  uploads: "上传文件",
  shares: "共享文件",
  worktrees: "工作树",
  containers: "容器镜像",
};

const CATEGORY_ORDER = ["database", "uploads", "shares", "worktrees", "containers"];

const DATABASE_USAGE_CATEGORY_LABELS: Readonly<Record<string, string>> = {
  sessions: "会话",
  apiRequests: "API 请求",
  projects: "项目",
  runtime: "运行时",
  users: "用户",
  search: "搜索索引",
  gateway: "网关",
  benchmarks: "性能基准",
  internal: "内部",
  free: "可回收空间",
  other: "其他",
};

const FILE_TARGETS: readonly {
  target: StorageCleanupTarget;
  label: string;
  description: string;
  icon: typeof FolderOpen;
}[] = [
  { target: "uploads", label: "孤立上传文件", description: "删除已不再被 Runtime 叙述者或图片消息引用的上传目录。", icon: FolderOpen },
  { target: "shares", label: "全部共享文件", description: "删除所有已生成的共享目录，现有共享链接将失效。", icon: Archive },
  { target: "worktrees", label: "孤立工作树", description: "删除已不再关联活动章节的工作树。", icon: HardDrive },
  { target: "containers", label: "悬空容器镜像", description: "执行 Runtime 提供的安全 Podman 镜像清理，不会删除主动保留的镜像。", icon: Boxes },
];

const DATABASE_TARGETS: readonly {
  value: DatabaseCleanupTarget;
  label: string;
  description: string;
  defaultDays?: number;
}[] = [
  { value: "archivedSessions", label: "已归档会话", description: "删除已归档的叙述者树及其关联记录。" },
  { value: "staleSessions", label: "过期会话", description: "删除超过保留期限且长期无活动的叙述者树。", defaultDays: 90 },
  { value: "apiRequestDumps", label: "API 请求转储", description: "清除超过保留期限的原始 API 请求转储。", defaultDays: 30 },
];

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDateTime(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function errorMessage(error: unknown, operation: string): string {
  const status = typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status?: unknown }).status)
    : undefined;
  const message = error instanceof Error ? error.message : String(error);
  if (status === 403) {
    return `403：需要 Runtime 管理员权限才能${operation}。${message}`;
  }
  return status ? `${status}：${message}` : message;
}

function getDatabaseBreakdown(category: StorageCategoryResult | undefined): DatabaseStorageBreakdown | null {
  const details = category?.details as Partial<DatabaseStorageBreakdown> | undefined;
  if (!details) return null;
  if (
    typeof details.mainBytes !== "number" ||
    typeof details.walBytes !== "number" ||
    typeof details.shmBytes !== "number" ||
    typeof details.cleanupCandidates !== "object"
  ) {
    return null;
  }
  return details as unknown as DatabaseStorageBreakdown;
}

function detailsSummary(category: StorageCategoryResult): string {
  const details = category.details;
  if (!details) return "没有更多扫描明细。";
  if (category.key === "uploads") {
    return `${Number(details.narratorDirs ?? 0)} 个叙述者目录 · 头像 ${formatBytes(Number(details.avatarBytes ?? 0))}`;
  }
  if (category.key === "shares") return `${Number(details.shareCount ?? 0)} 个共享目录`;
  if (category.key === "worktrees") return `${Number(details.worktreeCount ?? 0)} 个工作树`;
  if (category.key === "containers") return details.available === false ? "Podman 不可用" : "Runtime 返回的 Podman 存储占用";
  if (category.key === "database") {
    return `主库 ${formatBytes(Number(details.mainBytes ?? 0))} · WAL ${formatBytes(Number(details.walBytes ?? 0))} · 可回收 ${formatBytes(Number(details.freelistBytes ?? 0))}`;
  }
  return `${Object.keys(details).length} 项明细`;
}

function storageProgressLabel(message: string): string {
  const labels: Readonly<Record<string, string>> = {
    scanning_database: "正在扫描数据库…",
    scanning_uploads: "正在扫描上传文件…",
    scanning_shares: "正在扫描共享文件…",
    scanning_worktrees: "正在扫描工作树…",
    scanning_containers: "正在扫描容器存储…",
  };
  return labels[message] ?? message;
}

interface StorageScanHandlers {
  readonly signal?: AbortSignal;
  readonly onProgress: (message: string) => void;
  readonly onCategory: (category: StorageCategoryResult) => void;
}

/** Fetch-based SSE transport keeps the Runtime bearer token in an Authorization header, never in the URL. */
async function scanStorageWithRuntimeAuth(handlers: StorageScanHandlers): Promise<StorageScanResult> {
  const response = await runtimeFetch(RUNTIME_STORAGE_SCAN_PATH, {
    headers: { Accept: "text/event-stream" },
    signal: handlers.signal,
  });
  if (!response.ok) {
    const text = await response.text();
    let message = text || `${response.status} ${response.statusText}`;
    try {
      const parsed = JSON.parse(text) as { error?: string | { message?: string }; message?: string };
      message = typeof parsed.error === "string"
        ? parsed.error
        : parsed.error?.message ?? parsed.message ?? message;
    } catch {
      // Keep the plain-text Runtime error.
    }
    throw Object.assign(new Error(message), { status: response.status });
  }
  if (!response.body) throw new Error("Runtime 存储扫描未返回事件流。");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed: StorageScanResult | null = null;

  const consumeBlock = (block: string) => {
    let event = "message";
    const dataLines: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (dataLines.length === 0) return;
    const data = JSON.parse(dataLines.join("\n")) as unknown;
    if (event === "progress") {
      handlers.onProgress(storageProgressLabel(String((data as { message?: unknown }).message ?? "正在扫描 Runtime 存储…")));
    } else if (event === "category") {
      handlers.onCategory(data as StorageCategoryResult);
    } else if (event === "complete") {
      completed = data as StorageScanResult;
    } else if (event === "error") {
      throw new Error(String((data as { error?: unknown }).error ?? "Runtime 存储扫描失败。"));
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) consumeBlock(block);
    if (done) break;
  }
  if (buffer.trim()) consumeBlock(buffer);
  if (!completed) throw new Error("Runtime 存储扫描结束时未收到完成事件。");
  return completed;
}

export function StorageDiagnosticsPanel() {
  const [scan, setScan] = useState<StorageScanResult | null>(null);
  const [cacheLoading, setCacheLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cleaningTarget, setCleaningTarget] = useState<StorageCleanupTarget | null>(null);
  const [databaseTarget, setDatabaseTarget] = useState<DatabaseCleanupTarget>("staleSessions");
  const [olderThanDays, setOlderThanDays] = useState("90");
  const [preview, setPreview] = useState<DatabaseCleanupPreviewResult | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [databaseCleaning, setDatabaseCleaning] = useState(false);
  const [vacuuming, setVacuuming] = useState(false);
  const [confirmCleanup, setConfirmCleanup] = useState<StorageCleanupTarget | null>(null);
  const [confirmVacuum, setConfirmVacuum] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const loadCached = useCallback(async () => {
    setCacheLoading(true);
    setError(null);
    try {
      const result = await storageClient.cached();
      setScan(result.cached ? result.data : null);
    } catch (caught) {
      setError(errorMessage(caught, "读取存储诊断"));
    } finally {
      setCacheLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCached();
    return () => abortRef.current?.abort();
  }, [loadCached]);

  const runScan = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setScanning(true);
    setScanProgress("正在启动经过身份验证的 Runtime 存储扫描…");
    setError(null);
    setScan({ categories: [], totalBytes: 0, scannedAt: Date.now() });
    try {
      const result = await scanStorageWithRuntimeAuth({
        signal: controller.signal,
        onProgress: setScanProgress,
        onCategory: (category) => {
          setScan((current) => {
            const categories = [...(current?.categories ?? []).filter((item) => item.key !== category.key), category];
            return { categories, totalBytes: categories.reduce((sum, item) => sum + item.sizeBytes, 0), scannedAt: current?.scannedAt ?? Date.now() };
          });
        },
      });
      setScan(result);
      setScanProgress("扫描完成");
    } catch (caught) {
      if (!controller.signal.aborted) setError(errorMessage(caught, "扫描存储"));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setScanning(false);
    }
  };

  const executeCleanupFileTarget = async (target: StorageCleanupTarget) => {
    setCleaningTarget(target);
    setError(null);
    try {
      const result = await storageClient.cleanup(target);
      const description = result.freedBytes !== undefined
        ? `已删除 ${result.removed ?? 0} 项 · 释放 ${formatBytes(result.freedBytes)}`
        : result.output || (result.success === false ? "Runtime 报告无法执行清理。" : "Runtime 清理已完成。");
      if (result.success === false) notify.error("清理未完成", { description });
      else notify.success("清理完成", { description });
      await loadCached();
    } catch (caught) {
      const targetLabel = FILE_TARGETS.find((item) => item.target === target)?.label ?? "指定文件";
      const message = errorMessage(caught, `清理${targetLabel}`);
      setError(message);
      notify.error("清理失败", { description: message });
    } finally {
      setCleaningTarget(null);
    }
  };

  const handleCleanupConfirmed = () => {
    if (!confirmCleanup) return;
    const target = confirmCleanup;
    setConfirmCleanup(null);
    void executeCleanupFileTarget(target);
  };

  const selectedDatabaseTarget = useMemo(
    () => DATABASE_TARGETS.find((item) => item.value === databaseTarget) ?? DATABASE_TARGETS[1],
    [databaseTarget],
  );

  const databaseInput = () => {
    const days = Number.parseInt(olderThanDays, 10);
    return {
      target: databaseTarget,
      ...(selectedDatabaseTarget.defaultDays !== undefined && Number.isFinite(days) && days > 0 ? { olderThanDays: days } : {}),
    };
  };

  const openPreview = async () => {
    setPreviewing(true);
    setError(null);
    try {
      const result = await storageClient.previewDatabase({ ...databaseInput(), sampleLimit: 10 });
      setPreview(result);
      setPreviewOpen(true);
    } catch (caught) {
      setError(errorMessage(caught, "预览数据库清理"));
    } finally {
      setPreviewing(false);
    }
  };

  const executeDatabaseCleanup = async () => {
    setDatabaseCleaning(true);
    setError(null);
    try {
      const result = await storageClient.cleanupDatabase(databaseInput());
      notify.success("数据库清理完成", {
        description: result.changed ? `已释放 ${formatBytes(result.freedBytes)}` : "没有符合条件的数据库记录发生变化。",
      });
      setPreviewOpen(false);
      setPreview(null);
      await loadCached();
    } catch (caught) {
      const message = errorMessage(caught, "清理 Runtime 数据库");
      setError(message);
      notify.error("数据库清理失败", { description: message });
    } finally {
      setDatabaseCleaning(false);
    }
  };

  const executeVacuum = async () => {
    setVacuuming(true);
    setError(null);
    try {
      const result = await storageClient.vacuumDatabase();
      notify.success("数据库维护完成", {
        description: `已释放 ${formatBytes(result.freedBytes)}（回收前可用 ${formatBytes(result.freelistBeforeBytes)}），耗时 ${(result.durationMs / 1000).toFixed(1)} 秒`,
      });
      await loadCached();
    } catch (caught) {
      const message = errorMessage(caught, "整理 Runtime 数据库");
      setError(message);
      notify.error("数据库维护失败", { description: message });
    } finally {
      setVacuuming(false);
    }
  };

  const handleVacuumConfirmed = () => {
    setConfirmVacuum(false);
    void executeVacuum();
  };

  // Database breakdown from scan
  const databaseCategory = scan?.categories.find((c) => c.key === "database");
  const databaseDetails = getDatabaseBreakdown(databaseCategory);
  const databaseUnreleasedBytes = (databaseDetails?.freelistBytes ?? 0) + (databaseDetails?.walBytes ?? 0);
  const canVacuum = Boolean(databaseDetails) && databaseUnreleasedBytes > 0;
  const databaseReadFailures = databaseDetails?.readFailures;
  const databaseReadFailureCount = databaseReadFailures?.tableCount ?? 0;
  const databaseReadFailureNames = (databaseReadFailures?.tableNames ?? []).slice(0, 5).join(", ");
  const databaseUsageCategories: DatabaseStorageCategorySummary[] = (databaseDetails?.categories ?? []).filter((c) => c.totalBytes > 0);
  const databaseTopTables: DatabaseStorageTableSummary[] = (databaseDetails?.topTables ?? []).filter((t) => t.totalBytes > 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-foreground">存储诊断</h2>
          <p className="mt-1 text-sm text-muted-foreground">使用 Runtime 原生存储扫描、文件清理目标和数据库维护能力。</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void loadCached()} disabled={cacheLoading || scanning}>
            <RefreshCw className={cacheLoading ? "animate-spin" : ""} />
            刷新缓存
          </Button>
          <Button onClick={() => void runScan()} disabled={scanning}>
            {scanning ? <Loader2 className="animate-spin" /> : <ScanSearch />}
            {scanning ? "扫描中…" : "执行实时扫描"}
          </Button>
        </div>
      </div>

      {error && (
        <Alert className="border-destructive/40 bg-destructive/5">
          <AlertTitle>Runtime 存储请求失败</AlertTitle>
          <AlertDescription className="text-destructive">{error}</AlertDescription>
        </Alert>
      )}

      {scanning && (
        <Alert>
          <AlertTitle>经过身份验证的 SSE 扫描正在进行</AlertTitle>
          <AlertDescription>{scanProgress}</AlertDescription>
        </Alert>
      )}

      {/* Summary cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><HardDrive className="size-4 text-primary" />缓存总占用</CardTitle>
            <CardDescription>{scan ? `扫描时间：${formatDateTime(scan.scannedAt)}` : "当前没有未过期的 Runtime 扫描缓存。"}</CardDescription>
          </CardHeader>
          <CardContent className="font-mono text-2xl font-semibold tabular-nums">{scan ? formatBytes(scan.totalBytes) : "—"}</CardContent>
        </Card>
        {CATEGORY_ORDER.map((key) => {
          const category = scan?.categories.find((c) => c.key === key);
          if (!category) return null;
          return (
            <Card key={key}>
              <CardHeader>
                <CardTitle>{CATEGORY_LABELS[key] ?? key}</CardTitle>
                <CardDescription>{detailsSummary(category)}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="font-mono text-xl font-semibold tabular-nums">{formatBytes(category.sizeBytes)}</div>
                {scan && scan.totalBytes > 0 && (
                  <Progress value={(category.sizeBytes / scan.totalBytes) * 100} className="mt-2" />
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {!cacheLoading && !scan && !error && (
        <Alert>
          <AlertTitle>没有可用的扫描缓存</AlertTitle>
          <AlertDescription>Runtime 缓存会在五分钟后过期。请执行实时扫描生成缓存，或在其他管理员完成扫描后刷新缓存。</AlertDescription>
        </Alert>
      )}

      {/* Database detail breakdown */}
      {databaseDetails && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Database className="size-4 text-primary" />数据库存储明细</CardTitle>
            <CardDescription>
              主库 {formatBytes(databaseDetails.mainBytes)} · WAL {formatBytes(databaseDetails.walBytes)} · SHM {formatBytes(databaseDetails.shmBytes)}
              {databaseDetails.scanMode && <Badge variant="outline" className="ml-2">{databaseDetails.scanMode === "dbstat" ? "精确扫描" : "近似估算"}</Badge>}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {databaseReadFailureCount > 0 && (
              <Alert className="border-yellow-500/40 bg-yellow-500/5">
                <AlertTriangle className="mb-2 size-4 text-yellow-600" />
                <AlertTitle>扫描报告不完整</AlertTitle>
                <AlertDescription>
                  {databaseReadFailureNames
                    ? `${databaseReadFailureCount} 张表因锁竞争未能测量（${databaseReadFailureNames}），报告中的零值表示"未知"而非"为空"。`
                    : `${databaseReadFailureCount} 张表因锁竞争未能测量，报告中的零值表示"未知"而非"为空"。`}
                </AlertDescription>
              </Alert>
            )}

            {databaseDetails.objectBytes != null && (
              <p className="text-sm text-muted-foreground">
                对象数据 {formatBytes(databaseDetails.objectBytes)} · 可回收空间 {formatBytes(databaseDetails.freelistBytes ?? 0)}
              </p>
            )}

            {databaseUsageCategories.length > 0 && (
              <div className="flex flex-col gap-2">
                <h4 className="text-sm font-medium text-foreground">按类别占用</h4>
                <div className="grid gap-2 sm:grid-cols-2">
                  {databaseUsageCategories.map((cat) => (
                    <div key={cat.key} className="rounded-lg border border-border p-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{DATABASE_USAGE_CATEGORY_LABELS[cat.key] ?? cat.key}</span>
                        <Badge variant="secondary">{formatBytes(cat.totalBytes)}</Badge>
                      </div>
                      {cat.key !== "free" && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {cat.tableCount} 张表 · {cat.rowCount} 行 · 索引 {formatBytes(cat.indexBytes)}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {databaseTopTables.length > 0 && (
              <p className="text-xs text-muted-foreground">
                占用最大的表：{databaseTopTables.slice(0, 5).map((t) => `${t.name} ${formatBytes(t.totalBytes)}`).join(" · ")}
              </p>
            )}

            {/* Cleanup candidates from database breakdown */}
            {databaseDetails.cleanupCandidates && (
              <div className="flex flex-col gap-2">
                <h4 className="text-sm font-medium text-foreground">可清理候选</h4>
                {([
                  { target: "archivedSessions" as const, label: "已归档会话", summary: databaseDetails.cleanupCandidates.archivedSessions },
                  { target: "staleSessions" as const, label: "过期会话", summary: databaseDetails.cleanupCandidates.staleSessions },
                  { target: "apiRequestDumps" as const, label: "API 请求转储", summary: databaseDetails.cleanupCandidates.apiRequestDumps },
                ]).map((row) => (
                  <div key={row.target} className="rounded-lg border border-border p-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{row.label}</span>
                          <Badge variant="secondary">{formatBytes(row.summary.approxBytes)}</Badge>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                          <span>{row.target === "apiRequestDumps" ? `${row.summary.count} 条请求` : `${row.summary.count} 个会话`}</span>
                          {row.summary.oldestAt && <span>最早 {formatDateTime(row.summary.oldestAt)}</span>}
                          {row.summary.blockedCount > 0 && <span className="text-yellow-600">{row.summary.blockedCount} 个被阻止</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* File cleanup targets */}
      <Card>
        <CardHeader>
          <CardTitle>文件清理目标</CardTitle>
          <CardDescription>每项操作都会携带明确目标调用 Runtime 清理接口，不使用笼统的一键清理。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {FILE_TARGETS.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.target} className="rounded-lg border border-border p-3">
                <div className="flex items-start gap-3">
                  <Icon className="mt-0.5 size-4 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-foreground">{item.label}</div>
                    <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
                    <Button className="mt-3" size="sm" variant="outline" onClick={() => setConfirmCleanup(item.target)} disabled={cleaningTarget !== null}>
                      {cleaningTarget === item.target ? <Loader2 className="animate-spin" /> : <Trash2 />}
                      清理{item.label}
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Database cleanup */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Database className="size-4 text-primary" />数据库清理</CardTitle>
          <CardDescription>执行破坏性清理前，先预览候选项、警告、样本和被阻止的叙述者树。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_auto] md:items-end">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-foreground">清理目标</span>
              <Select value={databaseTarget} onValueChange={(value) => {
                const target = value as DatabaseCleanupTarget;
                const option = DATABASE_TARGETS.find((item) => item.value === target);
                setDatabaseTarget(target);
                setOlderThanDays(option?.defaultDays ? String(option.defaultDays) : "");
              }}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{DATABASE_TARGETS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
              </Select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-foreground">早于多少天</span>
              <Input type="number" min={1} max={3650} value={olderThanDays} onChange={(event) => setOlderThanDays(event.currentTarget.value)} disabled={selectedDatabaseTarget.defaultDays === undefined} />
            </label>
            <Button onClick={() => void openPreview()} disabled={previewing}>
              {previewing ? <Loader2 className="animate-spin" /> : <ScanSearch />}
              预览清理
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{selectedDatabaseTarget.description}</p>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
            <div>
              <div className="font-medium text-foreground">SQLite VACUUM 与空间整理</div>
              <p className="mt-1 text-xs text-muted-foreground">SQLite 重建数据库文件并为 WAL 执行检查点时，Runtime 数据库操作可能会暂时停顿。</p>
            </div>
            <Button variant="outline" onClick={() => setConfirmVacuum(true)} disabled={vacuuming || (databaseDetails != null && !canVacuum)}>
              {vacuuming ? <Loader2 className="animate-spin" /> : <Database />}
              {vacuuming ? "维护中…" : "整理数据库空间"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Database cleanup preview dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>数据库清理预览</DialogTitle>
            <DialogDescription>请仔细检查 Runtime 返回的结果。执行清理时会使用此处显示的同一目标和保留期限。</DialogDescription>
          </DialogHeader>
          {preview && (
            <div className="flex flex-col gap-4 text-sm">
              {preview.warningCodes.includes("deletesUsageHistory") && (
                <Alert className="border-destructive/40 bg-destructive/5">
                  <AlertTriangle className="mb-2 size-4 text-destructive" />
                  <AlertTitle>使用历史将被删除</AlertTitle>
                  <AlertDescription>此清理会删除"使用历史"面板依赖的 API 请求记录，而不只是可丢弃文件。</AlertDescription>
                </Alert>
              )}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <PreviewMetric label="预计占用" value={formatBytes(preview.approxBytes)} />
                <PreviewMetric label="叙述者" value={preview.counts.narrators} />
                <PreviewMetric label="消息" value={preview.counts.messages} />
                <PreviewMetric label="API 请求" value={preview.counts.apiRequests} />
                <PreviewMetric label="已清除转储" value={preview.counts.dumpsCleared} />
                <PreviewMetric label="工具调用" value={preview.counts.toolCalls} />
                <PreviewMetric label="已阻止" value={preview.blockedCount} />
                <PreviewMetric label="最早时间" value={formatDateTime(preview.oldestAt)} />
              </div>
              <div>
                <h3 className="mb-2 font-medium text-foreground">样本</h3>
                {preview.samples.length === 0 ? <p className="text-muted-foreground">没有符合条件的样本。</p> : (
                  <div className="flex flex-col gap-2">
                    {preview.samples.map((sample) => (
                      <div key={sample.id} className="rounded-lg border border-border p-2">
                        <div className="flex justify-between gap-3">
                          <span className="truncate font-medium">{sample.type === "narrator" ? sample.title || sample.id : sample.chapterTitle || sample.narratorTitle || sample.id}</span>
                          <span className="shrink-0 font-mono text-xs text-muted-foreground">{formatBytes(sample.approxBytes)}</span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{sample.type === "narrator" ? `${sample.status} · ${sample.messageCount} 条消息 · ${formatDateTime(sample.lastActivityAt)}` : formatDateTime(sample.createdAt)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <h3 className="mb-2 font-medium text-foreground">被阻止的项目</h3>
                {preview.blocked.length === 0 ? <p className="text-muted-foreground">没有被阻止的叙述者树。</p> : (
                  <div className="flex flex-col gap-2">
                    {preview.blocked.map((item) => (
                      <div key={`${item.narratorId}:${item.blockingNarratorId}`} className="rounded-lg border border-border p-2">
                        <div className="font-medium">{item.title || item.narratorId}</div>
                        <p className="mt-1 text-xs text-muted-foreground">被 {item.blockingTitle || item.blockingNarratorId}（{item.blockingStatus}）阻止 · 原因：{item.reasonCode}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewOpen(false)} disabled={databaseCleaning}>取消</Button>
            <Button variant="destructive" onClick={() => void executeDatabaseCleanup()} disabled={!preview || databaseCleaning}>
              {databaseCleaning ? <Loader2 className="animate-spin" /> : <Trash2 />}
              执行清理
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* File cleanup confirmation dialog */}
      <Dialog open={confirmCleanup !== null} onOpenChange={(open) => { if (!open) setConfirmCleanup(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认清理</DialogTitle>
            <DialogDescription>
              即将清理「{FILE_TARGETS.find((t) => t.target === confirmCleanup)?.label ?? ""}」。此操作不可撤销，确定继续吗？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmCleanup(null)}>取消</Button>
            <Button variant="destructive" onClick={handleCleanupConfirmed}>
              <Trash2 />确认清理
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* VACUUM confirmation dialog */}
      <Dialog open={confirmVacuum} onOpenChange={setConfirmVacuum}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认数据库维护</DialogTitle>
            <DialogDescription>
              SQLite VACUUM 会重建数据库文件并执行 WAL 检查点。在此期间 Runtime 数据库操作会暂时停顿。确定继续吗？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmVacuum(false)}>取消</Button>
            <Button variant="destructive" onClick={handleVacuumConfirmed}>
              <Database />执行 VACUUM
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PreviewMetric({ label, value }: { readonly label: string; readonly value: string | number }) {
  return (
    <div className="rounded-lg border border-border p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  );
}
