import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkbenchCanvasProps } from "../WorkbenchCanvas";
import type { WorkbenchResourceNode } from "../useWorkbenchResources";
import type { UseIdeTabsReturn } from "./use-ide-tabs";
import type { ComponentProps } from "react";
import type { EditorTabs } from "./EditorTabs";
import type { IdeKeybindingActions } from "./use-ide-keybindings";
import type { WorkbenchDialogs } from "./use-workbench-dialogs";

const saveHarness = vi.hoisted(() => ({
  tabs: null as UseIdeTabsReturn | null,
  canvases: new Map<string, WorkbenchCanvasProps>(),
  reportContext: false,
  editorTabs: null as ComponentProps<typeof EditorTabs> | null,
  keybindings: null as IdeKeybindingActions | null,
  commands: null as Parameters<typeof import("./use-ide-commands").useIdeCommands>[0] | null,
  confirm: vi.fn<WorkbenchDialogs["confirm"]>().mockResolvedValue(true),
  realSaving: false,
}));

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
    usePanelManager: (initial = "resources") => {
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

vi.mock("./use-ide-tabs", async (importOriginal) => {
  const React = await import("react");
  const actual = await importOriginal<typeof import("./use-ide-tabs")>();
  return {
    useIdeTabs: (...args: Parameters<typeof actual.useIdeTabs>) => {
      if (saveHarness.realSaving) return actual.useIdeTabs(...args);
      const [tabs, setTabs] = React.useState<never[]>([]);
      if (saveHarness.tabs) return saveHarness.tabs;
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

vi.mock("./use-ide-keybindings", () => ({ useIdeKeybindings: (actions: IdeKeybindingActions) => { saveHarness.keybindings = actions; } }));
vi.mock("./use-ide-commands", () => ({ useIdeCommands: (options: NonNullable<typeof saveHarness.commands>) => { saveHarness.commands = options; return []; } }));
vi.mock("./command-palette", () => ({ CommandPalette: () => null }));
vi.mock("./EditorTabs", () => ({ EditorTabs: (props: ComponentProps<typeof EditorTabs>) => { saveHarness.editorTabs = props; return null; } }));
vi.mock("../WorkbenchCanvas", async () => {
  const { useEffect } = await import("react");
  const { useResourceAutosave } = await import("../use-resource-autosave");
  function SavingCanvas(props: WorkbenchCanvasProps) {
    const save = useResourceAutosave(props.node, props.bookId, props.onSave);
    useEffect(() => {
      if (props.node) props.onCanvasContextChange?.({
        activeResourceId: props.node.id, activeKind: props.node.kind, activeTabId: props.node.id,
        dirty: save.dirty, contentPreview: save.content,
      });
    }, [props.node, props.onCanvasContextChange, save.dirty, save.content]);
    return props.node ? <>
      <textarea aria-label="测试正文" value={save.content} onChange={event => save.setContent(event.target.value)} />
      <button onClick={() => { void save.save(); }}>测试保存</button>
    </> : null;
  }
  return {
    WorkbenchCanvas: (props: WorkbenchCanvasProps) => {
      if (props.node) saveHarness.canvases.set(props.node.id, props);
      useEffect(() => {
        if (saveHarness.reportContext && props.node) props.onCanvasContextChange?.({
          activeResourceId: props.node.id, activeKind: props.node.kind, activeTabId: props.node.id,
          dirty: false, contentPreview: props.node.content ?? "",
        });
      }, [props.node, props.onCanvasContextChange]);
      return saveHarness.realSaving ? <SavingCanvas {...props} /> : null;
    },
  };
});
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
    confirm: saveHarness.confirm,
    prompt: vi.fn().mockResolvedValue(null),
    alert: vi.fn().mockResolvedValue(undefined),
    element: null,
  }),
}));
vi.mock("../useWorkbenchResources", () => ({
  createToolSectionNodes: () => ({ children: [] }),
  createMemoryCenterNode: () => null,
  createStoryProgressionNode: () => null,
  createLoreTreesNode: () => null,
  createWorkflowNode: () => null,
}));
vi.mock("../lore-workspace-split", () => ({
  groupEntriesByCategory: () => [],
  memoryFactLabel: (value: string) => value,
}));
vi.mock("../../../engine/jingwei/unified-categories", () => ({ CATEGORY_META: [], normalizeCategory: (value: string) => value }));
vi.mock("@/components/ui/toast", () => ({ toast: vi.fn() }));

