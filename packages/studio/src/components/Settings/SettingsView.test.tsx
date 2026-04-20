import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

describe("SettingsView", () => {
  it("uses the scaffold header and empty state for placeholder sections", () => {
    render(<SettingsView nav={{}} theme="light" t={t} section="shortcuts" />);

    expect(screen.getByText("NovelFork Studio")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "快捷键" })).toBeTruthy();
    expect(screen.getByText("命令面板、保存、导航等快捷键说明会在这里统一收口。")).toBeTruthy();
  });

  it("embeds migrated legacy settings content and runtime controls into the advanced section", async () => {
    render(<SettingsView nav={{}} theme="light" t={t} section="advanced" />);

    expect(screen.getByText("主入口 · 统一数据源")).toBeTruthy();
    expect(screen.queryByText("打开高级设置窗口")).toBeNull();
    expect(await screen.findByText("运行控制面板")).toBeTruthy();
    expect(await screen.findByText("配置入口已迁移到设置中心")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "状态" }));
    expect(await screen.findByText("系统状态")).toBeTruthy();
  });
});
