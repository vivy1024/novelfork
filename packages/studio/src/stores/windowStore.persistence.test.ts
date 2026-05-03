import { afterEach, describe, expect, it, vi } from "vitest";

const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage");

function stubWindowLocalStorage(value: Partial<Storage>) {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value,
  });
}

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  if (originalLocalStorageDescriptor) {
    Object.defineProperty(window, "localStorage", originalLocalStorageDescriptor);
  }
});

describe("useWindowStore persistence fallback", () => {
  it("keeps shell windows usable when localStorage exists without setItem", async () => {
    stubWindowLocalStorage({ getItem: () => null });

    const { useWindowStore } = await import("./windowStore");

    expect(() => useWindowStore.getState().addWindow({ agentId: "writer", title: "Writer 会话" })).not.toThrow();
    expect(useWindowStore.getState().windows).toHaveLength(1);
    expect(useWindowStore.getState().windows[0]).toMatchObject({ agentId: "writer", title: "Writer 会话" });
  });

  it("persists to usable localStorage without degrading to the memory fallback", async () => {
    const setItem = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    stubWindowLocalStorage({ getItem: () => null, setItem, removeItem: vi.fn() });

    const { useWindowStore } = await import("./windowStore");
    useWindowStore.getState().addWindow({ agentId: "writer", title: "Writer 会话" });

    expect(setItem).toHaveBeenCalledWith("novelfork-window-store", expect.stringContaining("Writer 会话"));
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps shell windows usable and warns when localStorage writes fail", async () => {
    const storageError = new Error("quota exceeded");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    stubWindowLocalStorage({
      getItem: () => null,
      setItem: () => { throw storageError; },
      removeItem: vi.fn(),
    });

    const { useWindowStore } = await import("./windowStore");

    expect(() => useWindowStore.getState().addWindow({ agentId: "writer", title: "Writer 会话" })).not.toThrow();
    expect(useWindowStore.getState().windows).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith("[windowStore] localStorage setItem failed; using memory fallback", storageError);
  });
});
