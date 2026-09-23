import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchJson = vi.fn();

vi.mock("@/hooks/use-api", () => ({
  fetchJson: (...args: unknown[]) => fetchJson(...args),
  ApiRequestError: class ApiRequestError extends Error {
    status?: number;
    constructor(message: string, status?: number) {
      super(message);
      this.status = status;
    }
  },
}));

import { CanonicalTreesPanel } from "./CanonicalTreesPanel";

const entries = [
  { id: "c1", category: "characters", title: "薛行之", fields: { name: "薛行之", roleType: "主角" } },
  { id: "c2", category: "characters", title: "方工", fields: { name: "方工", roleType: "对手" } },
  { id: "l1", category: "locations", title: "灵科院西京分院", fields: { name: "灵科院西京分院" } },
  { id: "s1", category: "chapter-summaries", title: "第 1 章 归档", fields: { chapterNumber: 1 } },
  {
    id: "o1",
    category: "outline",
    title: "卷纲",
    fields: { volumes: [{ id: "vol-1", title: "西京篇", chapterRange: { from: 1, to: 2 }, status: "active" }] },
  },
];

beforeEach(() => {
  fetchJson.mockReset();
  fetchJson.mockImplementation(async (url: string) => {
    if (url.includes("narrative-memory/graph")) {
      return {
        facts: [],
        events: [
          { id: "e1", chapterNumber: 1, subject: "薛行之", predicate: "接手", object: "异常", eventType: "character_state_changed" },
        ],
        cooccurrence: {
          edges: [
            { source: "薛行之", target: "方工", weight: 0.9, coCount: 4 },
            { source: "薛行之", target: "灵科院西京分院", weight: 0.5, coCount: 2 },
          ],
        },
      };
    }
    return { entries };
  });
});

afterEach(() => {
  cleanup();
});

