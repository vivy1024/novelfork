import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const settingsMocks = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
const prefsMocks = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
const depsMocks = vi.hoisted(() => ({ checkAll: vi.fn() }));

vi.mock("../../runtime-admin", () => ({
  createSettingsClient: () => ({ get: settingsMocks.get, patch: settingsMocks.patch }),
  createUserPreferencesClient: () => ({ get: prefsMocks.get, patch: prefsMocks.patch }),
}));
vi.mock("../../runtime-admin/dependencies", () => ({
  createDependenciesClient: () => ({ checkAll: depsMocks.checkAll }),
}));
vi.mock("../runtime-settings-utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../runtime-settings-utils")>()),
  buildRuntimeModelOptions: () => [],
}));

import { SetupWizardPanel } from "./SetupWizardPanel";

beforeEach(() => {
  vi.clearAllMocks();
  settingsMocks.get.mockResolvedValue({});
  settingsMocks.patch.mockResolvedValue({});
  depsMocks.checkAll.mockResolvedValue({ dependencies: [] });
});

afterEach(() => {
  cleanup();
});

function nextButton() {
  return screen.getByRole("button", { name: /下一步/ });
}

async function gotoProviderStep() {
  fireEvent.click(nextButton()); // 欢迎 → 依赖检测
  fireEvent.click(nextButton()); // 依赖检测 → 供应商
  expect(await screen.findByText("至少配置一个 AI 供应商才能使用写作功能。")).toBeTruthy();
}

describe("初始配置向导：供应商步", () => {
  it("未配置供应商时给出真跳转且锁住下一步（此前只有一行死文字，而向导整页替换设置页，用户无路可去）", async () => {
    settingsMocks.get.mockResolvedValue({});
    const onGoToProviders = vi.fn();
    render(<SetupWizardPanel onComplete={vi.fn()} onGoToProviders={onGoToProviders} />);

    await gotoProviderStep();

    expect(screen.getByText("尚未配置供应商")).toBeTruthy();
    expect((nextButton() as HTMLButtonElement).disabled).toBe(true);

    const jump = screen.getByRole("button", { name: "去「设置 › AI 供应商」配置" });
    fireEvent.click(jump);
    expect(onGoToProviders).toHaveBeenCalledTimes(1);
  });

  it("已有供应商时识别数量并放行下一步，跳转仍然可用", async () => {
    settingsMocks.get.mockResolvedValue({
      customApiProviders: [{ apiKey: "k", disabled: false }],
    });
    render(<SetupWizardPanel onComplete={vi.fn()} onGoToProviders={vi.fn()} />);

    await gotoProviderStep();

    expect(screen.getByText("已配置 1 个供应商")).toBeTruthy();
    expect((nextButton() as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole("button", { name: "去「设置 › AI 供应商」配置" })).toBeTruthy();
  });
});
