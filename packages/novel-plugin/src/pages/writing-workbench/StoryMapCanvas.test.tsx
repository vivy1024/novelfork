import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  StoryMapCanvas,
  snapshotToFlowElements,
  type StoryMapNodeData,
} from "./StoryMapCanvas";
import type { NarrativeLineSnapshot } from "../../handlers/narrative-line-types";

// Mock @xyflow/react
vi.mock("@xyflow/react", () => {
  return {
    ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="rf-provider">{children}</div>,
    ReactFlow: ({ nodes, edges, children }: { nodes: any[]; edges: any[]; children: React.ReactNode }) => (
      <div data-testid="react-flow-mock">
        <div data-testid="rf-nodes-count">{nodes.length}</div>
        <div data-testid="rf-edges-count">{edges.length}</div>
        {nodes.map((node) => (
          <div key={node.id} data-testid={`rendered-node-${node.id}`}>
            <span>{node.data.title}</span>
            {node.data.chapterNumber && (
              <button
                type="button"
                data-testid={`jump-btn-${node.id}`}
                onClick={() => node.data.onOpenChapter?.(node.data.chapterNumber)}
              >
                跳转章节
              </button>
            )}
            {node.data.onPromote && (
              <button
                type="button"
                data-testid={`promote-btn-${node.id}`}
                onClick={() => node.data.onPromote?.(node.data)}
              >
                提拔落稿
              </button>
            )}
          </div>
        ))}
        {children}
      </div>
    ),
    Background: () => <div data-testid="rf-background" />,
    Controls: () => <div data-testid="rf-controls" />,
    MiniMap: () => <div data-testid="rf-minimap" />,
    Panel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Handle: () => <div data-testid="rf-handle" />,
    Position: { Left: "left", Right: "right" },
    BackgroundVariant: { Dots: "dots" },
  };
});

const mockSnapshot: NarrativeLineSnapshot = {
  bookId: "book-1",
  nodes: [
    {
      id: "node-chap-1",
      bookId: "book-1",
      type: "chapter",
      title: "第一章 灵潮初起",
      summary: "天地异变，少年执剑启程。",
      chapterNumber: 1,
      status: "completed",
    },
    {
      id: "node-arc-1",
      bookId: "book-1",
      type: "character-arc",
      title: "沈舟：心境觉醒",
      summary: "从迷惘走向坚定。",
      chapterNumber: 2,
    },
    {
      id: "node-conflict-1",
      bookId: "book-1",
      type: "conflict",
      title: "黑水宗逼压",
      summary: "外门长老突袭引发宗门危机。",
      chapterNumber: 3,
    },
    {
      id: "node-foreshadow-1",
      bookId: "book-1",
      type: "foreshadow",
      title: "青铜残片异动",
      summary: "残片中隐现古神低语。",
      chapterNumber: 4,
    },
  ],
  edges: [
    {
      id: "edge-1",
      bookId: "book-1",
      fromNodeId: "node-chap-1",
      toNodeId: "node-arc-1",
      type: "causes",
      confidence: "explicit",
    },
    {
      id: "edge-2",
      bookId: "book-1",
      fromNodeId: "node-arc-1",
      toNodeId: "node-conflict-1",
      type: "escalates",
      confidence: "explicit",
    },
    {
      id: "edge-invalid",
      bookId: "book-1",
      fromNodeId: "node-conflict-1",
      toNodeId: "node-non-exist",
      type: "supports",
      confidence: "inferred",
    },
  ],
  warnings: [],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("snapshotToFlowElements 纯函数转换", () => {
  it("正确将快照转换为 Flow 节点与边，并过滤非法边", () => {
    const { nodes, edges } = snapshotToFlowElements(mockSnapshot);

    expect(nodes).toHaveLength(4);
    // 边应该过滤掉指向不存在节点的 edge-invalid
    expect(edges).toHaveLength(2);

    const chapNode = nodes.find((n) => n.id === "node-chap-1");
    expect(chapNode).toBeDefined();
    expect(chapNode?.data.lane).toBe("main");
    expect(chapNode?.data.chapterNumber).toBe(1);

    const arcNode = nodes.find((n) => n.id === "node-arc-1");
    expect(arcNode?.data.lane).toBe("character_arc");

    const conflictNode = nodes.find((n) => n.id === "node-conflict-1");
    expect(conflictNode?.data.lane).toBe("conflict");

    const foreshadowNode = nodes.find((n) => n.id === "node-foreshadow-1");
    expect(foreshadowNode?.data.lane).toBe("foreshadow");
  });

  it("空快照返回空数组", () => {
    expect(snapshotToFlowElements(null)).toEqual({ nodes: [], edges: [] });
    expect(snapshotToFlowElements({ bookId: "b", nodes: [], edges: [], warnings: [] })).toEqual({ nodes: [], edges: [] });
  });
});

describe("StoryMapCanvas 画布渲染与交互", () => {
  it("使用 runtimeFetch 成功加载快照并渲染节点、触发跳转与提拔回调", async () => {
    const runtimeFetch = vi.fn(async () => ({ snapshot: mockSnapshot }));
    const onOpenChapter = vi.fn();
    const onPromote = vi.fn();

    render(
      <StoryMapCanvas
        bookId="book-1"
        runtimeFetch={runtimeFetch}
        onOpenChapter={onOpenChapter}
        onPromote={onPromote}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("react-flow-mock")).toBeTruthy();
    });

    expect(runtimeFetch).toHaveBeenCalledWith("/api/books/book-1/narrative-line");
    expect(screen.getByTestId("rf-nodes-count").textContent).toBe("4");
    expect(screen.getByTestId("rf-edges-count").textContent).toBe("2");

    // 章节节点触发跳转
    const jumpBtn = screen.getByTestId("jump-btn-node-chap-1");
    fireEvent.click(jumpBtn);
    expect(onOpenChapter).toHaveBeenCalledWith(1);

    // 非章节节点触发提拔
    const promoteBtn = screen.getByTestId("promote-btn-node-arc-1");
    fireEvent.click(promoteBtn);
    expect(onPromote).toHaveBeenCalledWith(expect.objectContaining({ id: "node-arc-1", title: "沈舟：心境觉醒" }));
  });

  it("空数据时显示空状态提示", async () => {
    const runtimeFetch = vi.fn(async () => ({ snapshot: { bookId: "book-1", nodes: [], edges: [], warnings: [] } }));

    render(<StoryMapCanvas bookId="book-1" runtimeFetch={runtimeFetch} />);

    await waitFor(() => {
      expect(screen.getByTestId("story-map-empty")).toBeTruthy();
    });
    expect(screen.getByText("暂无故事主支线数据")).toBeTruthy();
  });

  it("加载失败时显示错误态和重试按钮", async () => {
    const runtimeFetch = vi.fn(async () => {
      throw new Error("网络超时");
    });

    render(<StoryMapCanvas bookId="book-1" runtimeFetch={runtimeFetch} />);

    await waitFor(() => {
      expect(screen.getByTestId("story-map-error")).toBeTruthy();
    });
    expect(screen.getByText("网络超时")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
  });
});
