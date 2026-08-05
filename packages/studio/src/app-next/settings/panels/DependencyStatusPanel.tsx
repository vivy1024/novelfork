import { useEffect, useState } from "react";
import { CheckCircle2, CircleMinus, Download, RefreshCw, XCircle } from "lucide-react";

import {
  createDependenciesClient,
  isInstallableDependency,
  type DependencyCheckResult,
  type DependencyInfo,
} from "@/app-next/runtime-admin";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const dependenciesClient = createDependenciesClient();

const DEP_DESCRIPTIONS: Readonly<Record<string, string>> = {
  git: "版本控制，用于项目与章节历史管理",
  rg: "ripgrep，用于高性能全文搜索",
  dtach: "终端后台进程保持（仅 Linux/macOS）",
};

function formatErrorMessage(reason: unknown): string {
  const status =
    typeof reason === "object" && reason !== null && "status" in reason
      ? Number((reason as { status?: unknown }).status)
      : undefined;
  const message = reason instanceof Error ? reason.message : String(reason);
  if (status === 403) {
    return `403：检测依赖状态需要 Runtime 管理员权限。${message}`;
  }
  if (status === 401) {
    return `401：Runtime 登录已失效，无法检测依赖状态。${message}`;
  }
  return `依赖状态检测失败：${message}`;
}

function formatInstallError(name: string, reason: unknown): string {
  const status =
    typeof reason === "object" && reason !== null && "status" in reason
      ? Number((reason as { status?: unknown }).status)
      : undefined;
  const message = reason instanceof Error ? reason.message : String(reason);
  if (status === 403) return `安装 ${name} 需要 Runtime 管理员权限。`;
  if (status === 401) return `Runtime 登录已失效，无法安装 ${name}。`;
  return `安装 ${name} 失败：${message}`;
}

function DependencyIcon({ dep }: { readonly dep: DependencyInfo }) {
  if (!dep.platformSupported) {
    return <CircleMinus className="size-4 text-muted-foreground" />;
  }
  if (dep.installed) {
    return <CheckCircle2 className="size-4 text-green-600" />;
  }
  return <XCircle className="size-4 text-destructive" />;
}

