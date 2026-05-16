/**
 * 更新检查服务 — 调用 GitHub API 对比当前版本与最新 Release
 */

import { loadUserConfig } from "./user-config-service.js";

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  error?: string;
}

const GITHUB_RELEASES_URL = "https://api.github.com/repos/vivy1024/novelfork/releases/latest";
const CURRENT_VERSION = "0.9.1";

/**
 * 检查是否有新版本可用
 */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  try {
    // 读取代理配置
    const config = await loadUserConfig();
    const proxyUrl = config.proxy?.webFetch || "";

    const fetchOptions: RequestInit = {
      headers: {
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": `NovelFork-Studio/${CURRENT_VERSION}`,
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
        currentVersion: CURRENT_VERSION,
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
      currentVersion: CURRENT_VERSION,
      latestVersion,
      updateAvailable: latestVersion !== null && latestVersion !== CURRENT_VERSION,
      releaseUrl,
    };
  } catch (error) {
    return {
      currentVersion: CURRENT_VERSION,
      latestVersion: null,
      updateAvailable: false,
      releaseUrl: null,
      error: error instanceof Error ? error.message : "检查更新失败",
    };
  }
}
