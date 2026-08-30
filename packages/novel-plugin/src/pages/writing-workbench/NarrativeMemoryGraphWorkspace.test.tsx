import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchJsonMock = vi.hoisted(() => vi.fn());
const fitViewMock = vi.hoisted(() => vi.fn());
const setCenterMock = vi.hoisted(() => vi.fn());
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
  ReactFlow: ({ nodes, onNodeClick, onPaneClick, children, "data-slot": dataSlot, zoomOnScroll, "data-zoom-on-scroll": zoomFlag }: {
    nodes: Array<{ id: string; data: { model?: { title: string }; laneHeader?: { name: string }; chapterMarker?: { chapterNumber: number; storyTime?: string; label?: string }; onToggleLane?: (lane: string) => void } }>;
    onNodeClick?: (event: unknown, node: unknown) => void;
    onPaneClick?: () => void;
    children?: unknown;
    "data-slot"?: string;
    zoomOnScroll?: boolean;
    "data-zoom-on-scroll"?: string;
  }) => (
    <div data-slot={dataSlot} data-testid="react-flow-canvas" data-zoom-on-scroll={zoomFlag ?? (zoomOnScroll === false ? "false" : "true")}>
      <button type="button" onClick={() => onPaneClick?.()}>画布空白</button>
      {nodes.map((node) => {
        if (node.data.model) {
          return <button key={node.id} type="button" onClick={(event) => onNodeClick?.(event, node)}>{node.data.model.title}</button>;
        }
        if (node.data.laneHeader) {
          return (
            <button
              key={node.id}
              type="button"
              data-testid={`narrative-graph-lane-header-${node.data.laneHeader.name}`}
              onClick={() => node.data.onToggleLane?.(node.data.laneHeader!.name)}
            >
              {node.data.laneHeader.name}
            </button>
          );
        }
        if (node.data.chapterMarker) {
          const extra = node.data.chapterMarker.storyTime || node.data.chapterMarker.label;
          return (
            <div key={node.id} data-testid="narrative-graph-head-marker">
              第 {node.data.chapterMarker.chapterNumber} 章{extra ? ` · ${extra}` : " · 当前"}
            </div>
          );
        }
        return null;
      })}
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
  useReactFlow: () => ({ fitView: fitViewMock, setCenter: setCenterMock }),
  Position: { Left: "left", Right: "right" },
  BackgroundVariant: { Dots: "dots" },
}));

import { findChapterFocus, findNodeFocus, storyTimeLabel, NarrativeMemoryGraphWorkspace, type NarrativeGraphModel, type GraphNodeModel } from "./NarrativeMemoryGraphWorkspace";

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
    {
      id: "event-2",
      chapterNumber: 3,
      eventType: "character_state_changed",
      subject: "薛建国",
      predicate: "职业暴露病情需要",
      object: "自费转诊",
      confidence: 0.99,
      status: "applied",
      riskLevel: "low",
      evidenceText: "小腿肿了，要转市二院职业病科。",
    },
  ],
};

