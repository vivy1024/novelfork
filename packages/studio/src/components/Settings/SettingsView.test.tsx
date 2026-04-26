import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_USER_CONFIG } from "@/types/settings";
import { SettingsView } from "../../pages/SettingsView";

const fetchJsonMock = vi.fn();
const putApiMock = vi.fn();

vi.mock("@/hooks/use-api", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
  putApi: (...args: unknown[]) => putApiMock(...args),
  useApi: (path: string | null) => {
    if (path === "/settings/user") {
      return {
        data: {
          preferences: {
            workbenchMode: true,
          },
        },
        loading: false,
        error: null,
        refetch: vi.fn(),
      };
    }
    if (path === "/settings/release") {
      return {
        data: {
          appName: "NovelFork Studio",
          version: "0.0.1",
          runtime: "bun",
          runtimeLabel: "Bun 本地单体",
          buildSource: "bun-source-server",
          buildLabel: "源码启动（Bun）",
          commit: "abc123def456",
          changelogUrl: "https://github.com/vivy1024/novelfork/releases",
          summary: "把版本、运行时与更新节奏放到作者看得懂的位置。",
          channels: [
            {
              id: "stable",
              label: "稳定通道",
              description: "默认推荐，适合长期连载、日更与正式写作项目，更新节奏更稳。",
              available: true,
              current: true,
            },
            {
              id: "beta",
              label: "Beta 通道",
              description: "预留给抢先体验桌面更新与平台升级的作者。",
              available: false,
            },
          ],
          changelog: [
            {
              title: "版本信息终于说人话了",
              summary: "作者能直接知道自己手上的工作台来自哪套构建。",
              highlights: ["显示版本、运行时与构建来源"],
            },
          ],
        },
        loading: false,
        error: null,
        refetch: vi.fn(),
      };
    }
    return { data: null, loading: false, error: null, refetch: vi.fn() };
  },
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

  it("renders author-facing release notes in the about section", async () => {
    render(<SettingsView nav={{}} theme="light" t={t} section="about" />);

    expect(screen.getByRole("heading", { name: "关于这台工作台" })).toBeTruthy();
    expect(await screen.findByText("版本信息终于说人话了")).toBeTruthy();
    expect(screen.getAllByText("稳定通道").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Beta 通道").length).toBeGreaterThan(0);
    expect(screen.getByText("abc123def456")).toBeTruthy();
  });
});
