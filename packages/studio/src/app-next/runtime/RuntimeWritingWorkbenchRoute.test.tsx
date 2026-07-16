import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RuntimeNarratorSummary } from "./product-contract";

const mocks = vi.hoisted(() => ({
  mountProps: [] as Array<{ bookId: string; narrator: RuntimeNarratorSummary; compact?: boolean }>,
  workbenchProps: [] as Array<{ bookId?: string; nodes: unknown[]; chatSlot?: ReactNode }>,
}));

vi.mock("./RuntimeNarratorPanelMount", () => ({
  RuntimeNarratorPanelMount: (props: { bookId: string; narrator: RuntimeNarratorSummary; compact?: boolean }) => {
    mocks.mountProps.push(props);
    return <div data-testid="runtime-narrator-panel-mount-mock" />;
  },
}));

vi.mock("@vivy1024/novelfork-novel-plugin/pages/writing-workbench/ide", () => ({
  IdeWorkbench: (props: { bookId?: string; nodes: unknown[]; chatSlot?: ReactNode }) => {
    mocks.workbenchProps.push(props);
    return <div data-testid="ide-workbench-mock">{props.chatSlot}</div>;
  },
}));

import { mapRuntimeWorkspaceToWorkbenchNodes, RuntimeWritingWorkbenchRoute } from "./RuntimeWritingWorkbenchRoute";

const narrator: RuntimeNarratorSummary = {
  id: "narrator-1",
  bookId: "book-1",
  title: "写作叙述者",
  status: "idle",
  capabilities: { read: true, send: true, interrupt: true },
};

afterEach(() => {
  cleanup();
  mocks.mountProps.length = 0;
  mocks.workbenchProps.length = 0;
  vi.clearAllMocks();
});

describe("RuntimeWritingWorkbenchRoute", () => {
  it("maps Runtime resources and keeps non-chapter references readable but read-only", () => {
    const nodes = mapRuntimeWorkspaceToWorkbenchNodes("book-1", [
      {
        id: "chapter:1",
        kind: "chapter",
        title: "第一章",
        content: "正文",
        capabilities: { read: true, update: true },
      },
      {
        id: "book.json",
        kind: "book-config",
        title: "book.json",
        content: "{}",
        capabilities: { read: true, update: false },
      },
    ]);

    expect(nodes[0]).toMatchObject({ id: "runtime-group:chapters", children: [{ id: "chapter:1", kind: "chapter" }] });
    expect(nodes[0]?.children?.[0]?.capabilities).toMatchObject({ open: true, edit: true, readonly: false, delete: false });
    expect(nodes[1]).toMatchObject({ id: "runtime-group:reference", children: [{ id: "book.json" }] });
    expect(nodes[1]?.children?.[0]?.capabilities).toMatchObject({ open: true, edit: false, readonly: true, unsupported: false, delete: false });
  });

  it("把工作台聊天槽交给同一 mount，唯一行为差异为 compact", async () => {
    const client = {
      getWorkspace: vi.fn(async () => ({
        book: { id: "book-1", title: "测试作品", capabilities: { read: true } },
        resources: [],
        capabilities: { read: true, create: true, update: true },
      })),
      listNarrators: vi.fn(async () => [narrator]),
    };

    render(
      <RuntimeWritingWorkbenchRoute
        bookId="book-1"
        onCanvasContextChange={vi.fn()}
        onNavigateToConversation={vi.fn()}
        client={client as never}
      />,
    );

    await screen.findByTestId("runtime-narrator-panel-mount-mock");
    expect(mocks.mountProps.at(-1)).toEqual({
      bookId: "book-1",
      narrator,
      compact: true,
    });
    expect(mocks.workbenchProps.at(-1)?.bookId).toBe("book-1");
    expect(mocks.workbenchProps.at(-1)?.nodes).toEqual([
      expect.objectContaining({ id: "book:book-1", title: "测试作品" }),
    ]);
  });
});