beforeEach(() => {
  fetchJsonMock.mockReset();
  fitViewMock.mockReset();
  setCenterMock.mockReset();
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
  fetchJsonMock.mockImplementation(async (url: string) => {
    if (String(url).includes("/state")) return { timeline: { entries: [] } };
    return String(url).includes("view=timeline") ? timelinePayload : relationshipPayload;
  });
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

  it("选中有来源章节的事实时可以回跳该章", async () => {
    const onOpenChapter = vi.fn();
    fetchJsonMock.mockImplementation(async () => ({
      view: "timeline",
      facts: relationshipPayload.facts,
      events: [],
    }));
    render(
      <NarrativeMemoryGraphWorkspace
        bookId="book-1"
        initialView="timeline"
        onOpenChapter={onOpenChapter}
      />,
    );
    await screen.findByTestId("react-flow-canvas");

    fireEvent.click(screen.getByRole("button", { name: "薛行之 · 异常感知伴随 · 鼻血" }));
    fireEvent.click(await screen.findByRole("button", { name: "打开来源第 2 章" }));
    expect(onOpenChapter).toHaveBeenCalledWith(2);
  });

  it("选中事件节点时可以回跳来源章节", async () => {
    const onOpenChapter = vi.fn();
    render(
      <NarrativeMemoryGraphWorkspace
        bookId="book-1"
        initialView="timeline"
        onOpenChapter={onOpenChapter}
      />,
    );
    await screen.findByTestId("react-flow-canvas");

    fireEvent.click(screen.getByRole("button", { name: "薛行之 · 触碰异常波形时出现 · 指尖电流与异常感知" }));
    fireEvent.click(await screen.findByRole("button", { name: "打开来源第 3 章" }));
    expect(onOpenChapter).toHaveBeenCalledWith(3);
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
    fetchJsonMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/state")) return { timeline: { entries: [] } };
      throw new Error("数据库暂不可用");
    });
    const { rerender } = render(<NarrativeMemoryGraphWorkspace bookId="book-1" />);
    expect(await screen.findByText("图谱暂时无法加载")).toBeTruthy();
    expect(screen.getByText("数据库暂不可用")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();

    fetchJsonMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/state")) return { timeline: { entries: [] } };
      return { view: "relationship", facts: [], events: [] };
    });
    rerender(<NarrativeMemoryGraphWorkspace bookId="book-2" />);
    expect(await screen.findByText("还没有可展示的叙事记忆")).toBeTruthy();
  });

  it("发展历程模式保留五个固定主题，并支持 anchor 章节/角色导航", async () => {
    const onOpenEntityDetail = vi.fn();
    render(
      <NarrativeMemoryGraphWorkspace
        bookId="book-1"
        mode="development"
        initialView="timeline"
        currentChapter={3}
        onOpenEntityDetail={onOpenEntityDetail}
      />,
    );

    await screen.findByTestId("react-flow-canvas");
    expect(String(fetchJsonMock.mock.calls.at(-1)?.[0] ?? "")).toContain("scope=read");
    for (const label of ["事件流层", "关系演化层", "矛盾冲突层"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }

    fireEvent.click(screen.getByRole("button", { name: "打开锚点导航" }));
    expect(screen.getByTestId("narrative-memory-graph-anchor")).toBeTruthy();
    setCenterMock.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "第 3 章 · 当前" }));
    await waitFor(() => expect(setCenterMock).toHaveBeenCalled());
    const latestUrl = String(fetchJsonMock.mock.calls.at(-1)?.[0] ?? "");
    expect(latestUrl).toContain("view=timeline");
    expect(latestUrl).not.toContain("chapterFrom=3");
    fireEvent.click(screen.getByRole("button", { name: "角色" }));
    fireEvent.click(screen.getByTitle("聚焦并查看 薛行之 的详情"));
    expect(onOpenEntityDetail).toHaveBeenCalledWith("薛行之");
  });

  it("角色锚点保留实体身份链 entryId", async () => {
    const onOpenEntityDetail = vi.fn();
    fetchJsonMock.mockImplementation(async () => ({
      view: "relationship",
      facts: [
        {
          ...relationshipPayload.facts[0],
          subjectEntryId: "entry-xuexingzhi",
        },
      ],
      events: [],
    }));
    render(<NarrativeMemoryGraphWorkspace bookId="book-1" onOpenEntityDetail={onOpenEntityDetail} />);
    await screen.findByTestId("react-flow-canvas");

    fireEvent.click(screen.getByRole("button", { name: "打开锚点导航" }));
    fireEvent.click(screen.getByRole("button", { name: "角色" }));
    fireEvent.click(screen.getByTitle("聚焦并查看 薛行之 的详情"));
    expect(onOpenEntityDetail).toHaveBeenCalledWith("薛行之", "entry-xuexingzhi");
  });

  it("打开时间线时平滑居中当前章，并渲染 HEAD 竖线与泳道行头", async () => {
    render(
      <NarrativeMemoryGraphWorkspace
        bookId="book-1"
        mode="development"
        initialView="timeline"
        currentChapter={3}
      />,
    );
    await screen.findByTestId("react-flow-canvas");
    await waitFor(() => expect(setCenterMock).toHaveBeenCalled());
    expect(setCenterMock.mock.calls.some((call) => call[2]?.duration === 400)).toBe(true);
    expect(screen.getByTestId("narrative-graph-head-marker")).toBeTruthy();
    expect(screen.getByTestId("narrative-graph-lane-header-薛行之")).toBeTruthy();
  });

  it("时间线关闭视口滚轮缩放，选中事件会滚到该节点", async () => {
    render(
      <NarrativeMemoryGraphWorkspace
        bookId="book-1"
        mode="development"
        initialView="timeline"
        currentChapter={3}
      />,
    );
    const canvas = await screen.findByTestId("react-flow-canvas");
    expect(canvas.getAttribute("data-zoom-on-scroll")).toBe("false");
    setCenterMock.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "薛行之 · 触碰异常波形时出现 · 指尖电流与异常感知" }));
    await waitFor(() => expect(setCenterMock).toHaveBeenCalled());
  });

  it("隐藏泳道后面板不再渲染该角色节点，chips 可再打开", async () => {
    fetchJsonMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/state")) {
        return { timeline: { entries: [{ chapter: 3, storyTime: "入门第三日" }] } };
      }
      return timelinePayload;
    });
    render(
      <NarrativeMemoryGraphWorkspace
        bookId="book-1"
        mode="development"
        initialView="timeline"
        currentChapter={3}
      />,
    );
    await screen.findByTestId("react-flow-canvas");
    expect(screen.getByText("第 3 章 · 入门第三日")).toBeTruthy();
    const chip = screen.getByTestId("narrative-graph-lane-chip-薛行之");
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(chip);
    expect(screen.getByTestId("narrative-memory-graph-workspace").getAttribute("data-hidden-lanes")).toBe("薛行之");
    expect(screen.getByTestId("narrative-graph-lane-chip-薛行之").getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByRole("button", { name: "薛行之 · 触碰异常波形时出现 · 指尖电流与异常感知" })).toBeNull();
    expect(screen.getByRole("button", { name: "薛建国 · 职业暴露病情需要 · 自费转诊" })).toBeTruthy();
    expect(screen.queryByTestId("narrative-graph-lanes-hidden-empty")).toBeNull();
    fireEvent.click(screen.getByTestId("narrative-graph-lane-chip-薛建国"));
    expect(screen.getByTestId("narrative-graph-lanes-hidden-empty")).toBeTruthy();
    fireEvent.click(screen.getByTestId("narrative-graph-lane-chip-薛行之"));
    expect(screen.getByRole("button", { name: "薛行之 · 触碰异常波形时出现 · 指尖电流与异常感知" })).toBeTruthy();
  });

  it("initialChapter 找不到时给出定位失败说明，不改筛选范围", async () => {
    render(
      <NarrativeMemoryGraphWorkspace
        bookId="book-1"
        mode="development"
        initialView="timeline"
        initialChapter={99}
      />,
    );
    expect((await screen.findByTestId("narrative-graph-locate-miss")).textContent).toContain("图谱里没有第 99 章");
    const latestUrl = String(fetchJsonMock.mock.calls.filter(([url]) => String(url).includes("/graph")).at(-1)?.[0] ?? "");
    expect(latestUrl).not.toContain("chapterFrom=99");
  });
});

