/**
 * GitHub Releases API 代理 + 内存缓存
 */

const GITHUB_OWNER = "vivy1024";
const GITHUB_REPO = "novelfork";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 分钟

export interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string;
  html_url: string;
  published_at: string;
  prerelease: boolean;
  draft: boolean;
  assets: GitHubAsset[];
}

export interface GitHubAsset {
  name: string;
  size: number;
  browser_download_url: string;
  content_type: string;
}

export interface ReleaseInfo {
  version: string;
  channel: "stable" | "beta";
  platform: string;
  downloadUrl: string;
  downloadSize: number;
  sha256: string | null;
  releaseNotes: string;
  publishedAt: string;
  releaseUrl: string;
}

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

let releasesCache: CacheEntry<GitHubRelease[]> | null = null;

async function fetchGitHubReleases(): Promise<GitHubRelease[]> {
  const now = Date.now();
  if (releasesCache && now - releasesCache.fetchedAt < CACHE_TTL_MS) {
    return releasesCache.data;
  }

  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=20`;
  const headers: Record<string, string> = {
    "Accept": "application/vnd.github.v3+json",
    "User-Agent": "novelfork-update-server/1.0",
  };

  // 可选 GitHub Token 提高 rate limit
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!res.ok) {
    throw new Error(`GitHub API returned ${res.status}: ${res.statusText}`);
  }

  const data = await res.json() as GitHubRelease[];
  releasesCache = { data, fetchedAt: now };
  return data;
}

/**
 * 从 release body 中提取 SHA256（格式：`SHA256: xxxx` 或 sha256sum 输出格式）
 */
function extractSha256(body: string, filename: string): string | null {
  // 匹配 "SHA256: <hash>" 或 "<hash>  filename"
  const patterns = [
    new RegExp(`SHA256[:\\s]+([a-fA-F0-9]{64})`, "i"),
    new RegExp(`([a-fA-F0-9]{64})\\s+${filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"),
    new RegExp(`([a-fA-F0-9]{64})`, "i"), // fallback: 第一个 64 位 hex
  ];

  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match?.[1]) return match[1].toLowerCase();
  }
  return null;
}

/**
 * 将 GitHub Release 转换为 ReleaseInfo
 */
function toReleaseInfo(release: GitHubRelease, platform: string): ReleaseInfo | null {
  // 查找匹配平台的 exe asset
  const platformPatterns: Record<string, RegExp> = {
    "windows-x64": /novelfork.*windows.*x64.*\.exe$/i,
  };

  const pattern = platformPatterns[platform];
  if (!pattern) return null;

  const asset = release.assets.find((a) => pattern.test(a.name));
  if (!asset) return null;

  const version = release.tag_name.replace(/^v/, "");
  const channel = release.prerelease ? "beta" : "stable";

  return {
    version,
    channel,
    platform,
    downloadUrl: `/api/download/${version}/${asset.name}`,
    downloadSize: asset.size,
    sha256: extractSha256(release.body || "", asset.name),
    releaseNotes: release.body || "",
    publishedAt: release.published_at,
    releaseUrl: release.html_url,
  };
}

/**
 * 获取最新版本信息
 */
export async function getLatestRelease(channel: string, platform: string): Promise<ReleaseInfo | null> {
  const releases = await fetchGitHubReleases();

  for (const release of releases) {
    if (release.draft) continue;
    if (channel === "stable" && release.prerelease) continue;
    if (channel === "beta" && !release.prerelease) continue;

    const info = toReleaseInfo(release, platform);
    if (info) return info;
  }

  // fallback: 如果 channel=stable 但没有非 prerelease 的，取第一个有 asset 的
  if (channel === "stable") {
    for (const release of releases) {
      if (release.draft) continue;
      const info = toReleaseInfo(release, platform);
      if (info) return { ...info, channel: "stable" };
    }
  }

  return null;
}

/**
 * 获取版本列表
 */
export async function getReleaseList(channel: string, platform: string, limit: number): Promise<ReleaseInfo[]> {
  const releases = await fetchGitHubReleases();
  const results: ReleaseInfo[] = [];

  for (const release of releases) {
    if (release.draft) continue;
    if (channel === "stable" && release.prerelease) continue;

    const info = toReleaseInfo(release, platform);
    if (info) {
      results.push(info);
      if (results.length >= limit) break;
    }
  }

  return results;
}

/**
 * 获取指定版本的 GitHub asset 下载 URL
 */
export async function getAssetDownloadUrl(version: string, filename: string): Promise<string | null> {
  const releases = await fetchGitHubReleases();
  const targetTag = version.startsWith("v") ? version : `v${version}`;

  const release = releases.find((r) => r.tag_name === targetTag);
  if (!release) return null;

  const asset = release.assets.find((a) => a.name === filename);
  return asset?.browser_download_url ?? null;
}