import { IdeWorkbench, ResourcesSidebarPanel, loadedFileKey, type IdeWorkbenchProps } from "./IdeWorkbench";

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

    fireEvent.click(screen.getByRole("button", { name: "资源" }));
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

  it("活动栏每项都有可见文字；空态说明用途与第一步，侧栏收起时给出展开按钮", async () => {
    stubHostWidth(1440);
    renderWorkbench();

    const workbench = await screen.findByTestId("ide-workbench");
    await waitFor(() => expect(workbench.getAttribute("data-sidebar-visible")).toBe("true"));
    const storyline = screen.getByRole("button", { name: "故事推进" });
    expect(storyline.textContent).toBe("故事推进");

    fireEvent.click(storyline);
    const empty = await screen.findByTestId("view-empty-state");
    expect(empty.textContent).toContain("回答「下一章写什么」");
    expect(empty.textContent).toContain("故事画布");
    expect(screen.queryByRole("button", { name: "展开左侧栏" })).toBeNull();

    fireEvent.click(storyline);
    expect(workbench.getAttribute("data-sidebar-visible")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "展开左侧栏" }));
    expect(workbench.getAttribute("data-sidebar-visible")).toBe("true");
  });

  it("资源管理器与分析工具合并为一个「资源」入口，旧入口不再出现", async () => {
    stubHostWidth(1440);
    renderWorkbench();

    const workbench = await screen.findByTestId("ide-workbench");
    const rail = workbench.querySelector("[data-nf-surface='rail']") as HTMLElement;
    const labels = [...rail.querySelectorAll("button")].map((button) => button.getAttribute("aria-label"));
    expect(labels).toEqual(["写作", "资源", "搜索", "作品基础", "故事推进", "技能文风", "AI 对话", "写作设置"]);
    expect(screen.queryByRole("button", { name: "资源管理器" })).toBeNull();
    expect(screen.queryByRole("button", { name: "分析工具" })).toBeNull();
    // 初始就在「资源」视图
    expect(screen.getByRole("button", { name: "资源" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("接入页头的面板不叠公共标题条；未接入的资源与搜索保留公共标题条", async () => {
    stubHostWidth(1440);
    renderWorkbench();

    // 默认在「资源」视图：公共标题条兜底显示
    await screen.findByTestId("ide-workbench");
    expect(screen.getByTestId("sidebar-view-title").textContent).toContain("文件与分析工具");

    fireEvent.click(screen.getByRole("button", { name: "写作" }));
    expect(screen.queryByTestId("sidebar-view-title")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "作品基础" }));
    expect(screen.queryByTestId("sidebar-view-title")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "故事推进" }));
    expect(screen.queryByTestId("sidebar-view-title")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "技能文风" }));
    expect(screen.queryByTestId("sidebar-view-title")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    expect(screen.getByTestId("sidebar-view-title").textContent).toContain("全局搜索");
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

describe("IdeWorkbench 保存归属与缓存", () => {
  function chapter(id: string): WorkbenchResourceNode {
    return { id, kind: "chapter", title: id, content: "树中旧正文",
      metadata: { isFile: true, filePath: `${id}.md` },
      capabilities: { open: true, readonly: false, unsupported: false, edit: true, delete: false, apply: false } };
  }

  function setupTabs(nodes: WorkbenchResourceNode[], activeTabId: string) {
    const setDirty = vi.fn();
    saveHarness.tabs = {
      tabs: nodes.map((node) => ({ id: node.id, nodeId: node.id, title: node.title, dirty: true, kind: "chapter", view: "resources" })),
      activeTabId, setDirty, openTab: vi.fn(), activateTab: vi.fn(), closeTab: vi.fn(), closeOthers: vi.fn(),
      closeAll: vi.fn(), closeSaved: vi.fn(), closeRight: vi.fn(), togglePin: vi.fn(), reorderTabs: vi.fn(), hasDirtyTabs: () => true,
    };
    return setDirty;
  }

  beforeEach(() => {
    saveHarness.confirm.mockReset().mockResolvedValue(true);
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => jsonResponse({
      content: String(input).includes("book-b") ? "乙书磁盘正文" : "甲书磁盘正文", entries: [], facts: [], changes: [],
    })));
  });

  afterEach(() => {
    cleanup();
    saveHarness.tabs = null;
    saveHarness.canvases.clear();
    saveHarness.reportContext = false;
    saveHarness.editorTabs = null;
    saveHarness.keybindings = null;
    saveHarness.commands = null;
    saveHarness.realSaving = false;
    vi.unstubAllGlobals();
  });

  it("后台章节保存状态只更新自己的标签，不清除当前章节的 dirty 或替换会话上下文", () => {
    const nodes = [chapter("chapter:1"), chapter("chapter:2")];
    const setDirty = setupTabs(nodes, "chapter:2");
    const onCanvasContextChange = vi.fn();
    render(<IdeWorkbench nodes={nodes} selectedNode={null} onOpen={vi.fn()} onSave={vi.fn()} onCanvasContextChange={onCanvasContextChange} />);
    const background = saveHarness.canvases.get("chapter:1")!;
    expect(background.onCanvasContextChange).toBeTypeOf("function");
    act(() => background.onCanvasContextChange!({
      activeResourceId: "chapter:1", activeKind: "chapter", activeTabId: "chapter:1", dirty: false, contentPreview: "后台已保存正文",
    }));
    expect(setDirty).toHaveBeenLastCalledWith("chapter:1", false);
    expect(onCanvasContextChange).not.toHaveBeenCalled();
    act(() => saveHarness.canvases.get("chapter:2")!.onCanvasContextChange!({
      activeResourceId: "chapter:2", activeKind: "chapter", activeTabId: "chapter:2", dirty: true, contentPreview: "前台草稿",
    }));
    expect(setDirty).toHaveBeenLastCalledWith("chapter:2", true);
    expect(onCanvasContextChange).toHaveBeenLastCalledWith(expect.objectContaining({ activeTabId: "chapter:2", dirty: true }));
  });

  it("真实保存完成后更新已加载文件缓存；换书后的旧请求不能写入新书缓存", async () => {
    const nodes = [chapter("chapter:1")];
    setupTabs(nodes, "chapter:1");
    let finish!: () => void;
    const firstRequest = new Promise<void>((resolve) => { finish = resolve; });
    let finishOld!: () => void;
    const oldRequest = new Promise<void>((resolve) => { finishOld = resolve; });
    const onSave = vi.fn().mockReturnValueOnce(firstRequest).mockReturnValueOnce(oldRequest);
    const props = { nodes, selectedNode: null, onOpen: vi.fn(), onSave };
    const { rerender } = render(<IdeWorkbench {...props} bookId="book-a" />);
    await waitFor(() => expect(saveHarness.canvases.get("chapter:1")?.node?.content).toBe("甲书磁盘正文"));
    const first = saveHarness.canvases.get("chapter:1")!;
    const saving = first.onSave(first.node!, "甲书保存快照");
    expect(saveHarness.canvases.get("chapter:1")!.node!.content).toBe("甲书磁盘正文");
    await act(async () => { finish(); await saving; });
    expect(saveHarness.canvases.get("chapter:1")!.node!.content).toBe("甲书保存快照");

    const previous = saveHarness.canvases.get("chapter:1")!;
    const staleSave = previous.onSave(previous.node!, "甲书在途快照");
    rerender(<IdeWorkbench {...props} bookId="book-b" />);
    await waitFor(() => expect(saveHarness.canvases.get("chapter:1")?.node?.content).toBe("乙书磁盘正文"));
    await act(async () => { finishOld(); await staleSave; });
    expect(saveHarness.canvases.get("chapter:1")!.node!.content).toBe("乙书磁盘正文");
  });

  it("切换已挂载的标签会重新发布新前台上下文", () => {
    const nodes = [chapter("chapter:1"), chapter("chapter:2")];
    setupTabs(nodes, "chapter:2");
    saveHarness.reportContext = true;
    const onCanvasContextChange = vi.fn();
    const props = { nodes, selectedNode: null, onOpen: vi.fn(), onSave: vi.fn(), onCanvasContextChange };
    const { rerender } = render(<IdeWorkbench {...props} />);
    expect(onCanvasContextChange).toHaveBeenLastCalledWith(expect.objectContaining({ activeTabId: "chapter:2" }));
    saveHarness.tabs = { ...saveHarness.tabs!, activeTabId: "chapter:1" };
    rerender(<IdeWorkbench {...props} />);
    expect(onCanvasContextChange).toHaveBeenLastCalledWith(expect.objectContaining({ activeTabId: "chapter:1" }));
  });

  it.each(["标签", "快捷键", "命令面板", "全部", "其他", "右侧", "面包屑"])("%s关闭遇到未保存标签须等确认；取消保留正文", async (entry) => {
    const nodes = [chapter("chapter:1"), chapter("chapter:2")];
    setupTabs(nodes, "chapter:2");
    let decide!: (confirmed: boolean) => void;
    saveHarness.confirm.mockReturnValueOnce(new Promise<boolean>(resolve => { decide = resolve; }));
    render(<IdeWorkbench nodes={nodes} selectedNode={null} onOpen={vi.fn()} onSave={vi.fn()} />);
    act(() => {
      if (entry === "标签") saveHarness.editorTabs!.onClose("chapter:2");
      if (entry === "快捷键") saveHarness.keybindings!.closeTab();
      if (entry === "命令面板") saveHarness.commands!.closeAllTabs();
      if (entry === "全部") saveHarness.editorTabs!.onCloseAll!();
      if (entry === "其他") saveHarness.editorTabs!.onCloseOthers!("chapter:1");
      if (entry === "右侧") saveHarness.editorTabs!.onCloseRight!("chapter:1");
      if (entry === "面包屑") fireEvent.click(screen.getByText("NovelFork"));
    });
    expect(saveHarness.confirm).toHaveBeenCalledTimes(1);
    expect(saveHarness.tabs!.closeTab).not.toHaveBeenCalled();
    expect(saveHarness.tabs!.closeAll).not.toHaveBeenCalled();
    expect(saveHarness.tabs!.closeOthers).not.toHaveBeenCalled();
    expect(saveHarness.tabs!.closeRight).not.toHaveBeenCalled();
    await act(async () => { decide(false); });
    expect(saveHarness.tabs!.closeTab).not.toHaveBeenCalled();
  });

  it("确认批量关闭只处理原目标，保留固定标签和弹窗等待期间新开的标签", async () => {
    const nodes = [chapter("chapter:1"), chapter("chapter:2")];
    setupTabs(nodes, "chapter:2");
    saveHarness.tabs!.tabs[0].pinned = true;
    let decide!: (confirmed: boolean) => void;
    saveHarness.confirm.mockReturnValueOnce(new Promise<boolean>(resolve => { decide = resolve; }));
    const props = { nodes, selectedNode: null, onOpen: vi.fn(), onSave: vi.fn() };
    const { rerender } = render(<IdeWorkbench {...props} />);
    act(() => { saveHarness.editorTabs!.onCloseAll!(); });
    saveHarness.tabs!.tabs.push({ ...saveHarness.tabs!.tabs[1], id: "chapter:3" });
    rerender(<IdeWorkbench {...props} />);
    await act(async () => { decide(true); });
    expect(saveHarness.tabs!.closeTab).toHaveBeenCalledExactlyOnceWith("chapter:2");
  });

  it("关闭确认等待期间切书后，旧确认不能关闭新书同编号标签", async () => {
    const nodes = [chapter("chapter:1")];
    setupTabs(nodes, "chapter:1");
    let decide!: (confirmed: boolean) => void;
    saveHarness.confirm.mockReturnValueOnce(new Promise<boolean>(resolve => { decide = resolve; }));
    const props = { nodes, selectedNode: null, onOpen: vi.fn(), onSave: vi.fn() };
    const { rerender } = render(<IdeWorkbench {...props} bookId="book-a" />);
    act(() => { saveHarness.editorTabs!.onClose("chapter:1"); });
    rerender(<IdeWorkbench {...props} bookId="book-b" />);
    await act(async () => { decide(true); });
    expect(saveHarness.tabs!.closeTab).not.toHaveBeenCalled();
  });

  it.each(["工作区", "写作设置"])("打开%s前保护即将卸载的未保存画布", async (entry) => {
    const nodes = [chapter("chapter:1")];
    setupTabs(nodes, "chapter:1");
    let decide!: (confirmed: boolean) => void;
    saveHarness.confirm.mockReturnValueOnce(new Promise<boolean>(resolve => { decide = resolve; }));
    render(<IdeWorkbench bookId="book-a" nodes={nodes} selectedNode={null} onOpen={vi.fn()} onSave={vi.fn()} />);
    act(() => {
      if (entry === "工作区") saveHarness.keybindings!.switchView("characters-lore");
      else saveHarness.commands!.setShowSettings(true);
    });
    expect(saveHarness.confirm).toHaveBeenCalledTimes(1);
    expect(saveHarness.editorTabs!.activeView).toBe("resources");
    await act(async () => { decide(false); });
    expect(saveHarness.editorTabs!.activeView).toBe("resources");
  });

  it.each(["工作区", "写作设置", "快捷键关闭"])("真实标签在保存中收到新输入，取消%s后保留草稿并可重试失败保存", async (entry) => {
    saveHarness.realSaving = true;
    let finish!: () => void;
    const first = new Promise<void>(resolve => { finish = resolve; });
    const onSave = vi.fn().mockReturnValueOnce(first).mockRejectedValueOnce(new Error("临时保存失败")).mockResolvedValue(undefined);
    const node = { ...chapter("chapter:deferred"), metadata: undefined };
    let decide!: (confirmed: boolean) => void;
    saveHarness.confirm.mockReturnValueOnce(new Promise<boolean>(resolve => { decide = resolve; }));
    render(<IdeWorkbench bookId="temporary-guard-book" nodes={[node]} selectedNode={null}
      openRequest={{ bookId: "temporary-guard-book", node, seq: 1 }} onOpen={vi.fn()} onSave={onSave} />);
    await screen.findByLabelText("测试正文");
    fireEvent.change(screen.getByLabelText("测试正文"), { target: { value: "已发出的第一版" } });
    await act(async () => { fireEvent.click(screen.getByText("测试保存")); });
    fireEvent.change(screen.getByLabelText("测试正文"), { target: { value: "在途新输入" } });
    act(() => {
      if (entry === "工作区") saveHarness.keybindings!.switchView("characters-lore");
      else if (entry === "写作设置") saveHarness.commands!.setShowSettings(true);
      else saveHarness.keybindings!.closeTab();
    });
    expect(saveHarness.confirm).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); decide(false); });
    expect(screen.getByLabelText("测试正文")).toHaveProperty("value", "在途新输入");
    expect(saveHarness.editorTabs!.tabs[0].dirty).toBe(true);
    await act(async () => { fireEvent.click(screen.getByText("测试保存")); });
    expect(saveHarness.editorTabs!.tabs[0].dirty).toBe(true);
    expect(screen.getByLabelText("测试正文")).toHaveProperty("value", "在途新输入");
    await act(async () => { fireEvent.click(screen.getByText("测试保存")); });
    expect(onSave).toHaveBeenLastCalledWith(node, "在途新输入");
    expect(saveHarness.editorTabs!.tabs[0].dirty).toBe(false);
    act(() => {
      if (entry === "工作区") saveHarness.keybindings!.switchView("characters-lore");
      else if (entry === "写作设置") saveHarness.commands!.setShowSettings(true);
      else saveHarness.keybindings!.closeTab();
    });
    expect(saveHarness.confirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("测试正文")).toBeNull();
  });

  it("关闭分屏也须确认其独立草稿，取消后仍保留分屏", async () => {
    const nodes = [chapter("chapter:1")];
    setupTabs(nodes, "chapter:1");
    render(<IdeWorkbench nodes={nodes} selectedNode={null} onOpen={vi.fn()} onSave={vi.fn()} />);
    act(() => { saveHarness.editorTabs!.onSplitRight!("chapter:1"); });
    act(() => saveHarness.canvases.get("chapter:1")!.onCanvasContextChange!({
      activeResourceId: "chapter:1", activeKind: "chapter", activeTabId: "chapter:1", dirty: true, contentPreview: "分屏新输入",
    }));
    saveHarness.confirm.mockResolvedValueOnce(false);
    await act(async () => { fireEvent.click(screen.getByTitle("关闭分屏")); });
    expect(saveHarness.confirm).toHaveBeenCalledTimes(1);
    expect(screen.getByTitle("关闭分屏")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByTitle("关闭分屏")); });
    expect(screen.queryByTitle("关闭分屏")).toBeNull();
  });

  it("宿主离开守卫实时读取真实草稿，取消返回 false，明确确认或保存完成返回 true", async () => {
    saveHarness.realSaving = true;
    let finish!: () => void;
    const first = new Promise<void>(resolve => { finish = resolve; });
    const onSave = vi.fn().mockReturnValueOnce(first).mockResolvedValue(undefined);
    const node = { ...chapter("chapter:host-guard"), metadata: undefined };
    const onBeforeLeaveChange = vi.fn<NonNullable<IdeWorkbenchProps["onBeforeLeaveChange"]>>();
    render(<IdeWorkbench bookId="temporary-host-guard" nodes={[node]} selectedNode={null}
      openRequest={{ bookId: "temporary-host-guard", node, seq: 1 }} onOpen={vi.fn()} onSave={onSave}
      onBeforeLeaveChange={onBeforeLeaveChange} />);
    await screen.findByLabelText("测试正文");
    expect(onBeforeLeaveChange).toHaveBeenCalledTimes(1);
    const guard = onBeforeLeaveChange.mock.calls[0][0]!;
    await expect(guard()).resolves.toBe(true);
    expect(saveHarness.confirm).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("测试正文"), { target: { value: "请求中的第一版" } });
    await act(async () => { fireEvent.click(screen.getByText("测试保存")); });
    fireEvent.change(screen.getByLabelText("测试正文"), { target: { value: "离开前的新输入" } });
    let decide!: (confirmed: boolean) => void;
    saveHarness.confirm.mockReturnValueOnce(new Promise<boolean>(resolve => { decide = resolve; }));
    let leaving!: Promise<boolean>;
    act(() => { leaving = guard(); });
    // 重复导航不能叠加确认，也不能绕过正在等待的确认。
    await expect(guard()).resolves.toBe(false);
    expect(saveHarness.confirm).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); decide(false); await expect(leaving).resolves.toBe(false); });
    expect(screen.getByLabelText("测试正文")).toHaveProperty("value", "离开前的新输入");
    expect(saveHarness.editorTabs!.tabs[0].dirty).toBe(true);
    await expect(guard()).resolves.toBe(true);
    expect(saveHarness.confirm).toHaveBeenCalledTimes(2);
    await act(async () => { fireEvent.click(screen.getByText("测试保存")); });
    await expect(guard()).resolves.toBe(true);
    expect(saveHarness.confirm).toHaveBeenCalledTimes(2);
    expect(onBeforeLeaveChange).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("宿主离开确认包含独立分屏草稿及后台标签（后台 dirty=%s）", async (backgroundDirty) => {
    const nodes = [chapter("后台章节"), chapter("前台章节"), chapter("分屏章节")];
    setupTabs(nodes, "前台章节");
    saveHarness.tabs!.tabs.forEach(tab => { tab.dirty = backgroundDirty && tab.id === "后台章节"; });
    const onBeforeLeaveChange = vi.fn<NonNullable<IdeWorkbenchProps["onBeforeLeaveChange"]>>();
    render(<IdeWorkbench nodes={nodes} selectedNode={null} onOpen={vi.fn()} onSave={vi.fn()}
      onBeforeLeaveChange={onBeforeLeaveChange} />);
    const guard = onBeforeLeaveChange.mock.calls[0][0]!;
    act(() => { saveHarness.editorTabs!.onSplitRight!("分屏章节"); });
    act(() => saveHarness.canvases.get("分屏章节")!.onCanvasContextChange!({
      activeResourceId: "分屏章节", activeKind: "chapter", activeTabId: "分屏章节", dirty: true, contentPreview: "独立分屏草稿",
    }));
    saveHarness.confirm.mockResolvedValueOnce(false);
    await expect(guard()).resolves.toBe(false);
    expect(saveHarness.confirm).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      title: backgroundDirty ? "「后台章节」「分屏章节」有未保存的修改" : "「分屏章节」有未保存的修改",
    }));
  });

  it.each(["换书", "换书再返回", "卸载", "更换注册回调", "撤销注册"])("宿主守卫在%s后清空注册，旧确认即使同意也不能放行", async (change) => {
    const nodes = [chapter("chapter:1")];
    setupTabs(nodes, "chapter:1");
    const onBeforeLeaveChange = vi.fn<NonNullable<IdeWorkbenchProps["onBeforeLeaveChange"]>>();
    const props = { nodes, selectedNode: null, onOpen: vi.fn(), onSave: vi.fn(), onBeforeLeaveChange };
    const { rerender, unmount } = render(<IdeWorkbench {...props} bookId="book-a" />);
    const guard = onBeforeLeaveChange.mock.calls[0][0]!;
    let decide!: (confirmed: boolean) => void;
    saveHarness.confirm.mockReturnValueOnce(new Promise<boolean>(resolve => { decide = resolve; }));
    let leaving!: Promise<boolean>;
    act(() => { leaving = guard(); });
    if (change === "卸载") unmount();
    else if (change === "更换注册回调") rerender(<IdeWorkbench {...props} bookId="book-a" onBeforeLeaveChange={vi.fn()} />);
    else if (change === "撤销注册") rerender(<IdeWorkbench {...props} bookId="book-a" onBeforeLeaveChange={undefined} />);
    else {
      rerender(<IdeWorkbench {...props} bookId="book-b" />);
      if (change === "换书再返回") rerender(<IdeWorkbench {...props} bookId="book-a" />);
    }
    expect(onBeforeLeaveChange).toHaveBeenCalledWith(null);
    await expect(guard()).resolves.toBe(false);
    await act(async () => { decide(true); await expect(leaving).resolves.toBe(false); });
    expect(saveHarness.confirm).toHaveBeenCalledTimes(1);
  });
});