// ---------------------------------------------------------------------------
// findChapterFocus：当前章定位与 HEAD 竖线坐标（纯函数）
// ---------------------------------------------------------------------------

describe("findChapterFocus", () => {
  const node = (id: string, chapter: number, x: number, y: number, w = 220, h = 96): GraphNodeModel => ({
    id,
    kind: "event",
    title: id,
    displayTitle: id,
    chapterNumber: chapter,
    position: { x, y },
    width: w,
    height: h,
  });
  const modelOf = (nodes: GraphNodeModel[]): NarrativeGraphModel => ({
    nodes,
    edges: [],
    stats: { nodeCount: nodes.length, edgeCount: 0, factCount: 0, eventCount: nodes.length, chapterCount: 2, entityCount: 0 },
  });

  it("返回当前章节点中心坐标与覆盖全图节点的竖线范围", () => {
    const model = modelOf([
      node("e1", 1, 220, 150),
      node("e2", 3, 780, 320),
      node("e3", 2, 500, 660),
    ]);
    const focus = findChapterFocus(model, 2);
    expect(focus?.cx).toBe(500 + 110);
    expect(focus?.cy).toBe(660 + 48);
    // 竖线从最高节点上方 120px 到最低节点（e3，y=660）下方 120px
    expect(focus?.lineTop).toBe(150 - 120);
    expect(focus?.lineBottom).toBe(660 + 96 + 120);
  });

  it("未传当前章或该章无节点时返回 null（回退 fitView）", () => {
    const model = modelOf([node("e1", 1, 220, 150)]);
    expect(findChapterFocus(model, undefined)).toBeNull();
    expect(findChapterFocus(model, 9)).toBeNull();
  });

  it("findNodeFocus 返回指定节点中心", () => {
    const model = modelOf([node("e1", 1, 220, 150), node("e2", 3, 780, 320)]);
    const focus = findNodeFocus(model, "e2");
    expect(focus?.cx).toBe(780 + 110);
    expect(focus?.cy).toBe(320 + 48);
    expect(findNodeFocus(model, "missing")).toBeNull();
  });

  it("storyTimeLabel 优先 storyTime，没有则用 label", () => {
    expect(storyTimeLabel({ storyTime: "入门第三日", label: "备选" })).toBe("入门第三日");
    expect(storyTimeLabel({ label: "备选" })).toBe("备选");
    expect(storyTimeLabel({})).toBeUndefined();
  });
});
