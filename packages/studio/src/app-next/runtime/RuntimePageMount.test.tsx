import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hostProps: [] as Array<{ path: string; isEmbeddedPath: (pathname: string) => boolean; colorScheme?: string }>,
}));

vi.mock("@vivy1024/narrafork-runtime-bridge/frontend/runtime-page", () => ({
  EmbeddedRuntimePageHost: (props: { path: string; isEmbeddedPath: (pathname: string) => boolean; colorScheme?: string }) => {
    mocks.hostProps.push(props);
    return <div data-testid="runtime-page-host-mock" data-path={props.path} />;
  },
}));

import { RuntimePageMount } from "./RuntimePageMount";
import { runtimePageSectionOf } from "./runtime-page-sections";

afterEach(() => {
  cleanup();
  mocks.hostProps.length = 0;
});

describe("RuntimePageMount", () => {
  it("缺省打开入口根路径，只让页面在本入口范围内自行跳转", async () => {
    render(<RuntimePageMount section="knowledge" onPathChange={vi.fn()} onNavigateOutside={vi.fn()} />);
    expect((await screen.findByTestId("runtime-page-host-mock")).getAttribute("data-path")).toBe("/knowledge");
    const { isEmbeddedPath, colorScheme } = mocks.hostProps.at(-1)!;
    expect(colorScheme).toBe("light");
    expect(isEmbeddedPath("/knowledge")).toBe(true);
    expect(isEmbeddedPath("/knowledge/entry-1")).toBe(true);
    expect(isEmbeddedPath("/knowledge-base")).toBe(false);
    expect(isEmbeddedPath("/narrators/n-1")).toBe(false);
  });

  it("带子路径时原样交给 Runtime", async () => {
    render(<RuntimePageMount section="scheduled-tasks" path="/scheduled-tasks/t-1" onPathChange={vi.fn()} onNavigateOutside={vi.fn()} />);
    expect((await screen.findByTestId("runtime-page-host-mock")).getAttribute("data-path")).toBe("/scheduled-tasks/t-1");
  });
});

describe("runtimePageSectionOf", () => {
  it("按路径找到所属入口，不属于任何入口时为 null", () => {
    expect(runtimePageSectionOf("/search")).toBe("search");
    expect(runtimePageSectionOf("/scheduled-tasks/t-1")).toBe("scheduled-tasks");
    expect(runtimePageSectionOf("/routines")).toBeNull();
    expect(runtimePageSectionOf("/narrators/n-1")).toBeNull();
    expect(runtimePageSectionOf("/settings/profile")).toBeNull();
  });
});
