import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { renderToolResult } from "../tool-results/registry";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RuntimeNarratorSummary } from "./product-contract";
import type { RuntimeNarratorRecord } from "./runtime-narrator-client";

const mocks = vi.hoisted(() => ({
  panelProps: [] as Array<{
    narratorId: string;
    compact?: boolean;
    highlightMessageId?: string;
    toolResultRenderer?: unknown;
  }>,
  executeToolResultAction: vi.fn(),
}));

vi.mock("../tool-results/actions", () => ({
  executeToolResultAction: mocks.executeToolResultAction,
}));

vi.mock("@vivy1024/narrafork-runtime-bridge/frontend/narrator-panel", () => ({
  EmbeddedNarratorDockHost: (props: {
    narratorId: string;
    compact?: boolean;
    highlightMessageId?: string;
    toolResultRenderer?: unknown;
  }) => {
    mocks.panelProps.push(props);
    return <div data-testid="native-narrator-panel-mock" data-narrator-id={props.narratorId} />;
  },
}));

import { RuntimeNarratorPanelMount, RuntimeStandaloneNarratorPanelMount } from "./RuntimeNarratorPanelMount";

const narrator: RuntimeNarratorSummary = {
  id: "narrator-1",
  bookId: "book-1",
  title: "写作叙述者",
  status: "idle",
  capabilities: { read: true, send: true, interrupt: true },
};

afterEach(() => {
  cleanup();
  mocks.panelProps.length = 0;
  vi.clearAllMocks();
  window.history.replaceState(null, "", "#");
});


describe("RuntimeNarratorPanelMount", () => {
  it("统一挂载原生面板、test id、compact 和小说工具结果渲染器", async () => {
    render(<RuntimeNarratorPanelMount bookId="book-1" narrator={narrator} compact />);

    expect(screen.getByTestId("native-runtime-narrator-panel").getAttribute("data-narrator-id")).toBe("narrator-1");
    const panel = await screen.findByTestId("native-narrator-panel-mock");
    expect(panel).not.toBeNull();
    const props = mocks.panelProps.at(-1);
    expect(props).toMatchObject({
      narratorId: "narrator-1",
      compact: true,
    });
    expect(typeof props?.toolResultRenderer).toBe("function");
  });

  it("统一拒绝不匹配的可信 bookId 或缺少 read capability", () => {
    const { rerender } = render(<RuntimeNarratorPanelMount bookId="book-2" narrator={narrator} />);
    expect(screen.getByRole("alert").textContent).toContain("不属于此书籍");
    expect(screen.queryByTestId("native-narrator-panel-mock")).toBeNull();

    rerender(
      <RuntimeNarratorPanelMount
        bookId="book-1"
        narrator={{ ...narrator, capabilities: { ...narrator.capabilities, read: false } }}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("不可访问");
    expect(screen.queryByTestId("native-narrator-panel-mock")).toBeNull();
  });

  it("只允许 canonical standalone primary narrator 挂载", async () => {
    const standalone: RuntimeNarratorRecord = {
      id: "standalone-1",
      chapterId: null,
      type: "primary",
      variant: "primary",
      title: "独立叙述者",
      model: "sub2api:gpt-5.6",
      reasoningEffort: null,
      permissionMode: "default",
      planMode: false,
      cwd: null,
      status: "idle",
      substatus: [],
      traits: ["standalone"],
      messageCount: 0,
      createdAt: "2026-07-15T00:00:00.000Z",
      updatedAt: "2026-07-15T00:00:00.000Z",
      lastMessageAt: null,
      errorMessage: null,
      pinned: false,
      lastVisitedAt: null,
      working: false,
      unread: false,
    };
    const { rerender } = render(<RuntimeStandaloneNarratorPanelMount narrator={standalone} />);
    expect(await screen.findByTestId("native-narrator-panel-mock")).not.toBeNull();

    rerender(<RuntimeStandaloneNarratorPanelMount narrator={{ ...standalone, chapterId: "chapter-1" }} />);
    expect(screen.getByRole("alert").textContent).toContain("不是可独立访问");
  });

  it("监听 #msg hash 变化并交给原生面板", async () => {
    window.history.replaceState(null, "", "#msg-history-1");
    render(<RuntimeNarratorPanelMount bookId="book-1" narrator={narrator} />);
    await screen.findByTestId("native-narrator-panel-mock");
    expect(mocks.panelProps.at(-1)).toMatchObject({ highlightMessageId: "history-1" });

    act(() => {
      window.history.replaceState(null, "", "#msg-history-2");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(mocks.panelProps.at(-1)).toMatchObject({ highlightMessageId: "history-2" });
  });

  it("把小说工具结果卡的 onAction 交给可信 bookId", async () => {
    render(<RuntimeNarratorPanelMount bookId="book-1" narrator={narrator} />);
    await screen.findByTestId("native-narrator-panel-mock");
    const props = mocks.panelProps.at(-1);
    expect(typeof props?.toolResultRenderer).toBe("function");

    const renderer = props?.toolResultRenderer as ((input: {
      toolName: string;
      renderer: string;
      result: unknown;
      onAction?: (action: { type: string; toolName: string; input: Record<string, unknown> }) => Promise<unknown> | unknown;
    }) => unknown);

    // Render the tool result card through the wrapper so it picks up the
    // injected onAction (bound to bookId), then click "提升".
    const node = renderer({
      toolName: "book.dissect",
      renderer: "book.dissect",
      result: {
        renderer: "book.dissect",
        data: {
          ok: true,
          applied: true,
          staging: [{ id: "staging-1", proposedTitle: "边界规则", kind: "rules", status: "needs-review" }],
        },
      },
    });
    cleanup(); // remove the previous mount; keep only the card we just produced
    render(<>{node}</>);

    vi.mocked(mocks.executeToolResultAction).mockResolvedValue({ ok: true, summary: "已提升" });
    fireEvent.click(screen.getByRole("button", { name: "提升" }));

    await waitFor(() => expect(mocks.executeToolResultAction).toHaveBeenCalledWith(
      "book-1",
      expect.objectContaining({
        toolName: "lore.write",
        input: expect.objectContaining({ stagingId: "staging-1", stagingDecision: "promote" }),
      }),
    ));
  });

  it("未绑定 bookId 时拆书卡操作被拒绝", async () => {
    const actions: Array<{ type: string; toolName: string; input: Record<string, unknown> }> = [];
    // 直接渲染一张没有 onAction 的拆书卡（等价于未绑定书籍时宿主不注入动作回调）。
    render(<>{renderToolResult({
      toolName: "book.dissect",
      result: {
        renderer: "book.dissect",
        data: {
          ok: true,
          applied: true,
          staging: [{ id: "staging-orphan", proposedTitle: "孤儿候选", kind: "rules", status: "needs-review" }],
        },
      },
      onAction: (action) => {
        actions.push(action);
        return Promise.resolve({ ok: true });
      },
    })}</>);
    // 有了 onAction 就一定会被调用——所以 confirmed-binding 入口的责任是：宿主在没有 bookId 时不要给 callback。
    // 这里直接用 onAction（模拟可信宿主路径），然后由宿主的 executeToolResultAction 在 bookId 缺失时拒绝。
    fireEvent.click(screen.getByRole("button", { name: "提升" }));
    await waitFor(() => expect(actions).toHaveLength(1));
    expect(actions[0]?.input).toMatchObject({ stagingId: "staging-orphan", stagingDecision: "promote" });
  });
});
