import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RuntimeNarratorSummary } from "./product-contract";

const mocks = vi.hoisted(() => ({
  mountProps: [] as Array<{ bookId: string; narrator: RuntimeNarratorSummary; compact?: boolean }>,
  workbenchProps: [] as Array<{
    bookId?: string;
    nodes: unknown[];
    chatSlot?: ReactNode;
    bookSessions?: readonly { id: string; title: string; updatedAt?: string }[];
    activeSessionId?: string | null;
    onCreateSession?: () => void;
  }>,
}));

vi.mock("./RuntimeNarratorPanelMount", () => ({
  RuntimeNarratorPanelMount: (props: { bookId: string; narrator: RuntimeNarratorSummary; compact?: boolean }) => {
    mocks.mountProps.push(props);
    return <div data-testid="runtime-narrator-panel-mount-mock" />;
  },
}));

vi.mock("@vivy1024/novelfork-novel-plugin/pages/writing-workbench/ide", () => ({
  IdeWorkbench: (props: (typeof mocks.workbenchProps)[number]) => {
    mocks.workbenchProps.push(props);
    return (
      <div data-testid="ide-workbench-mock">
        <button type="button" aria-label="创建书籍会话" onClick={() => props.onCreateSession?.()} />
        {props.chatSlot}
      </div>
    );
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

const historyNarrator: RuntimeNarratorSummary = {
  ...narrator,
  id: "narrator-history",
  title: "历史会话",
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
        path: "chapters/0001_first.md",
        capabilities: { read: true, update: true },
      },
      {
        id: "book.json",
        kind: "book-config",
        title: "book.json",
        content: "{}",
        path: "book.json",
        capabilities: { read: true, update: false },
      },
    ]);

    const chapters = nodes.find((node) => node.metadata?.filePath === "chapters");
    const bookConfig = nodes.find((node) => node.id === "book.json");
    expect(chapters).toMatchObject({ kind: "group", children: [{ id: "chapter:1", kind: "chapter" }] });
    expect(chapters?.children?.[0]?.capabilities).toMatchObject({ open: true, edit: true, readonly: false, delete: false });
    expect(bookConfig).toMatchObject({ id: "book.json", kind: "story" });
    expect(bookConfig?.capabilities).toMatchObject({ open: true, edit: false, readonly: true, unsupported: false, delete: false });
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

  it("已有书籍会话历史时仍显示全部会话并通过书籍作用域创建新会话", async () => {
    const createdNarrator: RuntimeNarratorSummary = {
      ...narrator,
      id: "narrator-new",
      title: "新建对话",
    };
    const onChanged = vi.fn(async () => undefined);
    const client = {
      getWorkspace: vi.fn(async () => ({
        book: { id: "book-1", title: "测试作品", capabilities: { read: true } },
        resources: [],
        capabilities: { read: true, create: true, update: true },
      })),
      listNarrators: vi.fn(async () => [narrator, historyNarrator]),
      createNarrator: vi.fn(async () => createdNarrator),
    };

    render(
      <RuntimeWritingWorkbenchRoute
        bookId="book-1"
        onCanvasContextChange={vi.fn()}
        onNavigateToConversation={vi.fn()}
        onChanged={onChanged}
        client={client as never}
      />,
    );

    await screen.findByTestId("runtime-narrator-panel-mount-mock");
    expect(mocks.workbenchProps.at(-1)?.bookSessions).toEqual([
      expect.objectContaining({ id: narrator.id, title: narrator.title }),
      expect.objectContaining({ id: historyNarrator.id, title: historyNarrator.title }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "创建书籍会话" }));
    await waitFor(() => expect(client.createNarrator).toHaveBeenCalledWith("book-1", { title: "新建对话" }));
    await waitFor(() => expect(mocks.mountProps.at(-1)?.narrator).toEqual(createdNarrator));
    expect(mocks.workbenchProps.at(-1)?.activeSessionId).toBe(createdNarrator.id);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});
