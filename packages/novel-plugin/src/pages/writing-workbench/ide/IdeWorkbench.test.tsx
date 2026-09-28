import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("allotment", async () => {
  const React = await import("react");
  const Pane = ({ children, visible = true }: { children?: unknown; visible?: boolean }) => (
    React.createElement("div", { "data-pane-visible": String(visible) }, visible === false ? null : children)
  );
  const Allotment = Object.assign(
    ({ children }: { children?: unknown }) => React.createElement("div", { "data-testid": "mock-allotment" }, children),
    { Pane },
  );
  return { Allotment };
});

vi.mock("./use-panel-manager", async () => {
  const React = await import("react");
  return {
    usePanelManager: (initial = "explorer") => {
      const [activeView, setActiveView] = React.useState(initial);
      const hostRef = React.useRef<HTMLDivElement>(null);
      return {
        activeView,
        showPanel: setActiveView,
        hostRef,
        getContainer: () => null,
        ready: false,
      };
    },
  };
});

vi.mock("./use-ide-tabs", async () => {
  const React = await import("react");
  return {
    useIdeTabs: () => {
      const [tabs, setTabs] = React.useState<never[]>([]);
      return {
        tabs,
        activeTabId: null,
        openTab: vi.fn(),
        activateTab: vi.fn(),
        closeTab: (id: string) => setTabs((current) => current.filter(() => id !== id)),
        closeOthers: vi.fn(),
        closeAll: () => setTabs([]),
        closeSaved: vi.fn(),
        closeRight: vi.fn(),
        togglePin: vi.fn(),
        reorderTabs: vi.fn(),
      };
    },
  };
});

