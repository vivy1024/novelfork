import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RuntimeNarratorSummary } from "./product-contract";

const mocks = vi.hoisted(() => ({
  mountProps: [] as Array<{ bookId: string; narrator: RuntimeNarratorSummary; compact?: boolean; onOpenArtifact?: (artifact: { kind: string; id: string; [key: string]: unknown }) => void }>,
  workbenchProps: [] as Array<{
    bookId?: string;
    nodes: unknown[];
    selectedNode?: { id: string } | null;
    openRequest?: { bookId: string; node: { id: string }; seq: number } | null;
    chatSlot?: ReactNode;
    bookSessions?: readonly { id: string; title: string; updatedAt?: string }[];
    activeSessionId?: string | null;
    onCreateSession?: () => void;
    onSendToNarrator?: (message: string) => Promise<void> | void;
    runtimeFetch?: (input: string, init?: RequestInit) => Promise<unknown>;
  }>,
}));

vi.mock("./RuntimeNarratorPanelMount", () => ({
  RuntimeNarratorPanelMount: (props: (typeof mocks.mountProps)[number]) => {
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
        <button type="button" aria-label="发送给叙述者" onClick={() => void props.onSendToNarrator?.("梳理主线")} />
        {props.chatSlot}
      </div>
    );
  },
}));

