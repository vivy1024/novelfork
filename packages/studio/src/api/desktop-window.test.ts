import { describe, expect, it } from "vitest";

import { buildDesktopWindowLaunchPlan } from "./desktop-window";

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
      env: { "ProgramFiles(x86)": "C:\\Program Files (x86)", ProgramFiles: "C:\\Program Files" },
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
      env: { "ProgramFiles(x86)": "C:\\Program Files (x86)", ProgramFiles: "C:\\Program Files" },
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