function DependencyRow({ dep, packageManager, installing, onInstall }: {
  readonly dep: DependencyInfo;
  readonly packageManager?: string;
  readonly installing: boolean;
  readonly onInstall: (dep: DependencyInfo, command: string) => void;
}) {
  const unsupported = !dep.platformSupported;
  const recommendedCmd = packageManager && dep.installCommands[packageManager]
    ? dep.installCommands[packageManager]
    : null;
  // The Runtime only accepts git/rg/dtach for automated installation and needs a
  // command for the detected package manager, so the button appears only when the
  // install can actually succeed.
  const canInstall = !dep.installed
    && dep.platformSupported
    && recommendedCmd !== null
    && isInstallableDependency(dep.name);

  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex min-w-0 items-center gap-3">
          <DependencyIcon dep={dep} />
          <div className="min-w-0 flex-1">
            <CardTitle className="flex items-center gap-2">
              <span className={unsupported ? "text-muted-foreground" : undefined}>
                {dep.name}
              </span>
              {dep.version ? (
                <span className="text-xs font-normal text-muted-foreground">
                  {dep.version}
                </span>
              ) : null}
              <Badge
                variant={dep.required ? "destructive" : "secondary"}
                className="ml-auto"
              >
                {dep.required ? "必需" : "可选"}
              </Badge>
            </CardTitle>
            <CardDescription>
              {DEP_DESCRIPTIONS[dep.name] ?? dep.name}
              {unsupported ? " — 当前平台不支持" : null}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      {!dep.installed && dep.platformSupported && recommendedCmd ? (
        <CardContent className="flex flex-col gap-3">
          <div>
            <p className="mb-1 text-xs text-muted-foreground">推荐安装命令：</p>
            <code className="block whitespace-pre-wrap rounded bg-muted px-3 py-2 text-xs">
              {recommendedCmd}
            </code>
          </div>
          {canInstall ? (
            <div className="flex justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={installing}
                onClick={() => onInstall(dep, recommendedCmd)}
              >
                {installing ? (
                  <Download data-icon="inline-start" className="motion-safe:animate-pulse" />
                ) : (
                  <Download data-icon="inline-start" />
                )}
                {installing ? `正在安装 ${dep.name}…` : `安装 ${dep.name}`}
              </Button>
            </div>
          ) : null}
        </CardContent>
      ) : null}
    </Card>
  );
}

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-label="正在检测依赖状态">
      {[1, 2, 3].map((key) => (
        <Card key={key} size="sm">
          <CardHeader>
            <div className="flex items-center gap-3">
              <Skeleton className="size-4 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-48 max-w-full" />
              </div>
            </div>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}

export function DependencyStatusPanel() {
  const [data, setData] = useState<DependencyCheckResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ dep: DependencyInfo; command: string } | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [installResult, setInstallResult] = useState<{ name: string; ok: boolean; detail?: string } | null>(null);

  async function loadDependencies(isRefresh = false) {
    if (isRefresh) setRefreshing(true);
    setError(null);
    try {
      const result = await dependenciesClient.checkAll();
      setData(result);
    } catch (reason) {
      setError(formatErrorMessage(reason));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  /**
   * Installing runs a real package-manager command on the host, so it is
   * confirmed first and the resulting status is re-read from the Runtime rather
   * than assumed from the response.
   */
  async function confirmInstall() {
    if (!pending) return;
    const { dep } = pending;
    setInstalling(dep.name);
    setInstallResult(null);
    setError(null);
    setPending(null);
    try {
      const result = await dependenciesClient.install(dep.name);
      setInstallResult({
        name: dep.name,
        ok: result.ok,
        detail: result.ok
          ? result.dependency?.version
            ? `已安装 ${result.dependency.version}`
            : undefined
          : result.error,
      });
      await loadDependencies(true);
    } catch (reason) {
      setInstallResult({ name: dep.name, ok: false, detail: formatInstallError(dep.name, reason) });
    } finally {
      setInstalling(null);
    }
  }

  useEffect(() => {
    let cancelled = false;
    dependenciesClient
      .checkAll()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((reason) => {
        if (!cancelled) setError(formatErrorMessage(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div data-slot="dependency-status-panel" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">外部依赖状态</h2>
          <p className="text-sm text-muted-foreground">
            检测 Runtime 运行所需的系统工具（git、ripgrep、dtach 等）是否已安装、版本与路径。
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void loadDependencies(true)}
          disabled={loading || refreshing}
        >
          {refreshing ? (
            <RefreshCw data-icon="inline-start" className="motion-safe:animate-spin" />
          ) : (
            <RefreshCw data-icon="inline-start" />
          )}
          {refreshing ? "检测中…" : "重新检测"}
        </Button>
      </div>

      {error ? (
        <Alert>
          <AlertTitle>依赖检测失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {installResult ? (
        <Alert>
          <AlertTitle>
            {installResult.ok ? `${installResult.name} 安装成功` : `${installResult.name} 安装失败`}
          </AlertTitle>
          <AlertDescription>
            {installResult.detail
              ?? (installResult.ok
                ? "依赖状态已重新检测。"
                : "Runtime 未返回失败原因，请查看服务器日志。")}
          </AlertDescription>
        </Alert>
      ) : null}

      {pending ? (
        <Alert>
          <AlertTitle>确认安装 {pending.dep.name}</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <span>
              将在服务器上执行下面的命令。安装过程由 Runtime 以管理员身份运行，可能需要数分钟。
            </span>
            <code className="block w-full whitespace-pre-wrap rounded bg-muted px-3 py-2 text-xs">
              {pending.command}
            </code>
            <div className="flex gap-2">
              <Button type="button" size="sm" onClick={() => void confirmInstall()}>
                <Download data-icon="inline-start" />
                确认安装
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setPending(null)}>
                取消
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {loading && !data ? <LoadingSkeleton /> : null}

      {data ? (
        <>
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span>平台：{data.platform}</span>
            {data.packageManager ? (
              <span>· 包管理器：{data.packageManager}</span>
            ) : (
              <span>· 未检测到包管理器</span>
            )}
          </div>

          <div className="flex flex-col gap-3">
            {data.dependencies.map((dep) => (
              <DependencyRow
                key={dep.name}
                dep={dep}
                packageManager={data.packageManager}
                installing={installing === dep.name}
                onInstall={(target, command) => setPending({ dep: target, command })}
              />
            ))}
          </div>

          {data.allRequiredMet ? (
            <p className="text-sm font-medium text-green-600">
              ✓ 所有必需依赖均已安装。
            </p>
          ) : (
            <p className="text-sm font-medium text-destructive">
              ✗ 部分必需依赖缺失，可能影响 Runtime 正常运行。
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}