vi.mock("./use-book-file-tree", () => ({
  useBookFileTree: () => ({ nodes: [], loading: false, error: null, reload: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("./use-ide-keybindings", () => ({ useIdeKeybindings: vi.fn() }));
vi.mock("./use-ide-commands", () => ({ useIdeCommands: () => [] }));
vi.mock("./command-palette", () => ({ CommandPalette: () => null }));
vi.mock("./EditorTabs", () => ({ EditorTabs: () => null }));
vi.mock("../WorkbenchCanvas", () => ({ WorkbenchCanvas: () => null }));
vi.mock("../WorkbenchResourceTree", () => ({ WorkbenchResourceTree: () => null }));
vi.mock("../panels/BookSettingsPanel", () => ({ BookSettingsPanel: () => null }));
vi.mock("../NarrativeMemoryPanel", () => ({ NarrativeMemoryPanel: () => null }));
vi.mock("./SkillsAndStyleSidebarPanel", () => ({ SkillsAndStyleSidebarPanel: () => null }));
vi.mock("./CharactersAndLoreSidebarPanel", () => ({ CharactersAndLoreSidebarPanel: () => null }));
vi.mock("./StorylineAndPlanningSidebarPanel", () => ({ StorylineAndPlanningSidebarPanel: () => null }));
vi.mock("../EntityDetailDrawer", () => ({ EntityDetailDrawer: () => null }));
vi.mock("../jingwei/JingweiSidebarToolbar", () => ({ JingweiSidebarToolbar: () => null }));
vi.mock("../WriteViewPanel", () => ({ WriteViewPanel: () => null, WRITING_PROGRESS_EVENT: "ide:test-progress" }));
vi.mock("./use-workbench-dialogs", () => ({
  useWorkbenchDialogs: () => ({
    confirm: vi.fn().mockResolvedValue(true),
    prompt: vi.fn().mockResolvedValue(null),
    alert: vi.fn().mockResolvedValue(undefined),
    element: null,
  }),
}));
vi.mock("../useWorkbenchResources", () => ({
  createToolSectionNodes: () => ({ children: [] }),
  createMemoryCenterNode: () => null,
  createStoryProgressionNode: () => null,
}));
vi.mock("../lore-workspace-split", () => ({
  groupEntriesByCategory: () => [],
  memoryFactLabel: (value: string) => value,
}));
vi.mock("../../../engine/jingwei/unified-categories", () => ({ CATEGORY_META: [], normalizeCategory: (value: string) => value }));
vi.mock("@/components/ui/toast", () => ({ toast: vi.fn() }));

import { IdeWorkbench, loadedFileKey } from "./IdeWorkbench";

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

describe("IdeWorkbench 文件缓存", () => {
  it("使用 bookId 隔离相同资源 ID，避免跨书复用正文", () => {
    expect(loadedFileKey("book-1", "chapter:1")).not.toBe(loadedFileKey("book-2", "chapter:1"));
    expect(loadedFileKey("book-1", "chapter:1")).toBe("book-1:chapter:1");
  });
});

function stubHostWidth(width: number) {
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      width,
      height: 720,
      top: 0,
      left: 0,
      right: width,
      bottom: 720,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });
}

function renderWorkbench() {
  const runtimeFetch = vi.fn(async (input: string) => (
    input.includes("narrative-memory/facts") ? jsonResponse({ facts: [] }).json() : { entries: [] }
  ));
  return render(
    <IdeWorkbench
      bookId="book-1"
      nodes={[]}
      selectedNode={null}
      onOpen={vi.fn()}
      onSave={vi.fn()}
      runtimeFetch={runtimeFetch}
      chatSlot={<div data-testid="chat-slot">对话内容</div>}
      bookSessions={[{ id: "session-1", title: "测试对话" }]}
      activeSessionId="session-1"
    />,
  );
}

describe("IdeWorkbench 窄屏覆盖层", () => {
  const originalRect = HTMLElement.prototype.getBoundingClientRect;

  afterEach(() => {
    cleanup();
    Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", { configurable: true, value: originalRect });
    vi.restoreAllMocks();
  });

  it("窄屏默认只保留编辑区，打开侧栏和对话时互斥覆盖且可由遮罩关闭", async () => {
    stubHostWidth(390);
    renderWorkbench();

    const workbench = await screen.findByTestId("ide-workbench");
    await waitFor(() => expect(workbench.getAttribute("data-layout-mode")).toBe("narrow"));
    expect(workbench.getAttribute("data-pane-overlay")).toBe("true");
    expect(workbench.getAttribute("data-sidebar-visible")).toBe("false");
    expect(workbench.getAttribute("data-chat-visible")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "AI 对话" }));
    expect(workbench.getAttribute("data-sidebar-visible")).toBe("false");
    expect(workbench.getAttribute("data-chat-visible")).toBe("true");
    expect(screen.getByTestId("ide-chat-overlay")).not.toBeNull();
    expect(screen.getByTestId("chat-slot")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "资源管理器" }));
    expect(workbench.getAttribute("data-sidebar-visible")).toBe("true");
    expect(workbench.getAttribute("data-chat-visible")).toBe("false");
    expect(screen.queryByTestId("ide-chat-overlay")).toBeNull();
    expect(screen.getByTestId("ide-sidebar-overlay").getAttribute("aria-hidden")).toBe("false");

    fireEvent.click(screen.getByTestId("ide-overlay-backdrop"));
    expect(workbench.getAttribute("data-sidebar-visible")).toBe("false");
    expect(workbench.getAttribute("data-chat-visible")).toBe("false");
  });

  it("紧凑屏保留侧栏、默认收起对话，且不启用覆盖层", async () => {
    stubHostWidth(900);
    renderWorkbench();

    const workbench = await screen.findByTestId("ide-workbench");
    await waitFor(() => expect(workbench.getAttribute("data-layout-mode")).toBe("compact"));
    expect(workbench.getAttribute("data-pane-overlay")).toBe("false");
    expect(workbench.getAttribute("data-sidebar-visible")).toBe("true");
    expect(workbench.getAttribute("data-chat-visible")).toBe("false");
    expect(screen.queryByTestId("ide-overlay-backdrop")).toBeNull();
    expect(screen.queryByTestId("ide-sidebar-overlay")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "AI 对话" }));
    expect(workbench.getAttribute("data-sidebar-visible")).toBe("true");
    expect(workbench.getAttribute("data-chat-visible")).toBe("true");
    expect(screen.queryByTestId("ide-chat-overlay")).toBeNull();
    expect(screen.getByTestId("chat-slot")).not.toBeNull();
  });
});

describe("IdeWorkbench 宿主打开请求", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("每个 openRequest.seq 只打开一次，别的书的请求忽略", () => {
    const onOpen = vi.fn();
    const chapter = { id: "chapter:7", kind: "chapter", title: "第7章 夜雪", capabilities: { open: true, edit: true } } as const;
    const props = { bookId: "book-1", nodes: [], selectedNode: null, onOpen, onSave: vi.fn() };
    const { rerender } = render(<IdeWorkbench {...props} openRequest={{ bookId: "book-1", node: chapter, seq: 1 }} />);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenLastCalledWith(chapter);

    // 后台刷新让宿主换了新的节点对象，但不是新请求：不重开（否则会把侧栏拽回章节视图）。
    rerender(<IdeWorkbench {...props} selectedNode={{ ...chapter }} openRequest={{ bookId: "book-1", node: { ...chapter }, seq: 1 }} />);
    expect(onOpen).toHaveBeenCalledTimes(1);

    rerender(<IdeWorkbench {...props} openRequest={{ bookId: "book-1", node: chapter, seq: 2 }} />);
    expect(onOpen).toHaveBeenCalledTimes(2);

    rerender(<IdeWorkbench {...props} openRequest={{ bookId: "book-2", node: chapter, seq: 3 }} />);
    expect(onOpen).toHaveBeenCalledTimes(2);
  });
});
