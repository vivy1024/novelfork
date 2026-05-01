import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type DesktopWindowLaunchPlan =
  | { readonly kind: "none"; readonly reason: "disabled" }
  | { readonly kind: "app"; readonly command: string; readonly args: readonly string[]; readonly userDataDir: string }
  | { readonly kind: "browser"; readonly command: string; readonly args: readonly string[] };

export interface DesktopWindowLaunchOptions {
  readonly url: string;
  readonly platform?: NodeJS.Platform;
  readonly env?: NodeJS.ProcessEnv;
  readonly homeDir?: string;
  readonly pathExists?: (path: string) => boolean;
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

  if (programFilesX86) candidates.push(join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"));
  if (programFiles) candidates.push(join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"));
  if (localAppData) candidates.push(join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe"));
  if (programFiles) candidates.push(join(programFiles, "Google", "Chrome", "Application", "chrome.exe"));
  if (programFilesX86) candidates.push(join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"));
  if (localAppData) candidates.push(join(localAppData, "Google", "Chrome", "Application", "chrome.exe"));

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

function canUseCandidate(candidate: string, platform: NodeJS.Platform, pathExists: (path: string) => boolean): boolean {
  if (platform === "linux" && !candidate.includes("/")) return true;
  return pathExists(candidate);
}

export function buildDesktopWindowLaunchPlan(options: DesktopWindowLaunchOptions): DesktopWindowLaunchPlan {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const mode = env.NOVELFORK_WINDOW_MODE?.trim().toLowerCase();
  const url = options.url;

  if (env.NOVELFORK_NO_BROWSER === "1" || mode === "none") {
    return { kind: "none", reason: "disabled" };
  }

  if (mode === "browser") {
    return defaultBrowserPlan(platform, url);
  }

  const pathExists = options.pathExists ?? existsSync;
  const command = browserCandidates(platform, env).find((candidate) => canUseCandidate(candidate, platform, pathExists));
  if (!command) {
    return defaultBrowserPlan(platform, url);
  }

  const userDataDir = env.NOVELFORK_DESKTOP_USER_DATA_DIR ?? join(options.homeDir ?? homedir(), ".novelfork", "desktop-browser");
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

export function openStudioWindow(url: string, options: Omit<DesktopWindowLaunchOptions, "url"> = {}): DesktopWindowLaunchPlan {
  const plan = buildDesktopWindowLaunchPlan({ ...options, url });
  if (plan.kind === "none") return plan;

  if (plan.kind === "app") {
    mkdirSync(plan.userDataDir, { recursive: true });
  }

  const child = spawn(plan.command, [...plan.args], { detached: true, stdio: "ignore" });
  child.once("error", (error) => {
    console.warn(`[desktop-window] Failed to open Studio window: ${error instanceof Error ? error.message : String(error)}`);
  });
  child.unref();
  return plan;
}
