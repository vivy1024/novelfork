import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderToolResult } from "../tool-results/registry";
import type { RuntimeNarratorSummary } from "./product-contract";
import type { RuntimeNarratorRecord } from "./runtime-narrator-client";

const mocks = vi.hoisted(() => ({
  panelProps: [] as Array<{
    narratorId: string;
    compact?: boolean;
    highlightMessageId?: string;
    toolResultRenderer?: unknown;
  }>,
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
    expect(await screen.findByTestId("native-narrator-panel-mock")).not.toBeNull();
    expect(mocks.panelProps.at(-1)).toMatchObject({
      narratorId: "narrator-1",
      compact: true,
      toolResultRenderer: renderToolResult,
    });
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
});
