import { describe, expect, it } from "vitest";

import {
  activateStudioWindow,
  buildDesktopWindowLaunchPlan,
  desktopOrigin,
  isDesktopWindowDisabled,
  resolveDesktopLaunchMode,
  STUDIO_DOCUMENT_TITLE,
} from "./desktop-window";

const url = "http://localhost:4567";

describe("desktop app window launch planning", () => {
  it("does not open a window when browser launch is disabled", () => {
    const plan = buildDesktopWindowLaunchPlan({
      url,
      platform: "win32",
      env: { NOVELFORK_NO_BROWSER: "1" },
      homeDir: "C:\\Users\\writer",
      pathExists: () => true,
    });

    expect(plan).toEqual({ kind: "none", reason: "disabled" });
  });

  it("uses Windows Edge app mode by default", () => {
    const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
    const plan = buildDesktopWindowLaunchPlan({
      url,
      platform: "win32",
      env: {
        "ProgramFiles(x86)": "C:\\Program Files (x86)",
        ProgramFiles: "C:\\Program Files",
      },
      homeDir: "C:\\Users\\writer",
      pathExists: (path) => path === edgePath,
    });

    expect(plan.kind).toBe("app");
    if (plan.kind !== "app") throw new Error("expected app mode plan");
    expect(plan.command).toBe(edgePath);
    expect(plan.args).toContain(`--app=${url}`);
    expect(plan.args).toContain("--new-window");
    expect(plan.args).toContain("--no-first-run");
    expect(plan.args).toContain("--user-data-dir=C:\\Users\\writer\\.novelfork\\desktop-browser");
  });

  it("falls back to the default Windows browser when no app-mode browser is available", () => {
    const plan = buildDesktopWindowLaunchPlan({
      url,
      platform: "win32",
      env: {
        "ProgramFiles(x86)": "C:\\Program Files (x86)",
        ProgramFiles: "C:\\Program Files",
      },
      homeDir: "C:\\Users\\writer",
      pathExists: () => false,
    });

    expect(plan).toEqual({ kind: "browser", command: "explorer.exe", args: [url] });
  });

  it("honors explicit normal browser mode", () => {
    const plan = buildDesktopWindowLaunchPlan({
      url,
      platform: "win32",
      env: { NOVELFORK_WINDOW_MODE: "browser" },
      homeDir: "C:\\Users\\writer",
      pathExists: () => true,
    });

    expect(plan).toEqual({ kind: "browser", command: "explorer.exe", args: [url] });
  });
});

describe("desktop window disable switches and re-activation", () => {
  it("honors NARRAFORK_NO_BROWSER and window mode none", () => {
    expect(isDesktopWindowDisabled({ NARRAFORK_NO_BROWSER: "1" })).toBe(true);
    expect(isDesktopWindowDisabled({ NOVELFORK_NO_BROWSER: "1" })).toBe(true);
    expect(isDesktopWindowDisabled({ NOVELFORK_WINDOW_MODE: " None " })).toBe(true);
    expect(isDesktopWindowDisabled({ NOVELFORK_NO_BROWSER: "0" })).toBe(false);
    expect(
      buildDesktopWindowLaunchPlan({ url, platform: "win32", env: { NARRAFORK_NO_BROWSER: "1" }, pathExists: () => true }),
    ).toEqual({ kind: "none", reason: "disabled" });
  });

  it("focuses an open app window before opening a new one", () => {
    const focused: string[] = [];
    let opened = 0;
    const result = activateStudioWindow(url, {
      env: {},
      windowTitles: ["我的书房", undefined, " ", STUDIO_DOCUMENT_TITLE, "我的书房"],
      focusWindow: (title) => {
        focused.push(title);
        return title === STUDIO_DOCUMENT_TITLE;
      },
      open: () => {
        opened++;
        return { kind: "none", reason: "disabled" };
      },
    });
    expect(result).toEqual({ kind: "focused", title: STUDIO_DOCUMENT_TITLE });
    expect(focused).toEqual(["我的书房", STUDIO_DOCUMENT_TITLE]);
    expect(opened).toBe(0);
  });

  it("opens a window when none is found or focusing is unavailable", () => {
    const plan = { kind: "browser", command: "explorer.exe", args: [url] } as const;
    const openedUrls: string[] = [];
    const open = (target: string, options: { cleanServiceWorkerCache?: boolean }) => {
      openedUrls.push(target);
      // 再次启动时浏览器可能正开着这个 profile：不动它的缓存文件
      expect(options.cleanServiceWorkerCache).toBe(false);
      return plan;
    };
    expect(activateStudioWindow(url, { env: {}, windowTitles: ["NovelFork"], focusWindow: () => false, open })).toBe(plan);
    expect(activateStudioWindow(url, { env: {}, open })).toBe(plan);
    expect(openedUrls).toEqual([url, url]);
  });

  it("neither focuses nor opens when windows are disabled", () => {
    const result = activateStudioWindow(url, {
      env: { NOVELFORK_NO_BROWSER: "1" },
      windowTitles: ["NovelFork"],
      focusWindow: () => {
        throw new Error("must not focus");
      },
      open: () => {
        throw new Error("must not open");
      },
    });
    expect(result).toEqual({ kind: "none", reason: "disabled" });
  });

  it("does not focus in normal browser mode", () => {
    const plan = { kind: "browser", command: "explorer.exe", args: [url] } as const;
    const result = activateStudioWindow(url, {
      env: { NOVELFORK_WINDOW_MODE: "browser" },
      windowTitles: ["NovelFork"],
      focusWindow: () => {
        throw new Error("must not focus");
      },
      open: () => plan,
    });
    expect(result).toBe(plan);
  });
});