describe("CanonicalTreesPanel 四张正图", () => {
  it("默认打开世界观，tidy-tree 画出 NarraBench 层级", async () => {
    render(<CanonicalTreesPanel bookId="book-1" />);
    await waitFor(() => expect(screen.getByTestId("canonical-trees-panel")).toBeTruthy());
    expect(screen.getByTestId("tidy-tree-canvas").getAttribute("data-kind")).toBe("worldview");
    expect(screen.getByTestId("tidy-tree-row-dimension:story")).toBeTruthy();
  });

  it("可切到关系树，枢纽来自共现而不是脏短语", async () => {
    render(<CanonicalTreesPanel bookId="book-1" />);
    await waitFor(() => expect(screen.getByTestId("canonical-trees-panel")).toBeTruthy());
    fireEvent.click(screen.getByTestId("canonical-tree-tab-relations"));
    expect(screen.getByTestId("tidy-tree-canvas").getAttribute("data-kind")).toBe("relations");
    expect(screen.getByText("薛行之")).toBeTruthy();
    expect(screen.queryByText("自费转诊")).toBeNull();
  });

  it("章节图按卷纲分叉，占位章不假装已写", async () => {
    render(<CanonicalTreesPanel bookId="book-1" />);
    await waitFor(() => expect(screen.getByTestId("canonical-trees-panel")).toBeTruthy());
    fireEvent.click(screen.getByTestId("canonical-tree-tab-chapters"));
    expect(screen.getByText("西京篇")).toBeTruthy();
    expect(screen.getByTestId("tidy-tree-row-chapter:1")).toBeTruthy();
    expect(screen.getByTestId("tidy-tree-row-chapter:2")).toBeTruthy();
  });

  it("发展历程按章挂事件", async () => {
    render(<CanonicalTreesPanel bookId="book-1" />);
    await waitFor(() => expect(screen.getByTestId("canonical-trees-panel")).toBeTruthy());
    fireEvent.click(screen.getByTestId("canonical-tree-tab-timeline"));
    expect(screen.getByTestId("tidy-tree-canvas").getAttribute("data-kind")).toBe("timeline");
    expect(screen.getByTestId("tidy-tree-row-chapter:1")).toBeTruthy();
    expect(screen.getByTestId("tidy-tree-row-event:e1")).toBeTruthy();
  });

  it("章节脉络分表世界和里世界两枝", async () => {
    render(<CanonicalTreesPanel bookId="book-1" />);
    await waitFor(() => expect(screen.getByTestId("canonical-trees-panel")).toBeTruthy());
    fireEvent.click(screen.getByTestId("canonical-tree-tab-chronicle"));
    expect(screen.getByTestId("tidy-tree-canvas").getAttribute("data-kind")).toBe("chronicle");
    expect(screen.getByTestId("tidy-tree-row-chronicle:surface")).toBeTruthy();
    expect(screen.getByTestId("tidy-tree-row-chronicle:inner")).toBeTruthy();
  });

  it("独立入口可关掉切换条", async () => {
    render(<CanonicalTreesPanel bookId="book-1" initialKind="relations" showSwitcher={false} />);
    await waitFor(() => expect(screen.getByTestId("canonical-trees-panel")).toBeTruthy());
    expect(screen.queryByTestId("canonical-tree-tab-worldview")).toBeNull();
    expect(screen.getByTestId("tidy-tree-canvas").getAttribute("data-kind")).toBe("relations");
  });

  it("总图挂三棵浅层", async () => {
    render(<CanonicalTreesPanel bookId="book-1" />);
    await waitFor(() => expect(screen.getByTestId("canonical-trees-panel")).toBeTruthy());
    fireEvent.click(screen.getByTestId("canonical-tree-tab-overview"));
    expect(screen.getByTestId("tidy-tree-canvas").getAttribute("data-kind")).toBe("overview");
    expect(screen.getByTestId("tidy-tree-row-overview:relations")).toBeTruthy();
    expect(screen.getByTestId("tidy-tree-row-overview:worldview")).toBeTruthy();
    expect(screen.getByTestId("tidy-tree-row-overview:chapters")).toBeTruthy();
  });

  it("点条目回调 entryId", async () => {
    const onOpenEntry = vi.fn();
    render(<CanonicalTreesPanel bookId="book-1" onOpenEntry={onOpenEntry} />);
    await waitFor(() => expect(screen.getByTestId("canonical-trees-panel")).toBeTruthy());
    fireEvent.click(screen.getByTestId("canonical-tree-tab-relations"));
    fireEvent.click(screen.getByTestId("tidy-tree-node-rel:%E8%96%9B%E8%A1%8C%E4%B9%8B"));
    expect(onOpenEntry).toHaveBeenCalledWith("c1", "薛行之");
  });

  it("支持缩放、平移和拖节点改布局", async () => {
    function dispatchWindow(type: "pointermove" | "pointerup", clientX = 0, clientY = 0) {
      const EventCtor = window.PointerEvent ?? MouseEvent;
      window.dispatchEvent(new EventCtor(type, { bubbles: true, clientX, clientY, button: 0 }));
    }

    render(<CanonicalTreesPanel bookId="book-1" />);
    const canvas = await waitFor(() => screen.getByTestId("tidy-tree-canvas"));
    expect(canvas.getAttribute("data-zoom")).toBe("1.00");
    fireEvent.click(screen.getByTestId("tidy-tree-zoom-in"));
    expect(Number(canvas.getAttribute("data-zoom"))).toBeGreaterThan(1);
    fireEvent.click(screen.getByTestId("tidy-tree-reset"));
    expect(canvas.getAttribute("data-zoom")).toBe("1.00");

    fireEvent.pointerDown(canvas, { clientX: 40, clientY: 40, button: 0, buttons: 1 });
    fireEvent.pointerMove(canvas, { clientX: 90, clientY: 70, button: 0, buttons: 1 });
    dispatchWindow("pointermove", 90, 70);
    fireEvent.pointerUp(canvas, { clientX: 90, clientY: 70, button: 0 });
    expect(Number(canvas.getAttribute("data-pan-x"))).toBe(50);
    expect(Number(canvas.getAttribute("data-pan-y"))).toBe(30);

    const node = screen.getByTestId("tidy-tree-row-dimension:story");
    const beforeX = Number(node.getAttribute("data-x"));
    fireEvent.pointerDown(node, { clientX: 20, clientY: 20, button: 0, buttons: 1 });
    fireEvent.pointerMove(canvas, { clientX: 80, clientY: 20, button: 0, buttons: 1 });
    dispatchWindow("pointermove", 80, 20);
    fireEvent.pointerUp(canvas, { clientX: 80, clientY: 20, button: 0 });
    const afterX = Number(screen.getByTestId("tidy-tree-row-dimension:story").getAttribute("data-x"));
    expect(afterX).toBeGreaterThan(beforeX);
  });

  it("共现接口失败时降级提示，不挡世界观", async () => {
    fetchJson.mockImplementation(async (url: string) => {
      if (url.includes("narrative-memory/graph")) throw new Error("graph down");
      return { entries };
    });
    render(<CanonicalTreesPanel bookId="book-1" />);
    await waitFor(() => expect(screen.getByTestId("canonical-trees-degraded")).toBeTruthy());
  });

  it("kinds 属性支持按镜头精确筛选展示的子树集合", async () => {
    // 模拟理镜头：只看世界观与关系树
    render(<CanonicalTreesPanel bookId="book-1" kinds={["worldview", "relations"]} />);
    await waitFor(() => expect(screen.getByTestId("canonical-trees-panel")).toBeTruthy());

    expect(screen.getByTestId("canonical-tree-tab-worldview")).toBeTruthy();
    expect(screen.getByTestId("canonical-tree-tab-relations")).toBeTruthy();
    expect(screen.queryByTestId("canonical-tree-tab-chapters")).toBeNull();
    expect(screen.queryByTestId("canonical-tree-tab-causal")).toBeNull();
    expect(screen.queryByTestId("canonical-tree-tab-timeline")).toBeNull();
    expect(screen.queryByTestId("canonical-tree-tab-overview")).toBeNull();
  });
});