describe("ResourcesSidebarPanel", () => {
  afterEach(() => cleanup());

  it("同时呈现作品总览入口、文件与分析工具两个分区；分区可收起而不卸载内容", () => {
    const onShowOverview = vi.fn();
    render(
      <ResourcesSidebarPanel
        overviewActive={false}
        onShowOverview={onShowOverview}
        files={<div data-testid="files-tree">文件树</div>}
        tools={<div data-testid="tools-tree">分析工具树</div>}
      />,
    );

    const files = screen.getByRole("region", { name: "文件" });
    const tools = screen.getByRole("region", { name: "分析工具" });
    expect(files.contains(screen.getByTestId("files-tree"))).toBe(true);
    expect(tools.contains(screen.getByTestId("tools-tree"))).toBe(true);

    const overview = screen.getByRole("button", { name: "作品总览" });
    expect(overview.getAttribute("aria-current")).toBeNull();
    fireEvent.click(overview);
    expect(onShowOverview).toHaveBeenCalledTimes(1);

    const toolsToggle = screen.getByRole("button", { name: "分析工具" });
    expect(toolsToggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toolsToggle);
    expect(toolsToggle.getAttribute("aria-expanded")).toBe("false");
    // 收起只隐藏：树还在（保留展开状态与搜索词）
    expect(screen.getByTestId("tools-tree").closest("[hidden]")).not.toBeNull();
    fireEvent.click(toolsToggle);
    expect(screen.getByTestId("tools-tree").closest("[hidden]")).toBeNull();
  });

  it("中央正显示作品总览时高亮入口", () => {
    render(<ResourcesSidebarPanel overviewActive onShowOverview={vi.fn()} files={null} tools={null} />);
    expect(screen.getByRole("button", { name: "作品总览" }).getAttribute("aria-current")).toBe("page");
  });
});
