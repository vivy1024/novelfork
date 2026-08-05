import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dependenciesClientMock = vi.hoisted(() => ({
  checkAll: vi.fn(),
  install: vi.fn(),
}));

// Spread the real module so pure helpers (isInstallableDependency) stay authentic.
vi.mock("@/app-next/runtime-admin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app-next/runtime-admin")>()),
  createDependenciesClient: () => dependenciesClientMock,
}));

import { DependencyStatusPanel } from "./DependencyStatusPanel";

const normalResult = {
  platform: "windows" as const,
  packageManager: "winget",
  runtimeEnvironment: "desktop",
  dependencies: [
    {
      name: "git",
      required: true,
      installed: true,
      version: "2.43.0",
      platformSupported: true,
      installCommands: { winget: "winget install -e --id Git.Git" },
    },
    {
      name: "rg",
      required: false,
      installed: true,
      version: "14.1.0",
      platformSupported: true,
      installCommands: { winget: "winget install BurntSushi.ripgrep.MSVC" },
    },
    {
      name: "dtach",
      required: false,
      installed: false,
      platformSupported: false,
      installCommands: {},
    },
  ],
  allRequiredMet: true,
};

beforeEach(() => {
  dependenciesClientMock.checkAll.mockResolvedValue(normalResult);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DependencyStatusPanel", () => {
  it("loads and renders dependency status normally", async () => {
    render(<DependencyStatusPanel />);

    await waitFor(() => expect(dependenciesClientMock.checkAll).toHaveBeenCalledTimes(1));

    expect(await screen.findByText("git")).toBeTruthy();
    expect(screen.getByText("2.43.0")).toBeTruthy();
    expect(screen.getByText("rg")).toBeTruthy();
    expect(screen.getByText("14.1.0")).toBeTruthy();
    expect(screen.getByText("dtach")).toBeTruthy();
    expect(screen.getByText(/当前平台不支持/)).toBeTruthy();
    expect(screen.getByText("平台：windows")).toBeTruthy();
    expect(screen.getByText(/包管理器：winget/)).toBeTruthy();
    expect(screen.getByText(/所有必需依赖均已安装/)).toBeTruthy();
  });

  it("shows 403 error when user lacks admin permission", async () => {
    dependenciesClientMock.checkAll.mockRejectedValue(
      Object.assign(new Error("需要管理员权限"), { status: 403 }),
    );

    render(<DependencyStatusPanel />);

    expect(await screen.findByText(/403：检测依赖状态需要 Runtime 管理员权限/)).toBeTruthy();
    expect(screen.getByText("依赖检测失败")).toBeTruthy();
  });

  it("refreshes dependencies on button click", async () => {
    render(<DependencyStatusPanel />);
    await screen.findByText("git");

    const missingGitResult = {
      ...normalResult,
      allRequiredMet: false,
      dependencies: [
        { ...normalResult.dependencies[0], installed: false, version: undefined },
        ...normalResult.dependencies.slice(1),
      ],
    };
    dependenciesClientMock.checkAll.mockResolvedValue(missingGitResult);

    fireEvent.click(screen.getByRole("button", { name: /重新检测/ }));

    await waitFor(() => expect(dependenciesClientMock.checkAll).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/部分必需依赖缺失/)).toBeTruthy();
  });

  it("shows install command hint for missing dependencies", async () => {
    const missingRgResult = {
      ...normalResult,
      dependencies: [
        normalResult.dependencies[0],
        { ...normalResult.dependencies[1], installed: false, version: undefined },
        normalResult.dependencies[2],
      ],
    };
    dependenciesClientMock.checkAll.mockResolvedValue(missingRgResult);

    render(<DependencyStatusPanel />);
    await screen.findByText("rg");

    expect(screen.getByText("winget install BurntSushi.ripgrep.MSVC")).toBeTruthy();
    expect(screen.getByText("推荐安装命令：")).toBeTruthy();
  });

  it("确认后调用 Runtime 安装接口并重新检测状态", async () => {
    const missingRgResult = {
      ...normalResult,
      dependencies: [
        normalResult.dependencies[0],
        { ...normalResult.dependencies[1], installed: false, version: undefined },
        normalResult.dependencies[2],
      ],
    };
    dependenciesClientMock.checkAll.mockResolvedValue(missingRgResult);
    dependenciesClientMock.install.mockResolvedValue({
      ok: true,
      dependency: { ...normalResult.dependencies[1], installed: true, version: "14.1.1" },
    });

    render(<DependencyStatusPanel />);
    await screen.findByText("rg");

    // Installing runs a real package-manager command on the host, so it must be
    // confirmed before any request goes out.
    fireEvent.click(screen.getByRole("button", { name: /安装 rg/ }));
    expect(screen.getByText("确认安装 rg")).toBeTruthy();
    expect(dependenciesClientMock.install).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "确认安装" }));

    await waitFor(() => expect(dependenciesClientMock.install).toHaveBeenCalledWith("rg"));
    expect(await screen.findByText("rg 安装成功")).toBeTruthy();
    expect(screen.getByText("已安装 14.1.1")).toBeTruthy();
    // Status must be re-read from the Runtime, not inferred from the response.
    await waitFor(() => expect(dependenciesClientMock.checkAll).toHaveBeenCalledTimes(2));
  });

  it("安装失败时展示 Runtime 返回的真实原因", async () => {
    const missingRgResult = {
      ...normalResult,
      dependencies: [
        normalResult.dependencies[0],
        { ...normalResult.dependencies[1], installed: false, version: undefined },
        normalResult.dependencies[2],
      ],
    };
    dependenciesClientMock.checkAll.mockResolvedValue(missingRgResult);
    dependenciesClientMock.install.mockRejectedValue(
      Object.assign(new Error("winget exited with code 1"), { status: 500 }),
    );

    render(<DependencyStatusPanel />);
    await screen.findByText("rg");

    fireEvent.click(screen.getByRole("button", { name: /安装 rg/ }));
    fireEvent.click(screen.getByRole("button", { name: "确认安装" }));

    expect(await screen.findByText("rg 安装失败")).toBeTruthy();
    expect(screen.getByText(/winget exited with code 1/)).toBeTruthy();
  });

  it("取消确认后不发起安装请求", async () => {
    const missingRgResult = {
      ...normalResult,
      dependencies: [
        normalResult.dependencies[0],
        { ...normalResult.dependencies[1], installed: false, version: undefined },
        normalResult.dependencies[2],
      ],
    };
    dependenciesClientMock.checkAll.mockResolvedValue(missingRgResult);

    render(<DependencyStatusPanel />);
    await screen.findByText("rg");

    fireEvent.click(screen.getByRole("button", { name: /安装 rg/ }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(screen.queryByText("确认安装 rg")).toBeNull();
    expect(dependenciesClientMock.install).not.toHaveBeenCalled();
  });

  it("不为平台不支持或不可自动安装的依赖提供安装按钮", async () => {
    dependenciesClientMock.checkAll.mockResolvedValue({
      ...normalResult,
      allRequiredMet: false,
      dependencies: [
        // dtach is unsupported on Windows and has no install command.
        normalResult.dependencies[2],
        // A dependency outside the Runtime allowlist must not offer installation.
        {
          name: "pandoc",
          required: false,
          installed: false,
          platformSupported: true,
          installCommands: { winget: "winget install JohnMacFarlane.Pandoc" },
        },
      ],
    });

    render(<DependencyStatusPanel />);
    // pandoc has no localized description, so its name renders in both the title
    // and the description slot — match all occurrences rather than exactly one.
    await screen.findAllByText("pandoc");

    expect(screen.queryByRole("button", { name: /安装 dtach/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /安装 pandoc/ })).toBeNull();
    // The command hint is still useful for manual installation.
    expect(screen.getByText("winget install JohnMacFarlane.Pandoc")).toBeTruthy();
  });
});
