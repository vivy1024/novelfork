import { afterEach, describe, expect, it } from "vitest";

import { useWindowRuntimeStore } from "./windowRuntimeStore";

afterEach(() => {
  useWindowRuntimeStore.setState({ wsConnections: {} });
});

describe("useWindowRuntimeStore", () => {
  it("tracks websocket connectivity outside the persisted window shell", () => {
    useWindowRuntimeStore.getState().setWsConnected("window-1", true);
    expect(useWindowRuntimeStore.getState().wsConnections["window-1"]).toBe(true);

    useWindowRuntimeStore.getState().setWsConnected("window-1", false);
    expect(useWindowRuntimeStore.getState().wsConnections["window-1"]).toBe(false);
  });

  it("clears runtime tombstones when a window is removed", () => {
    useWindowRuntimeStore.getState().setWsConnected("window-1", true);
    useWindowRuntimeStore.getState().clearWindowRuntime("window-1");

    expect(useWindowRuntimeStore.getState().wsConnections).not.toHaveProperty("window-1");
  });
});
