import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const useShellDataMock = vi.hoisted(() => vi.fn());
const useRuntimeShellDataMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("./shell", async () => {
  const actual = await vi.importActual<typeof import("./shell")>("./shell");
  return {
    ...actual,
    useShellData: useShellDataMock,
  };
});

vi.mock("./runtime/useRuntimeShellData", () => ({
  useRuntimeShellData: useRuntimeShellDataMock,
}));

import { StudioNextApp } from "./StudioNextApp";
import { RouterTestHarness } from "./test-helpers/router-harness";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: new MemoryStorage() });
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: new MemoryStorage() });
  fetchMock.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const shellData = {
    books: [{ id: "book-1", title: "测试作品" }],
    sessions: [],
    providerSummary: null,
    providerStatus: { hasUsableModel: true },
    loading: false,
    error: null,
    reload: vi.fn(),
  };
  useShellDataMock.mockReturnValue(shellData);
  useRuntimeShellDataMock.mockReturnValue(shellData);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("StudioNextApp product entry", () => {
  it("mounts the existing AgentShell and author home instead of the standalone Runtime P0 shell", async () => {
    render(<RouterTestHarness component={() => <StudioNextApp />} initialPath="/next" />);

    expect(await screen.findByTestId("shell-sidebar")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "作者首页" })).toBeTruthy();
    expect(screen.getByText("测试作品")).toBeTruthy();
    expect(screen.queryByTestId("runtime-p0-shell")).toBeNull();
  });
});
