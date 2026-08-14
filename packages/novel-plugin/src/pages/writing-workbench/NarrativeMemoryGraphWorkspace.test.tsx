import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchJsonMock = vi.hoisted(() => vi.fn());
const fitViewMock = vi.hoisted(() => vi.fn());
let observedContainerWidth = 600;
const resizeObserverCallbacks: ResizeObserverCallback[] = [];

vi.mock("@/hooks/use-api", () => ({
  fetchJson: fetchJsonMock,
  ApiRequestError: class ApiRequestError extends Error {
    status?: number;
    constructor(message: string, status?: number) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock("@xyflow/react", () => ({
  ReactFlowProvider: ({ children }: { children: unknown }) => children,
  ReactFlow: ({ nodes, onNodeClick, onPaneClick, children, "data-slot": dataSlot }: { nodes: Array<{ id: string; data: { model: { title: string } } }>; onNodeClick?: (event: unknown, node: unknown) => void; onPaneClick?: () => void; children?: unknown; "data-slot"?: string }) => (
    <div data-slot={dataSlot} data-testid="react-flow-canvas">
      <button type="button" onClick={() => onPaneClick?.()}>画布空白</button>
      {nodes.map((node) => (
        <button key={node.id} type="button" onClick={(event) => onNodeClick?.(event, node)}>{node.data.model.title}</button>
      ))}
      {children}
    </div>
  ),
  Background: () => <div data-testid="react-flow-background" />,
  Controls: () => <div data-testid="react-flow-controls" />,
  MiniMap: () => <div data-testid="react-flow-minimap" />,
  Panel: ({ children }: { children: unknown }) => <div>{children}</div>,
  Handle: () => null,
  BaseEdge: () => null,
  EdgeLabelRenderer: ({ children }: { children: unknown }) => children,
  getBezierPath: () => ["M0 0", 0, 0],
  useReactFlow: () => ({ fitView: fitViewMock }),
  Position: { Left: "left", Right: "right" },
  BackgroundVariant: { Dots: "dots" },
}));

import { NarrativeMemoryGraphWorkspace } from "./NarrativeMemoryGraphWorkspace";

const relationshipPayload = {
  view: "relationship",
  facts: [
    {
      id: "fact-1",
      subject: "薛行之",
      predicate: "异常感知伴随",
      object: "鼻血",
      category: "relationship",
      layer: "dynamic",
      confidence: 0.98,
      sourceChapter: 2,
      evidenceText: "薛行之回过神，鼻血滴在键盘上。",
    },
  ],
  events: [],
};

const timelinePayload = {
  view: "timeline",
  facts: [],
  events: [
    {
      id: "event-1",
      chapterNumber: 3,
      eventType: "character_state_changed",
      subject: "薛行之",
      predicate: "触碰异常波形时出现",
      object: "指尖电流与异常感知",
      confidence: 0.98,
      status: "applied",
      riskLevel: "medium",
      evidenceText: "正文证据",
    },
  ],
};

beforeEach(() => {
  fetchJsonMock.mockReset();
  fitViewMock.mockReset();
  observedContainerWidth = 600;
  resizeObserverCallbacks.length = 0;
  vi.stubGlobal("ResizeObserver", class ResizeObserverMock {
    readonly callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
      resizeObserverCallbacks.push(callback);
    }
    observe(target: Element) {
      this.callback([{ target, contentRect: { width: observedContainerWidth } } as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    disconnect() {}
    unobserve() {}
  });
  fetchJsonMock.mockImplementation(async (url: string) => url.includes("view=timeline") ? timelinePayload : relationshipPayload);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("NarrativeMemoryGraphWorkspace", () => {
  it("按入口 initialView 加载真正的 React Flow 独立画布", async () => {
    render(<NarrativeMemoryGraphWorkspace bookId="book-1" initialView="timeline" />);

    const canvas = await screen.findByTestId("react-flow-canvas");
    expect(canvas.getAttribute("data-slot")).toBe("narrative-memory-graph-canvas");
    expect(screen.getByTestId("narrative-memory-graph-workspace").getAttribute("data-slot")).toBe("narrative-memory-graph-workspace");
    expect(fetchJsonMock.mock.calls.some(([url]) => String(url).includes("view=timeline"))).toBe(true);
    expect(screen.getByTestId("react-flow-controls")).toBeTruthy();
    expect(screen.getByTestId("react-flow-minimap")).toBeTruthy();
    fitViewMock.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "重置视口" }));
    expect(fitViewMock).toHaveBeenCalledWith({ padding: 0.18, duration: 250 });
    expect(screen.queryByLabelText("Narrative Memory 动态事实图谱")).toBeNull();
    expect(screen.queryByText("第 3 章 · character_state_changed", { selector: "span" })).toBeNull();
  });

  it("切换视图、聚焦实体和章节范围时生成正确请求参数", async () => {
    render(<NarrativeMemoryGraphWorkspace bookId="book/1" initialView="timeline" />);
    await screen.findByTestId("react-flow-canvas");

    fireEvent.click(screen.getByRole("button", { name: "关系图" }));
    await waitFor(() => expect(fetchJsonMock.mock.calls.some(([url]) => String(url).includes("view=relationship"))).toBe(true));

    fireEvent.change(screen.getByPlaceholderText("聚焦实体，例如：薛行之"), { target: { value: "薛行之" } });
    fireEvent.click(screen.getByRole("button", { name: "聚焦" }));
    await waitFor(() => expect(fetchJsonMock.mock.calls.some(([url]) => String(url).includes("focusEntity=%E8%96%9B%E8%A1%8C%E4%B9%8B"))).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: "章节筛选" }));
    fireEvent.change(screen.getByLabelText("起始章节"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("结束章节"), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "应用范围" }));
    await waitFor(() => expect(fetchJsonMock.mock.calls.some(([url]) => String(url).includes("chapterFrom=2") && String(url).includes("chapterTo=9"))).toBe(true));

    fireEvent.change(screen.getByLabelText("结束章节"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "应用范围" }));
    await waitFor(() => {
      const latestUrl = String(fetchJsonMock.mock.calls.at(-1)?.[0] ?? "");
      expect(latestUrl).toContain("chapterFrom=2");
      expect(latestUrl).not.toContain("chapterTo=");
    });
  });

  it("选中实体后显示完整检查器并打开统一实体详情抽屉", async () => {
    const onOpenEntityDetail = vi.fn();
    render(<NarrativeMemoryGraphWorkspace bookId="book-1" onOpenEntityDetail={onOpenEntityDetail} />);
    await screen.findByTestId("react-flow-canvas");

    fireEvent.click(screen.getByRole("button", { name: "薛行之" }));
    const detailButtons = await screen.findAllByRole("button", { name: "查看实体完整详情" });
    fireEvent.click(detailButtons[0]!);
    expect(onOpenEntityDetail).toHaveBeenCalledWith("薛行之");
  });

  it("按图谱容器宽度切换详情侧栏与浮层", async () => {
    render(<NarrativeMemoryGraphWorkspace bookId="book-1" />);
    await screen.findByTestId("react-flow-canvas");
    fireEvent.click(screen.getByRole("button", { name: "薛行之" }));

    expect(await screen.findByTestId("narrative-graph-inspector-overlay")).toBeTruthy();
    expect(screen.queryByTestId("narrative-graph-inspector-sidebar")).toBeNull();

    const workspace = screen.getByTestId("narrative-memory-graph-workspace");
    observedContainerWidth = 900;
    act(() => {
      for (const callback of resizeObserverCallbacks) {
        callback([{ target: workspace, contentRect: { width: observedContainerWidth } } as ResizeObserverEntry], {} as ResizeObserver);
      }
    });

    expect(await screen.findByTestId("narrative-graph-inspector-sidebar")).toBeTruthy();
    expect(screen.queryByTestId("narrative-graph-inspector-overlay")).toBeNull();
  });

  it("错误和空数据都有明确恢复入口", async () => {
    fetchJsonMock.mockRejectedValueOnce(new Error("数据库暂不可用"));
    const { rerender } = render(<NarrativeMemoryGraphWorkspace bookId="book-1" />);
    expect(await screen.findByText("图谱暂时无法加载")).toBeTruthy();
    expect(screen.getByText("数据库暂不可用")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();

    fetchJsonMock.mockResolvedValueOnce({ view: "relationship", facts: [], events: [] });
    rerender(<NarrativeMemoryGraphWorkspace bookId="book-2" />);
    expect(await screen.findByText("还没有可展示的叙事记忆")).toBeTruthy();
  });
});
