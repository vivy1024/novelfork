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
});