import { artifactResourceId, mapRuntimeWorkspaceToWorkbenchNodes, RuntimeWritingWorkbenchRoute } from "./RuntimeWritingWorkbenchRoute";

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
        path: "chapters/卷01/0001_first.md",
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
    const volume = chapters?.children?.find((node) => node.metadata?.filePath === "chapters/卷01");
    const bookConfig = nodes.find((node) => node.id === "book.json");
    expect(chapters).toMatchObject({ kind: "group" });
    expect(volume).toMatchObject({ kind: "group", children: [{ id: "chapter:1", kind: "chapter" }] });
    expect(volume?.children?.[0]?.capabilities).toMatchObject({ open: true, edit: true, readonly: false, delete: false });
    expect(bookConfig).toMatchObject({ id: "book.json", kind: "story" });
    expect(bookConfig?.capabilities).toMatchObject({ open: true, edit: false, readonly: true, unsupported: false, delete: false });
  });

  it("把服务端书籍平台、目标字数与语言透传到工作台根节点", () => {
    const nodes = mapRuntimeWorkspaceToWorkbenchNodes("book-1", [], {
      id: "book-1",
      title: "英文测试作品",
      platform: "tomato",
      chapterWordCount: 2400,
      language: "en",
      capabilities: { read: true },
    });

    expect(nodes[0]?.metadata?.book).toEqual({
      id: "book-1",
      title: "英文测试作品",
      platform: "tomato",
      chapterWordCount: 2400,
      language: "en",
    });
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
      onOpenArtifact: expect.any(Function),
      // 叙述者面板里点开的章节交给写作台打开。
      onOpenChapter: expect.any(Function),
    });
    expect(mocks.workbenchProps.at(-1)?.bookId).toBe("book-1");
    expect(mocks.workbenchProps.at(-1)?.nodes).toEqual([
      expect.objectContaining({ id: "book:book-1", title: "测试作品" }),
    ]);
  });

  it("父组件重渲染时保持 runtimeFetch 引用稳定，避免工作台加载 effect 循环请求", async () => {
    const client = {
      getWorkspace: vi.fn(async () => ({
        book: { id: "book-1", title: "测试作品", capabilities: { read: true } },
        resources: [],
        capabilities: { read: true, create: true, update: true },
      })),
      listNarrators: vi.fn(async () => [narrator]),
    };
    const firstCanvasHandler = vi.fn();
    const { rerender } = render(
      <RuntimeWritingWorkbenchRoute
        bookId="book-1"
        onCanvasContextChange={firstCanvasHandler}
        onNavigateToConversation={vi.fn()}
        client={client as never}
      />,
    );

    await screen.findByTestId("ide-workbench-mock");
    const firstRuntimeFetch = mocks.workbenchProps.at(-1)?.runtimeFetch;
    expect(firstRuntimeFetch).toBeTypeOf("function");

    rerender(
      <RuntimeWritingWorkbenchRoute
        bookId="book-1"
        onCanvasContextChange={vi.fn()}
        onNavigateToConversation={vi.fn()}
        client={client as never}
      />,
    );

    await waitFor(() => expect(mocks.workbenchProps.at(-1)?.runtimeFetch).toBe(firstRuntimeFetch));
  });

  it("切书时中止旧请求，旧书响应不能覆盖新书", async () => {
    const deferred = <T,>() => {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
      });
      return { promise, resolve };
    };
    const oldWorkspace = deferred({
      book: { id: "book-1", title: "旧书", capabilities: { read: true } },
      resources: [],
      capabilities: { read: true, create: true, update: true },
    });
    const newWorkspace = deferred({
      book: { id: "book-2", title: "新书", capabilities: { read: true } },
      resources: [],
      capabilities: { read: true, create: true, update: true },
    });
    const oldNarrators = deferred([narrator]);
    const newNarrator: RuntimeNarratorSummary = {
      ...narrator,
      id: "narrator-2",
      bookId: "book-2",
      title: "新书叙述者",
    };
    const newNarrators = deferred([newNarrator]);
    const client = {
      getWorkspace: vi.fn((id: string) => id === "book-1" ? oldWorkspace.promise : newWorkspace.promise),
      listNarrators: vi.fn((id: string) => id === "book-1" ? oldNarrators.promise : newNarrators.promise),
    };
    const { rerender } = render(
      <RuntimeWritingWorkbenchRoute
        bookId="book-1"
        onCanvasContextChange={vi.fn()}
        onNavigateToConversation={vi.fn()}
        client={client as never}
      />,
    );

    await waitFor(() => {
      expect(client.getWorkspace).toHaveBeenCalledWith(
        "book-1",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
    rerender(
      <RuntimeWritingWorkbenchRoute
        bookId="book-2"
        onCanvasContextChange={vi.fn()}
        onNavigateToConversation={vi.fn()}
        client={client as never}
      />,
    );
    await waitFor(() => {
      expect(client.getWorkspace).toHaveBeenCalledWith(
        "book-2",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    const oldWorkspaceSignal = (client.getWorkspace.mock.calls[0]?.[1] as { signal: AbortSignal }).signal;
    const newWorkspaceSignal = (client.getWorkspace.mock.calls[1]?.[1] as { signal: AbortSignal }).signal;
    expect(oldWorkspaceSignal.aborted).toBe(true);
    expect(newWorkspaceSignal.aborted).toBe(false);

    oldWorkspace.resolve({
      book: { id: "book-1", title: "旧书响应", capabilities: { read: true } },
      resources: [],
      capabilities: { read: true, create: true, update: true },
    });
    oldNarrators.resolve([narrator]);
    newWorkspace.resolve({
      book: { id: "book-2", title: "新书响应", capabilities: { read: true } },
      resources: [],
      capabilities: { read: true, create: true, update: true },
    });
    newNarrators.resolve([newNarrator]);

    await waitFor(() => {
      expect(mocks.workbenchProps.at(-1)?.bookId).toBe("book-2");
      expect(mocks.workbenchProps.at(-1)?.nodes).toEqual([
        expect.objectContaining({ id: "book:book-2", title: "新书响应" }),
      ]);
    });
    expect(mocks.workbenchProps.at(-1)?.nodes).not.toEqual([
      expect.objectContaining({ id: "book:book-1" }),
    ]);
  });

  it("切书时旧建会话响应不能写入新书状态", async () => {
    let resolveCreated!: (value: RuntimeNarratorSummary) => void;
    const createdPromise = new Promise<RuntimeNarratorSummary>((resolve) => {
      resolveCreated = resolve;
    });
    const client = {
      getWorkspace: vi.fn(async (id: string) => ({
        book: { id, title: id === "book-1" ? "旧书" : "新书", capabilities: { read: true } },
        resources: [],
        capabilities: { read: true, create: true, update: true },
      })),
      listNarrators: vi.fn(async (id: string) => id === "book-1" ? [narrator] : []),
      createNarrator: vi.fn(() => createdPromise),
    };
    const { rerender } = render(
      <RuntimeWritingWorkbenchRoute
        bookId="book-1"
        onCanvasContextChange={vi.fn()}
        onNavigateToConversation={vi.fn()}
        client={client as never}
      />,
    );
    await screen.findByTestId("runtime-narrator-panel-mount-mock");
    fireEvent.click(screen.getByRole("button", { name: "创建书籍会话" }));
    await waitFor(() => expect(client.createNarrator).toHaveBeenCalledWith(
      "book-1",
      { title: "新建对话" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));

    rerender(
      <RuntimeWritingWorkbenchRoute
        bookId="book-2"
        onCanvasContextChange={vi.fn()}
        onNavigateToConversation={vi.fn()}
        client={client as never}
      />,
    );
    await waitFor(() => expect(mocks.workbenchProps.at(-1)?.bookId).toBe("book-2"));
    resolveCreated({ ...narrator, id: "old-book-session", title: "旧书会话" });
    await Promise.resolve();
    expect(mocks.workbenchProps.at(-1)?.bookSessions ?? []).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "old-book-session" })]),
    );
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
    await waitFor(() => expect(client.createNarrator).toHaveBeenCalledWith(
      "book-1",
      { title: "新建对话" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));
    await waitFor(() => expect(mocks.mountProps.at(-1)?.narrator).toEqual(createdNarrator));
    expect(mocks.workbenchProps.at(-1)?.activeSessionId).toBe(createdNarrator.id);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("写章进度事件只静默刷新，不把工作台卸成加载态", async () => {
    const client = {
      getWorkspace: vi.fn(async () => ({
        book: { id: "book-1", title: "测试作品", capabilities: { read: true } },
        resources: [{
          id: "chapter:1",
          kind: "chapter",
          title: "第一章",
          path: "chapters/0001_first.md",
          capabilities: { read: true, update: true },
          metadata: { updatedAt: "t1" },
        }],
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

    await screen.findByTestId("ide-workbench-mock");
    expect(client.getWorkspace).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new CustomEvent("novelfork:writing-progress", { detail: { reason: "pipeline.write", bookId: "book-1" } }));
    await waitFor(() => expect(client.getWorkspace).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("ide-workbench-mock")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  describe("叙述者结果卡「在画布打开」", () => {
    function chapterResource(number: number) {
      return {
        id: `chapter:${number}`,
        kind: "chapter",
        title: `第${number}章`,
        path: `chapters/000${number}_c.md`,
        capabilities: { read: true, update: true },
        metadata: { updatedAt: "t1" },
      };
    }

    function workspaceWith(chapters: number[]) {
      return {
        book: { id: "book-1", title: "测试作品", capabilities: { read: true } },
        resources: chapters.map(chapterResource),
        capabilities: { read: true, create: true, update: true },
      };
    }

    function renderRoute(client: unknown) {
      render(
        <RuntimeWritingWorkbenchRoute
          bookId="book-1"
          onCanvasContextChange={vi.fn()}
          onNavigateToConversation={vi.fn()}
          client={client as never}
        />,
      );
    }

    it("产物按章号解析成工作台资源；别的书、非章节的产物不认", () => {
      expect(artifactResourceId({ kind: "chapter", id: "x", resourceRef: { kind: "chapter", chapterNumber: 3, bookId: "book-1" } }, "book-1")).toBe("chapter:3");
      expect(artifactResourceId({ kind: "chapter", id: "chapter:7" }, "book-1")).toBe("chapter:7");
      expect(artifactResourceId({ kind: "chapter", id: "chapter:3", resourceRef: { kind: "chapter", chapterNumber: 3, bookId: "book-2" } }, "book-1")).toBeNull();
      expect(artifactResourceId({ kind: "chapter", id: "chapter:3", metadata: { bookId: "book-2" } }, "book-1")).toBeNull();
      expect(artifactResourceId({ kind: "report", id: "r-1" }, "book-1")).toBeNull();
    });

    it("点「在画布打开」打开对应章节", async () => {
      const client = { getWorkspace: vi.fn(async () => workspaceWith([1, 2])), listNarrators: vi.fn(async () => [narrator]) };
      renderRoute(client);
      await screen.findByTestId("runtime-narrator-panel-mount-mock");
      await act(async () => mocks.mountProps.at(-1)!.onOpenArtifact!({ kind: "chapter", id: "chapter:2", title: "第二章" }));
      await waitFor(() => expect(mocks.workbenchProps.at(-1)?.selectedNode?.id).toBe("chapter:2"));
      expect(mocks.workbenchProps.at(-1)?.openRequest).toMatchObject({ bookId: "book-1", node: { id: "chapter:2" }, seq: 1 });
      expect(client.getWorkspace).toHaveBeenCalledTimes(1);

      // 同一章再点一次也是新请求：作者可能已关掉那个 tab。
      await act(async () => mocks.mountProps.at(-1)!.onOpenArtifact!({ kind: "chapter", id: "chapter:2", title: "第二章" }));
      await waitFor(() => expect(mocks.workbenchProps.at(-1)?.openRequest?.seq).toBe(2));
    });

    it("刚写完的章还不在资源树里：先静默重载再打开", async () => {
      const client = {
        getWorkspace: vi.fn()
          .mockResolvedValueOnce(workspaceWith([1]))
          .mockResolvedValue(workspaceWith([1, 2])),
        listNarrators: vi.fn(async () => [narrator]),
      };
      renderRoute(client);
      await screen.findByTestId("runtime-narrator-panel-mount-mock");
      await act(async () => mocks.mountProps.at(-1)!.onOpenArtifact!({
        kind: "chapter",
        id: "chapter:2",
        resourceRef: { kind: "chapter", id: "chapter:2", bookId: "book-1", chapterNumber: 2 },
      }));
      await waitFor(() => expect(mocks.workbenchProps.at(-1)?.selectedNode?.id).toBe("chapter:2"));
      expect(client.getWorkspace).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId("ide-workbench-mock")).toBeTruthy();
    });

    it("打不开时给一句说明，不挡住工作台", async () => {
      const client = { getWorkspace: vi.fn(async () => workspaceWith([1])), listNarrators: vi.fn(async () => [narrator]) };
      renderRoute(client);
      await screen.findByTestId("runtime-narrator-panel-mount-mock");
      await act(async () => mocks.mountProps.at(-1)!.onOpenArtifact!({ kind: "report", id: "r-1", title: "体检报告" }));
      expect(screen.getByTestId("workbench-open-notice").textContent).toContain("体检报告");
      await act(async () => mocks.mountProps.at(-1)!.onOpenArtifact!({ kind: "chapter", id: "chapter:9", title: "第九章" }));
      await waitFor(() => expect(screen.getByTestId("workbench-open-notice").textContent).toContain("没在资源树里找到「第九章」"));
      expect(screen.getByTestId("ide-workbench-mock")).toBeTruthy();
      expect(mocks.workbenchProps.at(-1)?.selectedNode ?? null).toBeNull();
      expect(mocks.workbenchProps.at(-1)?.openRequest ?? null).toBeNull();
    });
  });
});
