import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetPanelLayoutCache } from "@/components/split-view/usePanelLayout";
import { StudioApp } from "./StudioApp";

// ---------------------------------------------------------------------------
// localStorage mock
// ---------------------------------------------------------------------------

let store: Record<string, string>;

beforeEach(() => {
  store = {};
  __resetPanelLayoutCache();

  const mockStorage = {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
    get length() { return Object.keys(store).length; },
    key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
  };

  Object.defineProperty(globalThis, "localStorage", {
    value: mockStorage,
    writable: true,
    configurable: true,
  });
});

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("StudioApp", () => {
  it("renders all three panels", () => {
    render(<StudioApp />);

    expect(screen.getByText("Sidebar")).toBeTruthy();
    expect(screen.getByText("Editor Area")).toBeTruthy();
    expect(screen.getByText("Conversation")).toBeTruthy();
  });

  it("renders the split-view container", () => {
    render(<StudioApp />);

    expect(screen.getByTestId("studio-app")).toBeTruthy();
    expect(screen.getByTestId("split-view")).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Keyboard shortcuts — collapse
  // -------------------------------------------------------------------------

  describe("keyboard shortcuts", () => {
    it("Ctrl+B toggles sidebar collapse", () => {
      render(<StudioApp />);

      expect(screen.getByText("Sidebar")).toBeTruthy();

      // Collapse
      fireEvent.keyDown(window, { key: "b", ctrlKey: true });
      expect(screen.queryByText("Sidebar")).toBeNull();

      // Expand
      fireEvent.keyDown(window, { key: "b", ctrlKey: true });
      expect(screen.getByText("Sidebar")).toBeTruthy();
    });

    it("Ctrl+J toggles conversation panel collapse", () => {
      render(<StudioApp />);

      expect(screen.getByText("Conversation")).toBeTruthy();

      // Collapse
      fireEvent.keyDown(window, { key: "j", ctrlKey: true });
      expect(screen.queryByText("Conversation")).toBeNull();

      // Expand
      fireEvent.keyDown(window, { key: "j", ctrlKey: true });
      expect(screen.getByText("Conversation")).toBeTruthy();
    });

    it("collapsed sidebar sets flex-basis to 0", () => {
      render(<StudioApp />);

      const sidebarPanel = screen.getByTestId("split-panel-sidebar");
      expect(sidebarPanel.style.flexBasis).toBe("220px");

      fireEvent.keyDown(window, { key: "b", ctrlKey: true });
      expect(sidebarPanel.style.flexBasis).toBe("0px");
    });

    it("collapsed conversation sets flex-basis to 0", () => {
      render(<StudioApp />);

      const convPanel = screen.getByTestId("split-panel-conversation");
      expect(convPanel.style.flexBasis).toBe("400px");

      fireEvent.keyDown(window, { key: "j", ctrlKey: true });
      expect(convPanel.style.flexBasis).toBe("0px");
    });
  });
});
