/**
 * 更新检查服务 — 查询自建更新服务器，fallback 到 GitHub API
 */

import { loadUserConfig, updateUserConfig } from "./user-config-service.js";
import { STUDIO_PACKAGE_VERSION } from "../../shared/release-manifest.js";

export interface UpdateCheckResult {
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

interface UpdateServerResponse {
  version: string;
  channel: string;
  platform: string;
  downloadUrl: string;
  downloadSize: number;
  sha256: string | null;
  releaseNotes: string;
  publishedAt: string;
  releaseUrl: string;
}

const GITHUB_RELEASES_URL = "https://api.github.com/repos/vivy1024/novelfork/releases/latest";

/**
 * 从自建更新服务器检查更新
 */
async function checkFromUpdateServer(serverUrl: string, channel: string, proxyUrl: string): Promise<UpdateCheckResult> {
  const currentVersion = STUDIO_PACKAGE_VERSION;
  const url = `${serverUrl}/api/releases/latest?channel=${channel}&platform=windows-x64`;

  const fetchOptions: RequestInit = {
    headers: {
      "User-Agent": `NovelFork-Studio/${currentVersion}`,
    },
    signal: AbortSignal.timeout(15000),
  };

  if (proxyUrl) {
    (fetchOptions as Record<string, unknown>).proxy = proxyUrl;
  }

  const res = await fetch(url, fetchOptions);
  if (!res.ok) {
    throw new Error(`Update server returned ${res.status}`);
  }

  const data = await res.json() as UpdateServerResponse;
  const latestVersion = data.version;

  // 版本比较
  const updateAvailable = latestVersion !== currentVersion && isNewerVersion(latestVersion, currentVersion);

  // 构建完整下载 URL
  const downloadUrl = data.downloadUrl.startsWith("http")
    ? data.downloadUrl
    : `${serverUrl}${data.downloadUrl}`;

  return {
    currentVersion,
    latestVersion,
    updateAvailable,
    releaseUrl: data.releaseUrl,
    downloadUrl: updateAvailable ? downloadUrl : null,
    downloadSize: updateAvailable ? data.downloadSize : null,
    sha256: updateAvailable ? data.sha256 : null,
    releaseNotes: updateAvailable ? data.releaseNotes : null,
  };
}

/**
 * 从 GitHub API 检查更新（fallback）
 */
async function checkFromGitHub(proxyUrl: string): Promise<UpdateCheckResult> {
  const currentVersion = STUDIO_PACKAGE_VERSION;

  const fetchOptions: RequestInit = {
    headers: {
      "Accept": "application/vnd.github.v3+json",
      "User-Agent": `NovelFork-Studio/${currentVersion}`,
    },
    signal: AbortSignal.timeout(10000),
  };

  if (proxyUrl) {
    (fetchOptions as Record<string, unknown>).proxy = proxyUrl;
  }

  const res = await fetch(GITHUB_RELEASES_URL, fetchOptions);
  if (!res.ok) {
    throw new Error(`GitHub API returned ${res.status}`);
  }

  const data = await res.json() as { tag_name?: string; html_url?: string };
  const latestVersion = data.tag_name?.replace(/^v/, "") ?? null;
  const releaseUrl = data.html_url ?? null;

  return {
    currentVersion,
    latestVersion,
    updateAvailable: latestVersion !== null && latestVersion !== currentVersion && isNewerVersion(latestVersion, currentVersion),
    releaseUrl,
    downloadUrl: null, // GitHub fallback 不提供代理下载
    downloadSize: null,
    sha256: null,
    releaseNotes: null,
  };
}

/**
 * 检查是否有新版本可用
 * 优先查自建更新服务器，失败时 fallback 到 GitHub API
 */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const currentVersion = STUDIO_PACKAGE_VERSION;
  try {
    const config = await loadUserConfig();
    const proxyUrl = config.proxy?.webFetch || "";
    const serverUrl = config.update?.serverUrl || "https://novelfork-update.vivy1024.cc";
    const channel = config.update?.channel || "stable";

    // 检查是否跳过此版本
    const skippedVersion = config.update?.skippedVersion;

    let result: UpdateCheckResult;

    // 优先查自建服务器
    try {
      result = await checkFromUpdateServer(serverUrl, channel, proxyUrl);
    } catch (serverError) {
      console.warn(`[update] Update server unreachable, falling back to GitHub:`, serverError);
      result = await checkFromGitHub(proxyUrl);
    }

    // 如果用户跳过了此版本，标记为不可用
    if (result.updateAvailable && result.latestVersion === skippedVersion) {
      result.updateAvailable = false;
    }

    // 更新上次检查时间
    await updateUserConfig({ update: { lastCheckAt: new Date().toISOString() } }).catch(() => {});

    return result;
  } catch (error) {
    return {
      currentVersion,
      latestVersion: null,
      updateAvailable: false,
      releaseUrl: null,
      downloadUrl: null,
      downloadSize: null,
      sha256: null,
      releaseNotes: null,
      error: error instanceof Error ? error.message : "检查更新失败",
    };
  }
}

/**
 * 语义化版本比较：remote 是否比 current 新
 */
function isNewerVersion(remote: string, current: string): boolean {
  const r = remote.split(".").map(Number);
  const c = current.split(".").map(Number);

  for (let i = 0; i < 3; i++) {
    const rv = r[i] ?? 0;
    const cv = c[i] ?? 0;
    if (rv > cv) return true;
    if (rv < cv) return false;
  }
  return false;
}
