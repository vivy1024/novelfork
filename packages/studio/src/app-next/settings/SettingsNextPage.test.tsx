import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hostMocks = vi.hoisted(() => ({
  hostProps: [] as Array<{
    path: string;
    isEmbeddedPath: (pathname: string) => boolean;
    onPathChange?: (path: string) => void;
    onNavigateOutside?: (path: string) => void;
    hostExtension?: unknown;
  }>,
}));

vi.mock("@vivy1024/narrafork-runtime-bridge/frontend/runtime-page", () => ({
  EmbeddedRuntimePageHost: (props: (typeof hostMocks.hostProps)[number]) => {
    hostMocks.hostProps.push(props);
    return <div data-testid="runtime-page-host-mock" data-path={props.path} />;
  },
}));



import { SettingsNextPage, type SettingsNextPageProps } from "./SettingsNextPage";
import { NOVELFORK_SETTINGS_EXTENSION } from "./novelfork-settings-extension";

beforeEach(() => {
  vi.clearAllMocks();
  hostMocks.hostProps.length = 0;
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

describe("设置页：只有一层导航，Runtime 原页是唯一的设置界面", () => {
  it("默认打开 Runtime 原生设置页，Studio 不再叠加页签栏", async () => {
    renderPage();

    expect((await screen.findByTestId("runtime-page-host-mock")).getAttribute("data-path")).toBe("/settings");
    expect(screen.queryByRole("tablist", { name: "设置页签" })).toBeNull();
    const { isEmbeddedPath } = hostMocks.hostProps.at(-1)!;
    expect(isEmbeddedPath("/settings/providers")).toBe(true);
    expect(isEmbeddedPath("/settings/host/embedding")).toBe(true);
    expect(isEmbeddedPath("/routines")).toBe(false);
  });

  it("把「小说」分组（向量模型）并入 Runtime 侧栏，而不是另起一排页签", async () => {
    renderPage();
    await screen.findByTestId("runtime-page-host-mock");

    expect(hostMocks.hostProps.at(-1)!.hostExtension).toBe(NOVELFORK_SETTINGS_EXTENSION);
    const groups = NOVELFORK_SETTINGS_EXTENSION.groups ?? [];
    expect(groups.map((group) => group.label)).toEqual(["小说"]);
    expect(groups[0]!.pages.map((page) => page.label)).toEqual(["向量模型"]);
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
});
