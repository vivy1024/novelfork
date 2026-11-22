import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type DesktopWindowLaunchPlan =
  | {
      readonly kind: "none";
      readonly reason: "disabled";
    }
  | {
      readonly kind: "app";
      readonly command: string;
      readonly args: readonly string[];
      readonly userDataDir: string;
    }
  | {
      readonly kind: "browser";
      readonly command: string;
      readonly args: readonly string[];
    };

export interface DesktopWindowLaunchOptions {
  readonly url: string;
  readonly platform?: NodeJS.Platform;
  readonly env?: NodeJS.ProcessEnv;
  readonly homeDir?: string;
  readonly pathExists?: (path: string) => boolean;
  /**
   * 打开前清掉专用 profile 的 Service Worker 缓存（默认 true）。再次启动时浏览器可能正开着这个
   * profile，不去动它的文件。
   */
  readonly cleanServiceWorkerCache?: boolean;
}

function defaultBrowserPlan(platform: NodeJS.Platform, url: string): DesktopWindowLaunchPlan {
  if (platform === "win32") {
    return { kind: "browser", command: "explorer.exe", args: [url] };
  }
  if (platform === "darwin") {
    return { kind: "browser", command: "open", args: [url] };
  }
  return { kind: "browser", command: "xdg-open", args: [url] };
}

