import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hostMocks = vi.hoisted(() => ({
  hostProps: [] as Array<{
    path: string;
    isEmbeddedPath: (pathname: string) => boolean;
    onPathChange?: (path: string) => void;
    onNavigateOutside?: (path: string) => void;
  }>,
}));

vi.mock("@vivy1024/narrafork-runtime-bridge/frontend/runtime-page", () => ({
  EmbeddedRuntimePageHost: (props: (typeof hostMocks.hostProps)[number]) => {
    hostMocks.hostProps.push(props);
    return <div data-testid="runtime-page-host-mock" data-path={props.path} />;
  },
}));

import { RoutinesNextPage, type RoutinesNextPageProps } from "./RoutinesNextPage";

beforeEach(() => {
  vi.clearAllMocks();
  hostMocks.hostProps.length = 0;
});

afterEach(() => {
  cleanup();
});

function renderPage(overrides: Partial<RoutinesNextPageProps> = {}) {
  const props: RoutinesNextPageProps = {
    route: { kind: "routines" },
    onNavigate: vi.fn(),
    onNavigateRuntimePath: vi.fn(),
    ...overrides,
  };
  const view = render(<RoutinesNextPage {...props} />);
  return { ...view, props, rerenderWith: (next: Partial<RoutinesNextPageProps>) => view.rerender(<RoutinesNextPage {...props} {...next} />) };
}

describe("套路页：只剩 Runtime 原页一层", () => {
  it("默认打开 Runtime 原生套路页", async () => {
    renderPage();

    expect((await screen.findByTestId("runtime-page-host-mock")).getAttribute("data-path")).toBe("/routines");
    const { isEmbeddedPath } = hostMocks.hostProps.at(-1)!;
    expect(isEmbeddedPath("/routines/tool-permissions")).toBe(true);
    expect(isEmbeddedPath("/settings")).toBe(false);
  });

  it("不再有「本书设置」页签：按书设置只有写作台一个入口", async () => {
    renderPage();
    await screen.findByTestId("runtime-page-host-mock");

    expect(screen.queryByRole("tablist", { name: "套路页签" })).toBeNull();
    expect(screen.queryByText("本书设置")).toBeNull();
    // 指向写作台的说明留在正文里，作者知道按书设置去哪。
    expect(screen.getByText(/写作台 › 本书设置/)).not.toBeNull();
  });

  it("Runtime 原页内跳转同步进 Studio 地址，跳出范围的链接交给外壳", async () => {
    const onNavigate = vi.fn();
    const onNavigateRuntimePath = vi.fn();
    renderPage({ onNavigate, onNavigateRuntimePath });
    await screen.findByTestId("runtime-page-host-mock");

    const { onPathChange, onNavigateOutside } = hostMocks.hostProps.at(-1)!;
    onPathChange?.("/routines/tool-permissions");
    expect(onNavigate).toHaveBeenCalledWith({ kind: "routines", path: "/routines/tool-permissions" });

    onNavigateOutside?.("/settings");
    expect(onNavigateRuntimePath).toHaveBeenCalledWith("/settings");
  });

  it("带 Runtime 子路径进入时把它交给原页", async () => {
    renderPage({ route: { kind: "routines", path: "/routines/hooks" } as RoutinesNextPageProps["route"] });

    expect((await screen.findByTestId("runtime-page-host-mock")).getAttribute("data-path")).toBe("/routines/hooks");
  });

  it("没有页签栏也能渲染（原页始终挂载）", async () => {
    const { container } = renderPage();
    await screen.findByTestId("runtime-page-host-mock");

    expect(container.querySelector('[data-testid="routines-runtime-page"]')).not.toBeNull();
    // 页签是历史遗留的 Studio 结构，删掉后不该有残留按钮。
    expect(screen.queryByRole("tab")).toBeNull();
    fireEvent.click(container);
  });
});