describe("desktop window origin", () => {
  it("treats every loopback spelling of one port as the same localhost window", () => {
    const origins = [
      "http://127.0.0.1:4567",
      "http://[::1]:4567/",
      "http://0.0.0.0:4567",
      "http://[::]:4567/api/health",
      "http://localhost:4567",
      "http://LOCALHOST:4567",
    ].map(desktopOrigin);
    expect(new Set(origins)).toEqual(new Set(["http://localhost:4567"]));
  });

  it("keeps the protocol, the port and non-loopback hosts apart", () => {
    expect(desktopOrigin("https://127.0.0.1:4567")).toBe("https://localhost:4567");
    expect(desktopOrigin("http://[::1]:4568")).toBe("http://localhost:4568");
    expect(desktopOrigin("http://192.168.1.5:4567/")).toBe("http://192.168.1.5:4567");
    expect(desktopOrigin("not a url")).toBe("not a url");
  });
});

describe("desktop launch mode", () => {
  const compiled = { platform: "win32" as const, argv: ["novelfork.exe"], compiled: true, env: {} };

  it("starts the Windows executable as the tray manager", () => {
    expect(resolveDesktopLaunchMode(compiled)).toBe("manager");
    // v0.1.1 的自动更新以 --serve 拉起替换进程：新版本照样接管为管理器。
    expect(resolveDesktopLaunchMode({ ...compiled, argv: ["novelfork.exe", "--serve"] })).toBe("manager");
  });

  it("runs the server directly for the manager's child and for headless runs", () => {
    expect(resolveDesktopLaunchMode({ ...compiled, env: { NARRAFORK_MANAGER_MANAGED: "1" } })).toBe("serve");
    expect(resolveDesktopLaunchMode({ ...compiled, env: { NOVELFORK_NO_BROWSER: "1" } })).toBe("serve");
    expect(resolveDesktopLaunchMode({ ...compiled, env: { NOVELFORK_WINDOW_MODE: "none" } })).toBe("serve");
  });

  it("keeps Linux, macOS and source runs on the server path unless --manager is asked for", () => {
    expect(resolveDesktopLaunchMode({ ...compiled, platform: "linux" })).toBe("serve");
    expect(resolveDesktopLaunchMode({ ...compiled, platform: "darwin" })).toBe("serve");
    expect(resolveDesktopLaunchMode({ ...compiled, compiled: false })).toBe("serve");
    expect(resolveDesktopLaunchMode({ ...compiled, compiled: false, argv: ["main.ts", "--manager"] })).toBe(
      "manager",
    );
    expect(resolveDesktopLaunchMode({ ...compiled, platform: "linux", argv: ["x", "--manager"] })).toBe("serve");
  });
});
