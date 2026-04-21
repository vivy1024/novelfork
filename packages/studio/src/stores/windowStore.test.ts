import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("zustand/middleware", () => ({
  persist: (config: unknown) => config,
}));

import { useWindowStore } from "./windowStore";

afterEach(() => {
  useWindowStore.setState({ windows: [], activeWindowId: null });
});

describe("useWindowStore", () => {
  it("keeps addWindow focused on shell state without inventing session config", () => {
    useWindowStore.getState().addWindow({
      agentId: "writer",
      title: "Writer 会话",
    });

    const window = useWindowStore.getState().windows[0];
    expect(window).toMatchObject({
      agentId: "writer",
      title: "Writer 会话",
    });
    expect(window.sessionMode).toBeUndefined();
    expect(window).not.toHaveProperty("wsConnected");
  });

  it("retains sessionMode on the shell window state", () => {
    useWindowStore.getState().addWindow({
      agentId: "planner",
      title: "Planner 会话",
      sessionMode: "plan",
    });

    expect(useWindowStore.getState().windows[0]).toMatchObject({
      title: "Planner 会话",
      sessionMode: "plan",
    });
  });

  it("moves focus to the newest surviving window when the active shell closes", () => {
    useWindowStore.getState().addWindow({ agentId: "writer", title: "Writer 会话" });
    useWindowStore.getState().addWindow({ agentId: "planner", title: "Planner 会话" });

    const [first, second] = useWindowStore.getState().windows;
    expect(useWindowStore.getState().activeWindowId).toBe(second?.id);

    useWindowStore.getState().removeWindow(second!.id);
    expect(useWindowStore.getState().activeWindowId).toBe(first?.id);
  });
});