function windowsBrowserCandidates(env: NodeJS.ProcessEnv): string[] {
  const candidates: string[] = [];
  const programFilesX86 = env["ProgramFiles(x86)"];
  const programFiles = env.ProgramFiles;
  const localAppData = env.LOCALAPPDATA;

  if (programFilesX86) {
    candidates.push(join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"));
  }
  if (programFiles) {
    candidates.push(join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"));
  }
  if (localAppData) {
    candidates.push(join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe"));
  }
  if (programFiles) {
    candidates.push(join(programFiles, "Google", "Chrome", "Application", "chrome.exe"));
  }
  if (programFilesX86) {
    candidates.push(join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"));
  }
  if (localAppData) {
    candidates.push(join(localAppData, "Google", "Chrome", "Application", "chrome.exe"));
  }
  return candidates;
}

function browserCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  if (env.NOVELFORK_BROWSER_PATH) return [env.NOVELFORK_BROWSER_PATH];
  if (platform === "win32") return windowsBrowserCandidates(env);
  if (platform === "darwin") {
    return [
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ];
  }
  return ["microsoft-edge", "google-chrome", "chromium", "chromium-browser"];
}

function canUseCandidate(
  candidate: string,
  platform: NodeJS.Platform,
  pathExists: (path: string) => boolean,
): boolean {
  // Linux candidates without a slash are resolved through PATH by spawn.
  if (platform === "linux" && !candidate.includes("/")) return true;
  return pathExists(candidate);
}

/** `NOVELFORK_NO_BROWSER=1` / `NARRAFORK_NO_BROWSER=1` / `NOVELFORK_WINDOW_MODE=none`：不开任何窗口。 */
export function isDesktopWindowDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env.NOVELFORK_NO_BROWSER === "1" ||
    env.NARRAFORK_NO_BROWSER === "1" ||
    env.NOVELFORK_WINDOW_MODE?.trim().toLowerCase() === "none"
  );
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0", "::", "[::]"]);

/**
 * 窗口地址：只取 origin，并把本机回环/通配写法（127.0.0.1、[::1]、0.0.0.0、[::]）统一成 localhost。
 *
 * Runtime 启动状态页与正式服务、管理器观测到的监听地址，主机写法可能各不相同（拿到管理令牌时
 * 服务会把 localhost 解析成具体 IP）；按原样比较会把同一端口当成两个地址再开一个窗口，按原样
 * 打开则换了 origin，浏览器存的登录态与偏好都对不上。非回环主机（局域网地址等）保持原样。
 */
export function desktopOrigin(raw: string): string {
  try {
    const url = new URL(raw);
    if (LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) url.hostname = "localhost";
    return url.origin;
  } catch {
    return raw;
  }
}

export type DesktopLaunchMode = "manager" | "serve";

/**
 * 产品可执行文件的启动方式。
 *
 * Windows 编译产物默认进 Runtime 的图形化管理器（托盘 + 管理窗口），由它以 `--serve` 子进程跑服务、
 * 打开 NovelFork 窗口；产物隐藏了控制台，没有托盘就没有退出入口。服务模式留给：
 * - 管理器拉起的服务子进程（`NARRAFORK_MANAGER_MANAGED=1`）；
 * - 不开窗口的无头运行（`NOVELFORK_NO_BROWSER=1` 等，见 isDesktopWindowDisabled）；
 * - 非 Windows 平台与源码运行（源码可显式加 `--manager` 调试管理器）。
 * 编译产物上的 `--serve` 不再表示服务模式：v0.1.1 的自动更新以 `--serve` 拉起替换进程，
 * 新版本应接管为管理器（管理器把更新交接环境交给第一个服务子进程）。
 */
export function resolveDesktopLaunchMode(input: {
  readonly platform: NodeJS.Platform;
  readonly argv: readonly string[];
  readonly compiled: boolean;
  readonly env?: NodeJS.ProcessEnv;
}): DesktopLaunchMode {
  const env = input.env ?? process.env;
  if (input.platform !== "win32") return "serve";
  if (env.NARRAFORK_MANAGER_MANAGED === "1") return "serve";
  if (isDesktopWindowDisabled(env)) return "serve";
  if (input.argv.includes("--manager")) return "manager";
  return input.compiled ? "manager" : "serve";
}

export function buildDesktopWindowLaunchPlan(options: DesktopWindowLaunchOptions): DesktopWindowLaunchPlan {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const mode = env.NOVELFORK_WINDOW_MODE?.trim().toLowerCase();
  const url = options.url;

  if (isDesktopWindowDisabled(env)) {
    return { kind: "none", reason: "disabled" };
  }
  if (mode === "browser") {
    return defaultBrowserPlan(platform, url);
  }

  const pathExists = options.pathExists ?? existsSync;
  const command = browserCandidates(platform, env).find((candidate) =>
    canUseCandidate(candidate, platform, pathExists),
  );
  if (!command) return defaultBrowserPlan(platform, url);

  const userDataDir =
    env.NOVELFORK_DESKTOP_USER_DATA_DIR ?? join(options.homeDir ?? homedir(), ".novelfork", "desktop-browser");

  return {
    kind: "app",
    command,
    userDataDir,
    args: [
      `--app=${url}`,
      "--new-window",
      "--no-first-run",
      `--user-data-dir=${userDataDir}`,
    ],
  };
}

export function openStudioWindow(
  url: string,
  options: Omit<DesktopWindowLaunchOptions, "url"> = {},
): DesktopWindowLaunchPlan {
  const plan = buildDesktopWindowLaunchPlan({ ...options, url });
  if (plan.kind === "none") return plan;

  if (plan.kind === "app") {
    mkdirSync(plan.userDataDir, { recursive: true });
  }
  if (plan.kind === "app" && options.cleanServiceWorkerCache !== false) {
    // The profile is dedicated to NovelFork, so best-effort cleanup prevents an old
    // service worker from serving stale frontend assets after an exe upgrade.
    const serviceWorkerCacheDir = join(plan.userDataDir, "Default", "Service Worker");
    if (existsSync(serviceWorkerCacheDir)) {
      try {
        rmSync(serviceWorkerCacheDir, { recursive: true, force: true });
      } catch {
        // A running app may hold the cache open; the new immutable assets are still
        // safe to load when cleanup is unavailable.
      }
    }
  }

  const child = spawn(plan.command, [...plan.args], { detached: true, stdio: "ignore" });
  child.once("error", (error) => {
    console.warn(
      `[desktop-window] Failed to open Studio window: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
  child.unref();
  return plan;
}

/** Studio 页面的固定标题（`packages/studio/index.html` 的 `<title>`）；`--app` 窗口标题就是它。 */
export const STUDIO_DOCUMENT_TITLE = "NovelFork";

export type StudioWindowActivation =
  | DesktopWindowLaunchPlan
  | {
      readonly kind: "focused";
      readonly title: string;
    };

export interface StudioWindowActivationOptions extends Omit<DesktopWindowLaunchOptions, "url"> {
  /**
   * 已开窗口的候选标题（启动状态页标题是实例显示名，Studio 页面是 STUDIO_DOCUMENT_TITLE）。
   * 空白与重复会被去掉。
   */
  readonly windowTitles?: readonly (string | undefined)[];
  /** 按标题找到已开的应用窗口并前置；找到返回 true。平台不支持时不传。 */
  readonly focusWindow?: (title: string) => boolean;
  /** 测试注入；默认 openStudioWindow。 */
  readonly open?: (url: string, options: Omit<DesktopWindowLaunchOptions, "url">) => DesktopWindowLaunchPlan;
}

/**
 * 再次启动时把 NovelFork 窗口带到前面：先聚焦已开的应用窗口，没有再新开一个。
 *
 * 实测（Edge，同一 --user-data-dir）：对已运行的 profile 再执行 `msedge --app=<url>`，
 * 浏览器进程复用但总是新开一个应用窗口（带不带 --new-window 都一样），不会聚焦旧窗口；
 * 所以重复双击若直接再 spawn，窗口会越开越多。浏览器模式（NOVELFORK_WINDOW_MODE=browser）
 * 不聚焦：普通浏览器标签页的窗口标题不是页面标题本身。
 */
export function activateStudioWindow(
  url: string,
  options: StudioWindowActivationOptions = {},
): StudioWindowActivation {
  const { windowTitles = [], focusWindow, open = openStudioWindow, ...launchOptions } = options;
  const env = launchOptions.env ?? process.env;
  if (isDesktopWindowDisabled(env)) return { kind: "none", reason: "disabled" };
  const mode = env.NOVELFORK_WINDOW_MODE?.trim().toLowerCase();
  if (focusWindow && mode !== "browser") {
    const titles = [...new Set(windowTitles.map((title) => title?.trim()).filter((title): title is string => !!title))];
    for (const title of titles) {
      if (focusWindow(title)) return { kind: "focused", title };
    }
  }
  return open(url, { ...launchOptions, cleanServiceWorkerCache: false });
}
