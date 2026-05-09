import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { fetchJson } from "@/hooks/use-api";
import { Info, ExternalLink, RefreshCw } from "lucide-react";
import { Row } from "../../components/shared";
import type { StudioReleaseSnapshot } from "../../../shared/release-manifest";

type UpdateStatus = "idle" | "checking" | "up-to-date" | "update-available" | "error";

export function AboutPanel() {
  const [release, setRelease] = useState<StudioReleaseSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("idle");
  const [latestVersion, setLatestVersion] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<StudioReleaseSnapshot>("/settings/release")
      .then(setRelease)
      .catch(() => setRelease(null))
      .finally(() => setLoading(false));
  }, []);

  const checkUpdate = async () => {
    setUpdateStatus("checking");
    try {
      const res = await fetch("https://api.github.com/repos/vivy1024/novelfork/releases/latest");
      if (!res.ok) {
        setUpdateStatus("error");
        return;
      }
      const data = await res.json() as { tag_name?: string };
      const latest = data.tag_name?.replace(/^v/, "") ?? null;
      setLatestVersion(latest);
      if (latest && release?.version && latest !== release.version) {
        setUpdateStatus("update-available");
      } else {
        setUpdateStatus("up-to-date");
      }
    } catch {
      setUpdateStatus("error");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 text-foreground">关于</h2>
        <p className="text-sm text-muted-foreground">
          版本信息、运行时环境与构建来源
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

          {/* 检查更新 */}
          <div className="rounded-lg border border-border p-4 space-y-3">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 rounded-lg bg-green-500/10">
                <RefreshCw className="w-5 h-5 text-green-500" />
              </div>
              <h3 className="font-semibold text-foreground">更新</h3>
            </div>

            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                onClick={checkUpdate}
                disabled={updateStatus === "checking"}
              >
                {updateStatus === "checking" ? "检查中..." : "检查更新"}
              </Button>

              {updateStatus === "up-to-date" && (
                <span className="text-sm text-green-600">已是最新版本</span>
              )}
              {updateStatus === "update-available" && latestVersion && (
                <span className="text-sm text-orange-600">
                  有新版本可用：v{latestVersion}
                </span>
              )}
              {updateStatus === "error" && (
                <span className="text-sm text-red-600">检查失败，请稍后重试</span>
              )}
            </div>

            {updateStatus === "update-available" && (
              <a
                href="https://github.com/vivy1024/novelfork/releases/latest"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-blue-500 hover:underline mt-2"
              >
                前往下载页面
                <ExternalLink className="w-3 h-3" />
              </a>
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
