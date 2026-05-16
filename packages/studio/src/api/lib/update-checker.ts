/**
 * 更新检查服务 — 调用 GitHub API 对比当前版本与最新 Release
 */

import { loadUserConfig } from "./user-config-service.js";
import { STUDIO_PACKAGE_VERSION } from "../../shared/release-manifest.js";

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  error?: string;
}

const GITHUB_RELEASES_URL = "https://api.github.com/repos/vivy1024/novelfork/releases/latest";

/**
 * 检查是否有新版本可用
 */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const currentVersion = STUDIO_PACKAGE_VERSION;
  try {
    // 读取代理配置
    const config = await loadUserConfig();
    const proxyUrl = config.proxy?.webFetch || "";

    const fetchOptions: RequestInit = {
      headers: {
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": `NovelFork-Studio/${currentVersion}`,
      },
      signal: AbortSignal.timeout(10000),
    };

    // 如果配置了代理，通过环境变量传递（Bun 原生支持）
    if (proxyUrl) {
      (fetchOptions as Record<string, unknown>).proxy = proxyUrl;
    }

    const res = await fetch(GITHUB_RELEASES_URL, fetchOptions);
    if (!res.ok) {
      return {
        currentVersion,
        latestVersion: null,
        updateAvailable: false,
        releaseUrl: null,
        error: `GitHub API 返回 ${res.status}`,
      };
    }

    const data = await res.json() as { tag_name?: string; html_url?: string };
    const latestVersion = data.tag_name?.replace(/^v/, "") ?? null;
    const releaseUrl = data.html_url ?? null;

    return {
      currentVersion,
      latestVersion,
      updateAvailable: latestVersion !== null && latestVersion !== currentVersion,
      releaseUrl,
    };
  } catch (error) {
    return {
      currentVersion,
      latestVersion: null,
      updateAvailable: false,
      releaseUrl: null,
      error: error instanceof Error ? error.message : "检查更新失败",
    };
  }
}
