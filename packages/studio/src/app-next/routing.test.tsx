import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const useShellDataMock = vi.hoisted(() => vi.fn());

vi.mock("./shell", async () => {
  const actual = await vi.importActual<typeof import("./shell")>("./shell");
  return {
    ...actual,
    useShellData: useShellDataMock,
  };
});

vi.mock("../hooks/use-ai-model-gate", () => ({
  useAiModelGate: () => ({ blockedResult: null, closeGate: vi.fn(), ensureModelFor: vi.fn(() => true) }),
}));

vi.mock("../components/InkEditor", () => ({
  getMarkdown: () => "",
  InkEditor: vi.fn(() => null),
}));

import { resolveStudioNextRoute } from "./entry";
import { StudioNextApp } from "./StudioNextApp";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

beforeEach(() => {
  useShellDataMock.mockReturnValue({
    books: [{ id: "b1", title: "测试书" }],
    sessions: [],
    providerSummary: null,
    providerStatus: null,
    loading: false,
    error: null,
  });
});

describe("Studio Next routing", () => {
  it("resolves sub-routes within the entry", () => {
    expect(resolveStudioNextRoute("/next")).toEqual({ kind: "home" });
    expect(resolveStudioNextRoute("/next/narrators/s1")).toEqual({ kind: "narrator", sessionId: "s1" });
    expect(resolveStudioNextRoute("/next/books/b1")).toEqual({ kind: "book", bookId: "b1" });
    expect(resolveStudioNextRoute("/next/settings")).toEqual({ kind: "settings" });
    expect(resolveStudioNextRoute("/next/routines")).toEqual({ kind: "routines" });
    expect(resolveStudioNextRoute("/next/search")).toEqual({ kind: "search" });
    expect(resolveStudioNextRoute("/next/unknown")).toEqual({ kind: "home" });
  });

  it("renders shell sidebar and content area", () => {
    render(<StudioNextApp initialRoute={{ kind: "home" }} />);

    const sidebar = screen.getByTestId("shell-sidebar");
    expect(sidebar).toBeTruthy();
    expect(within(screen.getByTestId("shell-main")).getByRole("heading", { name: "Agent Shell" })).toBeTruthy();
  });
});
