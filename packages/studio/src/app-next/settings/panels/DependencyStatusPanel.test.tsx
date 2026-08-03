import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dependenciesClientMock = vi.hoisted(() => ({
  checkAll: vi.fn(),
}));

vi.mock("@/app-next/runtime-admin", () => ({
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
});
