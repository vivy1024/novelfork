import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { fetchJson } from "@/hooks/use-api";
import { Info, ExternalLink, RefreshCw, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { Row } from "../../components/shared";
import type { StudioReleaseSnapshot } from "../../../shared/release-manifest";

type UpdatePhase = "idle" | "checking" | "up-to-date" | "available" | "error";

interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  error?: string;
}

export function AboutPanel() {
  const [release, setRelease] = useState<StudioReleaseSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<UpdatePhase>("idle");
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
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

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 text-foreground">关于</h2>
        <p className="text-sm text-muted-foreground">
          版本信息与构建来源
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

          {/* 简化的更新检查 */}
          <div className="rounded-lg border border-border p-4 space-y-3">
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2 rounded-lg bg-green-500/10">
                <RefreshCw className="w-5 h-5 text-green-500" />
              </div>
              <h3 className="font-semibold text-foreground">更新</h3>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              {(phase === "idle" || phase === "up-to-date" || phase === "error") && (
                <Button variant="outline" onClick={checkUpdate}>
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

              {phase === "available" && updateInfo && (
                <span className="flex items-center gap-1 text-sm text-orange-600">
                  <AlertCircle className="w-4 h-4" />
                  新版本可用：v{updateInfo.latestVersion}
                  {updateInfo.releaseUrl && (
                    <a
                      href={updateInfo.releaseUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-blue-500 hover:underline ml-2"
                    >
                      前往下载
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </span>
              )}

              {phase === "error" && errorMsg && (
                <span className="flex items-center gap-1 text-sm text-red-600">
                  <AlertCircle className="w-4 h-4" />
                  {errorMsg}
                </span>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              更新配置（服务器地址、通道、自动下载）请前往「服务器与系统」页面管理。
            </p>
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
