type BrowserLaunchSpec = {
  readonly command: string;
  readonly args: string[];
};

type BunRuntime = typeof globalThis & {
  Bun?: {
    spawn(options: {
      cmd: string[];
      cwd?: string;
      stdin?: "ignore";
      stdout?: "ignore";
      stderr?: "ignore";
    }): {
      unref?: () => void;
    };
  };
};

function getBunRuntime(): BunRuntime["Bun"] | undefined {
  return (globalThis as BunRuntime).Bun;
}

export function resolveBrowserLaunch(
  platform: NodeJS.Platform,
  url: string,
): BrowserLaunchSpec {
  if (platform === "darwin") {
    return { command: "open", args: [url] };
  }
  if (platform === "win32") {
    return { command: "cmd", args: ["/c", "start", "", url] };
  }
  return { command: "xdg-open", args: [url] };
}

export async function openExternalUrl(
  platform: NodeJS.Platform,
  url: string,
  cwd: string,
): Promise<void> {
  const launch = resolveBrowserLaunch(platform, url);
  const bun = getBunRuntime();

  if (bun) {
    const proc = bun.spawn({
      cmd: [launch.command, ...launch.args],
      cwd,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    proc.unref?.();
    return;
  }

  const { spawn } = await import("node:child_process");
  const browser = spawn(launch.command, launch.args, {
    cwd,
    stdio: "ignore",
    detached: true,
  });
  browser.on("error", () => {
    // Best effort only — browser open failure should not fail server startup.
  });
  browser.unref?.();
}
