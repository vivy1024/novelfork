import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hostMocks = vi.hoisted(() => ({
  hostProps: [] as Array<{
    path: string;
    isEmbeddedPath: (pathname: string) => boolean;
    onPathChange?: (path: string) => void;
    onNavigateOutside?: (path: string) => void;
  }>,
}));

const prefsMocks = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock("@vivy1024/narrafork-runtime-bridge/frontend/runtime-page", () => ({
  EmbeddedRuntimePageHost: (props: (typeof hostMocks.hostProps)[number]) => {
    hostMocks.hostProps.push(props);
    return <div data-testid="runtime-page-host-mock" data-path={props.path} />;
  },
}));

vi.mock("../runtime-admin", async () => {
  const actual = await vi.importActual<typeof import("../runtime-admin")>("../runtime-admin");
  return { ...actual, createUserPreferencesClient: () => ({ get: prefsMocks.get }) };
});

// 产品面板换成桩组件：各自的行为有独立测试，这里只验证页签与挂载。
vi.mock("./panels/AppearancePanel", () => ({
  AppearancePanel: () => <div data-testid="appearance-panel-stub" />,
}));
vi.mock("./panels/EmbeddingSettingsPanel", () => ({
  EmbeddingSettingsPanel: () => <div data-testid="embedding-panel-stub" />,
}));
vi.mock("./panels/UsersPanel", () => ({
  UsersPanel: () => <div data-testid="users-panel-stub" />,
}));
vi.mock("./panels/AboutPanel", () => ({
  AboutPanel: () => <div data-testid="about-panel-stub" />,
}));
vi.mock("./panels/SetupWizardPanel", () => ({
  SetupWizardPanel: ({ onComplete }: { onComplete: () => void }) => (
    <button type="button" data-testid="setup-wizard-stub" onClick={onComplete}>向导弹幕</button>
  ),
}));

import { SettingsNextPage, type SettingsNextPageProps } from "./SettingsNextPage";

beforeEach(() => {
  vi.clearAllMocks();
  hostMocks.hostProps.length = 0;
  prefsMocks.get.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
});

function renderPage(overrides: Partial<SettingsNextPageProps> = {}) {
  const props: SettingsNextPageProps = {
    route: { kind: "settings" },
    onNavigate: vi.fn(),
    onNavigateRuntimePath: vi.fn(),
    ...overrides,
  };
  const view = render(<SettingsNextPage {...props} />);
  return { ...view, props, rerenderWith: (next: Partial<SettingsNextPageProps>) => view.rerender(<SettingsNextPage {...props} {...next} />) };
}

function pageTab(name: string) {
  return within(screen.getByRole("tablist", { name: "设置页签" })).getByRole("tab", { name });
}

describe("设置页：通用部分嵌入 Runtime 原页", () => {
  it("默认打开 Runtime 原生设置页，Studio 不再有自己的通用分区", async () => {
    renderPage();

    expect((await screen.findByTestId("runtime-page-host-mock")).getAttribute("data-path")).toBe("/settings");
    expect(pageTab("通用设置").getAttribute("aria-selected")).toBe("true");
    const { isEmbeddedPath } = hostMocks.hostProps.at(-1)!;
    expect(isEmbeddedPath("/settings/providers")).toBe(true);
    expect(isEmbeddedPath("/settings/plugins/some.plugin")).toBe(true);
    expect(isEmbeddedPath("/routines")).toBe(false);
    // 旧复制品的分区（个人资料、AI 供应商侧边导航……）不再由 Studio 渲染
    expect(screen.queryByRole("navigation", { name: "设置分区" })).toBeNull();
  });

  it("原页内跳转同步进 Studio 地址，跳出范围的链接交给外壳", async () => {
    const { props } = renderPage({ route: { kind: "settings", path: "/settings/providers" } });

    expect((await screen.findByTestId("runtime-page-host-mock")).getAttribute("data-path")).toBe("/settings/providers");
    const host = hostMocks.hostProps.at(-1)!;
    host.onPathChange?.("/settings/profile");
    expect(props.onNavigate).toHaveBeenCalledWith({ kind: "settings", path: "/settings/profile" });
    host.onNavigateOutside?.("/routines");
    expect(props.onNavigateRuntimePath).toHaveBeenCalledWith("/routines");
  });

  it("切到 NovelFork 面板时原页只是藏起来，切回去回到原来的子页", async () => {
    const view = renderPage({ route: { kind: "settings", path: "/settings/providers" } });
    await screen.findByTestId("runtime-page-host-mock");

    fireEvent.click(pageTab("Embedding 供应商"));
    expect(view.props.onNavigate).toHaveBeenLastCalledWith({ kind: "settings", panel: "embedding" });

    view.rerenderWith({ route: { kind: "settings", panel: "embedding" } });
    expect(screen.getByTestId("settings-runtime-page").hidden).toBe(true);
    expect(screen.getByTestId("runtime-page-host-mock").getAttribute("data-path")).toBe("/settings/providers");
    expect(pageTab("Embedding 供应商").getAttribute("aria-selected")).toBe("true");

    fireEvent.click(pageTab("通用设置"));
    expect(view.props.onNavigate).toHaveBeenLastCalledWith({ kind: "settings", path: "/settings/providers" });
  });

  it("直接打开 NovelFork 面板时不加载 Runtime 原页", () => {
    renderPage({ route: { kind: "settings", panel: "appearance" } });
    expect(screen.queryByTestId("runtime-page-host-mock")).toBeNull();
    expect(screen.getByTestId("appearance-panel-stub")).toBeTruthy();
  });

  it("四个 NovelFork 面板按地址挂载：外观、Embedding、用户、关于", () => {
    const one = renderPage({ route: { kind: "settings", panel: "embedding" } });
    expect(screen.getByTestId("embedding-panel-stub")).toBeTruthy();
    one.unmount();
    const two = renderPage({ route: { kind: "settings", panel: "users" } });
    expect(screen.getByTestId("users-panel-stub")).toBeTruthy();
    two.unmount();
    const three = renderPage({ route: { kind: "settings", panel: "about" } });
    expect(screen.getByTestId("about-panel-stub")).toBeTruthy();
    three.unmount();
  });
});

describe("设置页：初始向导", () => {
  it("setupWizardCompleted 为 false 时整页换成向导，两个世界的内容都不渲染", async () => {
    prefsMocks.get.mockResolvedValue({ setupWizardCompleted: false });
    renderPage({ route: { kind: "settings", path: "/settings/providers" } });

    expect(await screen.findByTestId("setup-wizard-stub")).toBeTruthy();
    expect(screen.queryByTestId("runtime-page-host-mock")).toBeNull();

    fireEvent.click(screen.getByTestId("setup-wizard-stub"));
    await waitFor(() => expect(screen.queryByTestId("setup-wizard-stub")).toBeNull());
    expect(await screen.findByTestId("runtime-page-host-mock")).toBeTruthy();
  });

  it("偏好读取失败时不拦设置页", async () => {
    prefsMocks.get.mockRejectedValue(new Error("offline"));
    renderPage();
    expect(await screen.findByTestId("runtime-page-host-mock")).toBeTruthy();
    expect(screen.queryByTestId("setup-wizard-stub")).toBeNull();
  });
});
