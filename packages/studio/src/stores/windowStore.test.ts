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
    expect(window?.sessionConfig).toBeUndefined();
  });
});
