import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_USER_CONFIG } from "@/types/settings";
import { SettingsView } from "../../pages/SettingsView";

const fetchJsonMock = vi.fn();
const putApiMock = vi.fn();

vi.mock("@/hooks/use-api", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
  putApi: (...args: unknown[]) => putApiMock(...args),
}));

const t = ((value: string) => value) as never;

beforeEach(() => {
  fetchJsonMock.mockReset();
  putApiMock.mockReset();
  fetchJsonMock.mockResolvedValue({ runtimeControls: DEFAULT_USER_CONFIG.runtimeControls });
  putApiMock.mockResolvedValue({ runtimeControls: DEFAULT_USER_CONFIG.runtimeControls });
});

afterEach(() => {
  cleanup();
});

describe("SettingsView", () => {
  it("uses the scaffold header and placeholder copy for shortcut sections", () => {
    render(<SettingsView nav={{}} theme="light" t={t} section="shortcuts" />);

    expect(screen.getByText("NovelFork Studio")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "快捷键" })).toBeTruthy();
    expect(screen.getByText("下一批会把命令面板、参考面板、保存等快捷键说明统一搬到这里。")).toBeTruthy();
  });

  it("renders the runtime control panel in the advanced section and keeps the legacy dialog entry", async () => {
    render(<SettingsView nav={{}} theme="light" t={t} section="advanced" />);

    expect(screen.getByRole("heading", { name: "高级设置" })).toBeTruthy();
    expect(screen.getByText("运行控制面板")).toBeTruthy();
    expect(screen.getByRole("button", { name: "打开高级设置窗口" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: "保存运行控制" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "打开高级设置窗口" }));

    expect(await screen.findByText("配置入口已迁移到设置中心")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "状态" }));
    expect(await screen.findByText("系统状态")).toBeTruthy();
  });
});
