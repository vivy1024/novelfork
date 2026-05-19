/**
 * 更新下载器 — 下载 exe + SHA256 校验 + Windows 替换
 *
 * Windows exe 替换策略：
 * 1. 下载新 exe 到临时目录
 * 2. 校验 SHA256
 * 3. 生成 .bat 替换脚本
 * 4. 启动 bat（detached）后退出当前进程
 * 5. bat 等待旧进程退出 → 覆盖 exe → 启动新 exe → 删除自身
 */

import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { loadUserConfig } from "./user-config-service.js";

export interface DownloadProgress {
  phase: "downloading" | "verifying" | "ready" | "error";
  bytesDownloaded: number;
  totalBytes: number;
  percent: number;
  error?: string;
}

export type ProgressCallback = (progress: DownloadProgress) => void;

const UPDATE_DIR = join(tmpdir(), "novelfork-update");

/**
 * 确保更新临时目录存在
 */
function ensureUpdateDir(): string {
  if (!existsSync(UPDATE_DIR)) {
    mkdirSync(UPDATE_DIR, { recursive: true });
  }
  return UPDATE_DIR;
}

/**
 * 下载文件并报告进度
 */
async function downloadFile(
  url: string,
  destPath: string,
  totalBytes: number,
  onProgress: ProgressCallback,
): Promise<void> {
  const config = await loadUserConfig();
  const proxyUrl = config.proxy?.webFetch || "";

  const fetchOptions: RequestInit = {
    headers: { "User-Agent": "NovelFork-Studio-Updater/1.0" },
    signal: AbortSignal.timeout(600000), // 10 分钟超时
  };
  if (proxyUrl) {
    (fetchOptions as Record<string, unknown>).proxy = proxyUrl;
  }

  const res = await fetch(url, { ...fetchOptions, redirect: "follow" });
  if (!res.ok) {
    throw new Error(`Download failed: HTTP ${res.status}`);
  }

  const contentLength = parseInt(res.headers.get("content-length") || "0", 10);
  const total = contentLength || totalBytes;

  if (!res.body) {
    throw new Error("Response body is null");
  }

  const writeStream = createWriteStream(destPath);
  let downloaded = 0;

  // 将 web ReadableStream 转为 Node.js Readable
  const reader = res.body.getReader();
  const nodeStream = new Readable({
    async read() {
      try {
        const { done, value } = await reader.read();
        if (done) {
          this.push(null);
          return;
        }
        downloaded += value.byteLength;
        onProgress({
          phase: "downloading",
          bytesDownloaded: downloaded,
          totalBytes: total,
          percent: total > 0 ? Math.round((downloaded / total) * 100) : 0,
        });
        this.push(Buffer.from(value));
      } catch (err) {
        this.destroy(err instanceof Error ? err : new Error(String(err)));
      }
    },
  });

  await pipeline(nodeStream, writeStream);
}

/**
 * 计算文件 SHA256
 */
async function computeSha256(filePath: string): Promise<string> {
  const { readFile: readFileAsync } = await import("node:fs/promises");
  const buffer = await readFileAsync(filePath);
  const hash = createHash("sha256");
  hash.update(new Uint8Array(buffer));
  return hash.digest("hex");
}

/**
 * 生成 Windows 替换脚本
 */
function generateReplaceBat(currentExePath: string, newExePath: string): string {
  const batPath = join(UPDATE_DIR, "novelfork-update.bat");

  // bat 脚本：等待旧进程退出 → 复制新 exe → 启动 → 清理
  const script = `@echo off
setlocal
set "OLD_EXE=${currentExePath.replace(/\//g, "\\")}"
set "NEW_EXE=${newExePath.replace(/\//g, "\\")}"

echo [NovelFork Updater] Waiting for old process to exit...
:wait_loop
tasklist /FI "IMAGENAME eq ${getExeName(currentExePath)}" 2>NUL | find /I "${getExeName(currentExePath)}" >NUL
if not errorlevel 1 (
    timeout /t 1 /nobreak >NUL
    goto wait_loop
)

echo [NovelFork Updater] Replacing executable...
copy /Y "%NEW_EXE%" "%OLD_EXE%"
if errorlevel 1 (
    echo [NovelFork Updater] ERROR: Failed to replace executable
    pause
    exit /b 1
)

echo [NovelFork Updater] Starting new version...
start "" "%OLD_EXE%"

echo [NovelFork Updater] Cleaning up...
del /Q "%NEW_EXE%" 2>NUL
del /Q "%~f0" 2>NUL
exit /b 0
`;

  writeFileSync(batPath, script, "utf-8");
  return batPath;
}

function getExeName(exePath: string): string {
  return exePath.split(/[/\\]/).pop() || "novelfork.exe";
}

/**
 * 下载更新
 */
export async function downloadUpdate(
  downloadUrl: string,
  expectedSha256: string | null,
  totalBytes: number,
  onProgress: ProgressCallback,
): Promise<string> {
  const dir = ensureUpdateDir();

  // 从 URL 提取文件名
  const urlParts = downloadUrl.split("/");
  const filename = urlParts[urlParts.length - 1] || "novelfork-update.exe";
  const destPath = join(dir, filename);

  // 如果已存在旧的下载文件，删除
  if (existsSync(destPath)) {
    unlinkSync(destPath);
  }

  // 下载
  await downloadFile(downloadUrl, destPath, totalBytes, onProgress);

  // SHA256 校验
  if (expectedSha256) {
    onProgress({
      phase: "verifying",
      bytesDownloaded: totalBytes,
      totalBytes,
      percent: 100,
    });

    const actualSha256 = await computeSha256(destPath);
    if (actualSha256 !== expectedSha256.toLowerCase()) {
      unlinkSync(destPath);
      throw new Error(`SHA256 mismatch: expected ${expectedSha256}, got ${actualSha256}`);
    }
  }

  onProgress({
    phase: "ready",
    bytesDownloaded: totalBytes,
    totalBytes,
    percent: 100,
  });

  return destPath;
}

/**
 * 执行更新安装（生成 bat + 退出当前进程）
 */
export function installUpdate(newExePath: string): void {
  // 获取当前 exe 路径
  const currentExePath = process.execPath;

  // 生成替换脚本
  const batPath = generateReplaceBat(currentExePath, newExePath);

  // 启动 bat（detached，不等待）
  const child = spawn("cmd.exe", ["/c", batPath], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();

  // 退出当前进程
  console.log("[update] Replacement script launched, exiting current process...");
  process.exit(0);
}

/**
 * 获取已下载但未安装的更新文件路径（如果存在）
 */
export function getPendingUpdatePath(): string | null {
  if (!existsSync(UPDATE_DIR)) return null;

  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  const files = readdirSync(UPDATE_DIR);
  const exe = files.find((f: string) => f.endsWith(".exe"));
  return exe ? join(UPDATE_DIR, exe) : null;
}

/**
 * 清理更新临时目录
 */
export function cleanupUpdateDir(): void {
  if (!existsSync(UPDATE_DIR)) return;

  const { rmSync } = require("node:fs") as typeof import("node:fs");
  try {
    rmSync(UPDATE_DIR, { recursive: true, force: true });
  } catch {
    // 忽略清理失败
  }
}
