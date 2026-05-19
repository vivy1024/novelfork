import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { fetchJson } from "@/hooks/use-api";
import { Info, ExternalLink, RefreshCw, Download, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { Row } from "../../components/shared";
import type { StudioReleaseSnapshot } from "../../../shared/release-manifest";

type UpdatePhase = "idle" | "checking" | "available" | "downloading" | "verifying" | "ready" | "installing" | "up-to-date" | "error";

interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  downloadUrl: string | null;
  downloadSize: number | null;
  sha256: string | null;
  releaseNotes: string | null;
  error?: string;
}

interface DownloadProgress {
  phase: string;
  bytesDownloaded: number;
  totalBytes: number;
  percent: number;
  error?: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export function AboutPanel() {
  const [release, setRelease] = useState<StudioReleaseSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<UpdatePhase>("idle");
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<StudioReleaseSnapshot>("/settings/release")
      .then(setRelease)
      .catch(() => setRelease(null))
      .finally(() => setLoading(false));
  }, []);

  const checkUpdate = useCallback(async () => {
    setPhase("checking");
    setErrorMsg(null);
    try {
      const result = await fetchJson<UpdateCheckResult>("/settings/check-update");
      setUpdateInfo(result);
      if (result.error) {
        setPhase("error");
        setErrorMsg(result.error);
      } else if (result.updateAvailable) {
        setPhase("available");
      } else {
        setPhase("up-to-date");
      }
    } catch (err) {
      setPhase("error");
      setErrorMsg(err instanceof Error ? err.message : "检查更新失败");
    }
  }, []);

  const downloadUpdate = useCallback(async () => {
    if (!updateInfo?.downloadUrl) return;
    setPhase("downloading");
    setErrorMsg(null);

    try {
      // 触发下载
      const downloadPromise = fetch("/api/settings/download-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          downloadUrl: updateInfo.downloadUrl,
          sha256: updateInfo.sha256,
          downloadSize: updateInfo.downloadSize,
        }),
      });

      // 轮询进度
      const pollInterval = setInterval(async () => {
        try {
          const prog = await fetchJson<DownloadProgress>("/settings/update-progress");
          setProgress(prog);
          if (prog.phase === "verifying") {
            setPhase("verifying");
          } else if (prog.phase === "ready") {
            setPhase("ready");
            clearInterval(pollInterval);
          } else if (prog.phase === "error") {
            setPhase("error");
            setErrorMsg(prog.error || "下载失败");
            clearInterval(pollInterval);
          }
        } catch {
          // 轮询失败不中断
        }
      }, 500);

      const res = await downloadPromise;
      clearInterval(pollInterval);

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setPhase("error");
        setErrorMsg(data.error || "下载失败");
      } else {
        setPhase("ready");
        setProgress({ phase: "ready", bytesDownloaded: updateInfo.downloadSize || 0, totalBytes: updateInfo.downloadSize || 0, percent: 100 });
      }
    } catch (err) {
      setPhase("error");
      setErrorMsg(err instanceof Error ? err.message : "下载失败");
    }
  }, [updateInfo]);

  const installUpdate = useCallback(async () => {
    setPhase("installing");
    try {
      await fetch("/api/settings/install-update", { method: "POST" });
      // 如果成功，进程会退出，页面会断开
    } catch {
      setPhase("error");
      setErrorMsg("安装失败，请手动替换");
    }
  }, []);

  const skipVersion = useCallback(async () => {
    if (!updateInfo?.latestVersion) return;
    try {
      await fetch("/api/settings/skip-version", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: updateInfo.latestVersion }),
      });
      setPhase("idle");
      setUpdateInfo(null);
    } catch {
      // 忽略
    }
  }, [updateInfo]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 text-foreground">关于</h2>
        <p className="text-sm text-muted-foreground">
          版本信息、更新管理与构建来源
        </p>
      </div>

      {loading && <p className="text-muted-foreground">加载中...</p>}

      {release && (
        <>
          {/* 应用信息 */}
          <div className="rounded-lg border border-border p-4 space-y-3">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <Info className="w-5 h-5 text-blue-500" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">{release.appName}</h3>
                <p className="text-xs text-muted-foreground">AI 辅助网文创作工作台</p>
              </div>
            </div>

            <div className="space-y-2">
              <Row label="版本" value={`v${release.version}`} />
              <Row label="运行时" value={release.runtimeLabel} />
              <Row label="构建来源" value={release.buildLabel} />
              {release.commit && <Row label="Commit" value={release.commit.slice(0, 12)} />}
            </div>
          </div>

          {/* 更新管理 */}
          <div className="rounded-lg border border-border p-4 space-y-4">
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2 rounded-lg bg-green-500/10">
                <RefreshCw className="w-5 h-5 text-green-500" />
              </div>
              <h3 className="font-semibold text-foreground">更新</h3>
            </div>

            {/* 操作按钮区 */}
            <div className="flex items-center gap-3 flex-wrap">
              {(phase === "idle" || phase === "up-to-date" || phase === "error") && (
                <Button
                  variant="outline"
                  onClick={checkUpdate}
                >
                  检查更新
                </Button>
              )}

              {phase === "checking" && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  正在检查...
                </div>
              )}

              {phase === "up-to-date" && (
                <span className="flex items-center gap-1 text-sm text-green-600">
                  <CheckCircle className="w-4 h-4" />
                  已是最新版本
                </span>
              )}

              {phase === "error" && errorMsg && (
                <span className="flex items-center gap-1 text-sm text-red-600">
                  <AlertCircle className="w-4 h-4" />
                  {errorMsg}
                </span>
              )}
            </div>

            {/* 发现新版本 */}
            {phase === "available" && updateInfo && (
              <div className="rounded-md border border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/30 p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-orange-700 dark:text-orange-400">
                    新版本可用：v{updateInfo.latestVersion}
                  </span>
                  {updateInfo.downloadSize && (
                    <span className="text-xs text-muted-foreground">
                      {formatBytes(updateInfo.downloadSize)}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {updateInfo.downloadUrl && (
                    <Button size="sm" onClick={downloadUpdate}>
                      <Download className="w-4 h-4 mr-1" />
                      下载更新
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={skipVersion}>
                    跳过此版本
                  </Button>
                  {updateInfo.releaseUrl && (
                    <a
                      href={updateInfo.releaseUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-blue-500 hover:underline"
                    >
                      查看详情
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>
            )}

            {/* 下载进度 */}
            {(phase === "downloading" || phase === "verifying") && progress && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {phase === "verifying" ? "校验中..." : "下载中..."}
                  </span>
                  <span className="text-muted-foreground">
                    {formatBytes(progress.bytesDownloaded)} / {formatBytes(progress.totalBytes)}
                  </span>
                </div>
                <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all duration-300"
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>
                <div className="text-xs text-muted-foreground text-right">
                  {progress.percent}%
                </div>
              </div>
            )}

            {/* 准备安装 */}
            {phase === "ready" && (
              <div className="rounded-md border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30 p-3 space-y-2">
                <p className="text-sm text-green-700 dark:text-green-400">
                  更新已下载完成，点击安装将关闭当前程序并替换为新版本。
                </p>
                <Button size="sm" onClick={installUpdate}>
                  <RefreshCw className="w-4 h-4 mr-1" />
                  立即安装并重启
                </Button>
              </div>
            )}

            {/* 安装中 */}
            {phase === "installing" && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                正在安装，程序即将重启...
              </div>
            )}
          </div>

          {/* 链接 */}
          <div className="rounded-lg border border-border p-4 space-y-3">
            <h3 className="font-semibold text-foreground mb-2">链接</h3>
            <div className="flex flex-col gap-2">
              <a
                href={release.changelogUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-blue-500 hover:underline"
              >
                更新日志 (Changelog)
                <ExternalLink className="w-3 h-3" />
              </a>
              <a
                href="https://github.com/vivy1024/novelfork"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-blue-500 hover:underline"
              >
                GitHub 仓库
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </>
      )}

      {!loading && !release && (
        <div className="rounded-lg border border-border p-4">
          <p className="text-sm text-muted-foreground">无法获取版本信息</p>
        </div>
      )}
    </div>
  );
}
