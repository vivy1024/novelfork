import React, { createRef } from "react";
import { act, cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SplitView, type SplitViewHandle, type SplitViewPanel } from "./SplitView";
import { usePanelLayout, __resetPanelLayoutCache, type PanelLayout } from "./usePanelLayout";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePanels(overrides?: Partial<SplitViewPanel>[]): SplitViewPanel[] {
  const defaults: SplitViewPanel[] = [
    { id: "left", content: <div>Left Content</div>, defaultWidth: 200, minWidth: 100 },
    { id: "center", content: <div>Center Content</div>, defaultWidth: 400, minWidth: 200 },
    { id: "right", content: <div>Right Content</div>, defaultWidth: 200, minWidth: 100 },
  ];
  if (!overrides) return defaults;
  return defaults.map((p, i) => ({ ...p, ...overrides[i] }));
}

// ---------------------------------------------------------------------------
// SplitView rendering
// ---------------------------------------------------------------------------

describe("SplitView", () => {
  afterEach(cleanup);

  it("renders all panels and handles between them", () => {
    render(<SplitView panels={makePanels()} />);

    expect(screen.getByTestId("split-panel-left")).toBeTruthy();
    expect(screen.getByTestId("split-panel-center")).toBeTruthy();
    expect(screen.getByTestId("split-panel-right")).toBeTruthy();

    // 3 panels → 2 handles
    expect(screen.getByTestId("split-handle-0")).toBeTruthy();
    expect(screen.getByTestId("split-handle-1")).toBeTruthy();
  });

  it("renders panel content", () => {
    render(<SplitView panels={makePanels()} />);

    expect(screen.getByText("Left Content")).toBeTruthy();
    expect(screen.getByText("Center Content")).toBeTruthy();
    expect(screen.getByText("Right Content")).toBeTruthy();
  });

  it("applies default flex-basis from defaultWidth", () => {
    render(<SplitView panels={makePanels()} />);

    const left = screen.getByTestId("split-panel-left");
    expect(left.style.flexBasis).toBe("200px");

    const center = screen.getByTestId("split-panel-center");
    expect(center.style.flexBasis).toBe("400px");
  });

  it("uses vertical direction when specified", () => {
    render(<SplitView panels={makePanels()} direction="vertical" />);

    const container = screen.getByTestId("split-view");
    expect(container.className).toContain("flex-col");
  });

  it("applies custom className", () => {
    render(<SplitView panels={makePanels()} className="my-custom-class" />);

    const container = screen.getByTestId("split-view");
    expect(container.className).toContain("my-custom-class");
  });

  // -------------------------------------------------------------------------
  // Collapse / expand
  // -------------------------------------------------------------------------

  describe("collapse", () => {
    it("does not render content for initially collapsed panels", () => {
      const panels = makePanels([{}, {}, { collapsed: true, collapsible: true }]);
      render(<SplitView panels={panels} />);

      expect(screen.queryByText("Right Content")).toBeNull();
      expect(screen.getByTestId("split-panel-right").style.flexBasis).toBe("0px");
    });

    it("toggles collapse via imperative handle", () => {
      const ref = createRef<SplitViewHandle>();
      render(<SplitView ref={ref} panels={makePanels()} />);

      // Initially visible
      expect(screen.getByText("Left Content")).toBeTruthy();

      // Collapse
      act(() => ref.current!.toggleCollapse("left"));
      expect(screen.queryByText("Left Content")).toBeNull();
      expect(screen.getByTestId("split-panel-left").style.flexBasis).toBe("0px");

      // Expand
      act(() => ref.current!.toggleCollapse("left"));
      expect(screen.getByText("Left Content")).toBeTruthy();
      expect(screen.getByTestId("split-panel-left").style.flexBasis).toBe("200px");
    });

    it("reports collapse changes via onLayoutChange", () => {
      const onChange = vi.fn();
      const ref = createRef<SplitViewHandle>();
      render(<SplitView ref={ref} panels={makePanels()} onLayoutChange={onChange} />);

      act(() => ref.current!.toggleCollapse("center"));

      const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
      expect(lastCall.collapsed.center).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Double-click to reset
  // -------------------------------------------------------------------------

  describe("double-click reset", () => {
    it("restores default widths on double-click", () => {
      const onChange = vi.fn();
      render(<SplitView panels={makePanels()} onLayoutChange={onChange} />);

      const handle = screen.getByTestId("split-handle-0");

      // Simulate a drag to change widths first
      fireEvent.pointerDown(handle, { clientX: 200, pointerId: 1 });
      fireEvent.pointerMove(handle, { clientX: 250 });
      fireEvent.pointerUp(handle);

      // Widths should have changed
      const afterDrag = onChange.mock.calls[onChange.mock.calls.length - 1][0];
      expect(afterDrag.widths.left).not.toBe(200);

      // Double-click to reset
      fireEvent.doubleClick(handle);

      const afterReset = onChange.mock.calls[onChange.mock.calls.length - 1][0];
      expect(afterReset.widths.left).toBe(200);
      expect(afterReset.widths.center).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // Drag resize
  // -------------------------------------------------------------------------

  describe("drag resize", () => {
    it("updates widths on pointer drag", () => {
      const onChange = vi.fn();
      render(<SplitView panels={makePanels()} onLayoutChange={onChange} />);

      const handle = screen.getByTestId("split-handle-0");

      fireEvent.pointerDown(handle, { clientX: 200, pointerId: 1 });
      fireEvent.pointerMove(handle, { clientX: 250 });
      fireEvent.pointerUp(handle);

      const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
      // Left should grow by 50, center should shrink by 50
      expect(lastCall.widths.left).toBe(250);
      expect(lastCall.widths.center).toBe(350);
    });

    it("enforces minimum widths during drag", () => {
      const onChange = vi.fn();
      render(<SplitView panels={makePanels()} onLayoutChange={onChange} />);

      const handle = screen.getByTestId("split-handle-0");

      // Drag far left — should clamp to left panel's minWidth (100)
      fireEvent.pointerDown(handle, { clientX: 200, pointerId: 1 });
      fireEvent.pointerMove(handle, { clientX: 0 });
      fireEvent.pointerUp(handle);

      const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
      expect(lastCall.widths.left).toBe(100); // minWidth
    });

    it("shows dragging style on handle during drag", () => {
      render(<SplitView panels={makePanels()} />);

      const handle = screen.getByTestId("split-handle-0");

      // Before drag — should have hover:bg-border class
      expect(handle.className).toContain("hover:bg-border");

      // During drag
      fireEvent.pointerDown(handle, { clientX: 200, pointerId: 1 });
      expect(handle.className).toContain("bg-primary/30");

      // After drag
      fireEvent.pointerUp(handle);
      expect(handle.className).toContain("hover:bg-border");
    });
  });

  // -------------------------------------------------------------------------
  // Handle accessibility
  // -------------------------------------------------------------------------

  it("handles have separator role and correct orientation", () => {
    render(<SplitView panels={makePanels()} />);

    const handle = screen.getByTestId("split-handle-0");
    expect(handle.getAttribute("role")).toBe("separator");
    expect(handle.getAttribute("aria-orientation")).toBe("vertical");
  });

  it("vertical handles have horizontal orientation", () => {
    render(<SplitView panels={makePanels()} direction="vertical" />);

    const handle = screen.getByTestId("split-handle-0");
    expect(handle.getAttribute("aria-orientation")).toBe("horizontal");
  });
});

// ---------------------------------------------------------------------------
// usePanelLayout
// ---------------------------------------------------------------------------

function LayoutTestHarness({ layoutKey, defaults }: { layoutKey: string; defaults: PanelLayout }) {
  const { layout, setWidth, toggleCollapsed, resetToDefaults } = usePanelLayout(layoutKey, defaults);

  return (
    <div>
      <span data-testid="widths">{JSON.stringify(layout.widths)}</span>
      <span data-testid="collapsed">{JSON.stringify(layout.collapsed)}</span>
      <button data-testid="set-width" onClick={() => setWidth("left", 300)}>
        Set Width
      </button>
      <button data-testid="toggle-left" onClick={() => toggleCollapsed("left")}>
        Toggle Left
      </button>
      <button data-testid="reset" onClick={() => resetToDefaults()}>
        Reset
      </button>
    </div>
  );
}

describe("usePanelLayout", () => {
  const STORAGE_KEY = "novelfork-panel-layout-test-layout";
  const defaults: PanelLayout = {
    widths: { left: 200, right: 300 },
    collapsed: { left: false, right: false },
  };

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

  it("returns defaults when no stored data exists", () => {
    render(<LayoutTestHarness layoutKey="test-layout" defaults={defaults} />);

    expect(screen.getByTestId("widths").textContent).toBe(JSON.stringify(defaults.widths));
    expect(screen.getByTestId("collapsed").textContent).toBe(JSON.stringify(defaults.collapsed));
  });

  it("persists width changes to localStorage", () => {
    render(<LayoutTestHarness layoutKey="test-layout" defaults={defaults} />);

    act(() => {
      screen.getByTestId("set-width").click();
    });

    expect(screen.getByTestId("widths").textContent).toContain('"left":300');

    const stored = JSON.parse(store[STORAGE_KEY]!);
    expect(stored.widths.left).toBe(300);
  });

  it("persists collapse toggle to localStorage", () => {
    render(<LayoutTestHarness layoutKey="test-layout" defaults={defaults} />);

    act(() => {
      screen.getByTestId("toggle-left").click();
    });

    expect(screen.getByTestId("collapsed").textContent).toContain('"left":true');

    const stored = JSON.parse(store[STORAGE_KEY]!);
    expect(stored.collapsed.left).toBe(true);
  });

  it("reads persisted data on mount", () => {
    const saved: PanelLayout = {
      widths: { left: 500, right: 100 },
      collapsed: { left: true, right: false },
    };
    store[STORAGE_KEY] = JSON.stringify(saved);

    render(<LayoutTestHarness layoutKey="test-layout" defaults={defaults} />);

    expect(screen.getByTestId("widths").textContent).toBe(JSON.stringify(saved.widths));
    expect(screen.getByTestId("collapsed").textContent).toBe(JSON.stringify(saved.collapsed));
  });

  it("resets to defaults", () => {
    render(<LayoutTestHarness layoutKey="test-layout" defaults={defaults} />);

    // Change something first
    act(() => {
      screen.getByTestId("set-width").click();
    });
    expect(screen.getByTestId("widths").textContent).toContain('"left":300');

    // Reset
    act(() => {
      screen.getByTestId("reset").click();
    });
    expect(screen.getByTestId("widths").textContent).toBe(JSON.stringify(defaults.widths));

    const stored = JSON.parse(store[STORAGE_KEY]!);
    expect(stored.widths.left).toBe(200);
  });
});
