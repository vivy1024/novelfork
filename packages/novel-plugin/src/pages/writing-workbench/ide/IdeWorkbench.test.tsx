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
  alert: vi.fn<WorkbenchDialogs["alert"]>().mockResolvedValue(undefined),
  realSaving: false,
  // true 时 panel-manager mock 返回真实容器，侧栏面板（含被 mock 成探针的面板）才真正渲染。
  renderPanels: false,
  resourceTrees: [] as Array<ComponentProps<typeof import("../WorkbenchResourceTree").WorkbenchResourceTree>>,
  writeView: null as ComponentProps<typeof import("../WriteViewPanel").WriteViewPanel> | null,
  fileTreeNodes: [] as WorkbenchResourceNode[],
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
      const containersRef = React.useRef(new Map<string, HTMLDivElement>());
      return {
        activeView,
        showPanel: setActiveView,
        hostRef,
        // renderPanels 开启后给每个视图一个容器，让面板（含 mock 探针）真实渲染。
        getContainer: (view: string) => {
          if (!saveHarness.renderPanels) return null;
          let el = containersRef.current.get(view);
          if (!el) {
            el = document.createElement("div");
            containersRef.current.set(view, el);
          }
          return el;
        },
        ready: saveHarness.renderPanels,
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
  useBookFileTree: () => ({ nodes: saveHarness.fileTreeNodes, loading: false, error: null, reload: vi.fn(), refresh: vi.fn() }),
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
vi.mock("../WorkbenchResourceTree", () => ({
  WorkbenchResourceTree: (props: ComponentProps<typeof import("../WorkbenchResourceTree").WorkbenchResourceTree>) => {
    saveHarness.resourceTrees.push(props);
    return null;
  },
}));
vi.mock("../panels/BookSettingsPanel", () => ({ BookSettingsPanel: () => null }));
vi.mock("../NarrativeMemoryPanel", () => ({ NarrativeMemoryPanel: () => null }));
vi.mock("./SkillsAndStyleSidebarPanel", () => ({ SkillsAndStyleSidebarPanel: () => null }));
vi.mock("./CharactersAndLoreSidebarPanel", () => ({ CharactersAndLoreSidebarPanel: () => null }));
vi.mock("./StorylineAndPlanningSidebarPanel", () => ({ StorylineAndPlanningSidebarPanel: () => null }));
vi.mock("../EntityDetailDrawer", () => ({ EntityDetailDrawer: () => null }));
vi.mock("../jingwei/JingweiSidebarToolbar", () => ({ JingweiSidebarToolbar: () => null }));
vi.mock("../WriteViewPanel", () => ({
  WriteViewPanel: (props: ComponentProps<typeof import("../WriteViewPanel").WriteViewPanel>) => {
    saveHarness.writeView = props;
    return null;
  },
  WRITING_PROGRESS_EVENT: "ide:test-progress",
}));
vi.mock("./use-workbench-dialogs", () => ({
  useWorkbenchDialogs: () => ({
    confirm: saveHarness.confirm,
    prompt: vi.fn().mockResolvedValue(null),
    alert: saveHarness.alert,
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
  // 按 category 真实分组（设定/推进两个分区参数在此不作区分），
  // 让「一键修跳分类」之类的测试能看到与生产一致的嵌套分类树。
  groupEntriesByCategory: (entries: Array<{ category?: string }>) => {
    const byCategory = new Map<string, Array<{ category?: string }>>();
    for (const entry of entries) {
      const category = entry.category ?? "unclassified";
      if (!byCategory.has(category)) byCategory.set(category, []);
      byCategory.get(category)!.push(entry);
    }
    return [...byCategory.entries()].map(([category, list]) => ({ category, name: category, entries: list }));
  },
  memoryFactLabel: (value: string) => value,
}));
vi.mock("../../../engine/jingwei/unified-categories", () => ({ CATEGORY_META: [], normalizeCategory: (value: string) => value }));
vi.mock("@/components/ui/toast", () => ({ toast: vi.fn() }));

import { IdeWorkbench, ResourcesSidebarPanel, loadedFileKey, type IdeWorkbenchProps } from "./IdeWorkbench";
import { toast } from "@/components/ui/toast";

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
    saveHarness.tabs = null;
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

  it("从故事推进打开章节：tab 落在当前视图，不把活动栏拽去资源", async () => {
    stubHostWidth(1440);
    const openTab = vi.fn();
    saveHarness.tabs = {
      tabs: [], activeTabId: null, setDirty: vi.fn(), openTab, activateTab: vi.fn(), closeTab: vi.fn(),
      closeOthers: vi.fn(), closeAll: vi.fn(), closeSaved: vi.fn(), closeRight: vi.fn(), togglePin: vi.fn(),
      reorderTabs: vi.fn(), hasDirtyTabs: () => false,
    } as unknown as UseIdeTabsReturn;
    const chapter = { id: "chapter:10", kind: "chapter", title: "第10章 拓扑同构", capabilities: { open: true, edit: true } } as const;
    const props = { bookId: "book-1", nodes: [chapter], selectedNode: null, onOpen: vi.fn(), onSave: vi.fn() };
    const { rerender } = render(<IdeWorkbench {...props} />);
    await screen.findByTestId("ide-workbench");

    fireEvent.click(screen.getByRole("button", { name: "故事推进" }));
    rerender(<IdeWorkbench {...props} openRequest={{ bookId: "book-1", node: chapter, seq: 1 }} />);

    await waitFor(() => expect(openTab).toHaveBeenCalledWith("chapter:10", expect.any(String), "chapter", "storyline"));
    // 活动栏留在故事推进，不被拽去资源
    expect(screen.getByRole("button", { name: "故事推进" }).getAttribute("aria-pressed")).toBe("true");
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


describe("IdeWorkbench 静默交互修复", () => {
  function makeTabs(tab: { id: string; kind: string; view: string }) {
    saveHarness.tabs = {
      tabs: [{ id: tab.id, nodeId: tab.id, title: tab.id, dirty: false, kind: tab.kind, view: tab.view }],
      activeTabId: tab.id,
      setDirty: vi.fn(), openTab: vi.fn(), activateTab: vi.fn(), closeTab: vi.fn(), closeOthers: vi.fn(),
      closeAll: vi.fn(), closeSaved: vi.fn(), closeRight: vi.fn(), togglePin: vi.fn(), reorderTabs: vi.fn(),
      hasDirtyTabs: () => false,
    } as unknown as UseIdeTabsReturn;
  }

  beforeEach(() => {
    saveHarness.confirm.mockReset().mockResolvedValue(true);
    saveHarness.alert.mockReset().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ content: "磁盘正文", entries: [], facts: [], changes: [] })));
  });

  afterEach(() => {
    cleanup();
    saveHarness.tabs = null;
    saveHarness.canvases.clear();
    saveHarness.editorTabs = null;
    saveHarness.commands = null;
    saveHarness.writeView = null;
    saveHarness.resourceTrees.length = 0;
    saveHarness.fileTreeNodes = [];
    saveHarness.renderPanels = false;
    vi.mocked(toast).mockClear();
    vi.unstubAllGlobals();
  });

  it("「在侧边打开」先读正文写入缓存再分屏，而不是开一片空白", async () => {
    stubHostWidth(1440);
    saveHarness.renderPanels = true;
    render(<IdeWorkbench bookId="book-1" nodes={[]} selectedNode={null} onOpen={vi.fn()} onSave={vi.fn()} />);
    await screen.findByTestId("ide-workbench");
    const treeProps = saveHarness.resourceTrees.at(-1)!;
    expect(treeProps.onAction).toBeTypeOf("function");
    const fileNode: WorkbenchResourceNode = {
      id: "file:notes/a.md",
      kind: "file",
      title: "a.md",
      capabilities: { open: true, readonly: false, unsupported: false, edit: true, delete: false, apply: false },
      metadata: { isFile: true, filePath: "notes/a.md" },
    };
    act(() => { void treeProps.onAction!({ type: "open-side", node: fileNode }); });
    await waitFor(() => expect(screen.queryByTitle("关闭分屏")).toBeTruthy());
    const urls = vi.mocked(globalThis.fetch).mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes("/api/books/book-1/files/read"))).toBe(true);
  });

  it("「在侧边打开」读文件失败时弹出错误提示，不静默", async () => {
    stubHostWidth(1440);
    saveHarness.renderPanels = true;
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      if (String(input).includes("/files/read")) throw new Error("网络中断");
      return jsonResponse({ content: "磁盘正文", entries: [], facts: [], changes: [] });
    });
    render(<IdeWorkbench bookId="book-1" nodes={[]} selectedNode={null} onOpen={vi.fn()} onSave={vi.fn()} />);
    await screen.findByTestId("ide-workbench");
    const treeProps = saveHarness.resourceTrees.at(-1)!;
    const fileNode: WorkbenchResourceNode = {
      id: "file:notes/a.md",
      kind: "file",
      title: "a.md",
      capabilities: { open: true, readonly: false, unsupported: false, edit: true, delete: false, apply: false },
      metadata: { isFile: true, filePath: "notes/a.md" },
    };
    act(() => { void treeProps.onAction!({ type: "open-side", node: fileNode }); });
    await waitFor(() => expect(saveHarness.alert).toHaveBeenCalledWith(expect.objectContaining({ title: "在侧边打开失败" })));
    expect(screen.queryByTitle("关闭分屏")).toBeNull();
  });

  it("按章号跳转找不到章文件时 toast 提示，不再静默 miss；找得到时照常打开", async () => {
    const chapter: WorkbenchResourceNode = {
      id: "chapter:1",
      kind: "chapter",
      title: "第 1 章 雨夜",
      content: "正文",
      capabilities: { open: true, readonly: false, unsupported: false, edit: true, delete: false, apply: false },
      metadata: { isFile: true, isChapter: true, chapterNumber: 1, filePath: "chapters/卷01/0001_雨夜.md" },
    };
    makeTabs({ id: "chapter:1", kind: "chapter", view: "resources" });
    render(<IdeWorkbench nodes={[chapter]} selectedNode={null} onOpen={vi.fn()} onSave={vi.fn()} />);
    await waitFor(() => expect(saveHarness.canvases.get("chapter:1")).toBeTruthy());

    act(() => { saveHarness.canvases.get("chapter:1")!.onJumpToChapter!(99); });
    expect(vi.mocked(toast)).toHaveBeenCalledWith("找不到第 99 章的章文件", expect.any(String));

    act(() => { saveHarness.canvases.get("chapter:1")!.onJumpToChapter!(1); });
    expect(vi.mocked(toast)).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(saveHarness.tabs!.openTab).toHaveBeenCalledWith("chapter:1", expect.any(String), "chapter", "resources"));
  });

  it("命令面板的「导入旧书」：没有叙述者会话时弹出提示，不静默", async () => {
    render(<IdeWorkbench nodes={[]} selectedNode={null} onOpen={vi.fn()} onSave={vi.fn()} />);
    await screen.findByTestId("ide-workbench");
    await act(async () => { await saveHarness.commands!.openImportWizard(); });
    expect(saveHarness.alert).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining("叙述者会话") }));
  });

  it("命令面板的「导入旧书」：有叙述者会话时把导入指令交给叙述者", async () => {
    const onSendToNarrator = vi.fn();
    render(<IdeWorkbench nodes={[]} selectedNode={null} onOpen={vi.fn()} onSave={vi.fn()} onSendToNarrator={onSendToNarrator} />);
    await screen.findByTestId("ide-workbench");
    act(() => { saveHarness.commands!.openImportWizard(); });
    expect(onSendToNarrator).toHaveBeenCalledWith(expect.stringContaining("pipeline.import_chapters"));
    expect(saveHarness.alert).not.toHaveBeenCalled();
  });

  it("面包屑「作品基础」段解析不到目标时渲染成不可点", async () => {
    const entry: WorkbenchResourceNode = {
      id: "jingwei-entry:e1",
      kind: "jingwei-entry",
      title: "韩立",
      content: "",
      capabilities: { open: true, readonly: false, unsupported: false, edit: true, delete: true, apply: false },
      metadata: { entryId: "e1", category: "characters" },
    };
    makeTabs({ id: "jingwei-entry:e1", kind: "jingwei-entry", view: "characters-lore" });
    render(<IdeWorkbench nodes={[entry]} selectedNode={null} onOpen={vi.fn()} onSave={vi.fn()} />);

    // 「作品基础」在活动栏按钮里也有同名文本，按面包屑段的类名定位
    const segments = await screen.findAllByText("作品基础");
    const loreSegment = segments.find((el) => el.className.includes("truncate"));
    expect(loreSegment).toBeTruthy();
    expect(loreSegment!.className).not.toContain("cursor-pointer");
    // 书名段仍可点（回驾驶舱）
    expect(screen.getByText("NovelFork").className).toContain("cursor-pointer");
  });

  it("面包屑按路径前缀递归定位目录节点：嵌套的卷目录可点且点击打开", async () => {
    const chapterFile: WorkbenchResourceNode = {
      id: "file:chapters/卷01/0001_雨夜.md",
      kind: "chapter",
      title: "0001_雨夜.md",
      content: "雨",
      capabilities: { open: true, readonly: false, unsupported: false, edit: true, delete: false, apply: false },
      metadata: { isFile: true, isChapter: true, chapterNumber: 1, filePath: "chapters/卷01/0001_雨夜.md" },
    };
    const volumeDir: WorkbenchResourceNode = {
      id: "dir:chapters/卷01",
      kind: "group",
      title: "卷01",
      capabilities: { open: false, readonly: true, unsupported: false, edit: false, delete: false, apply: false },
      metadata: { isDirectory: true, filePath: "chapters/卷01" },
      children: [chapterFile],
    };
    saveHarness.fileTreeNodes = [{
      id: "dir:chapters",
      kind: "group",
      title: "chapters",
      capabilities: { open: false, readonly: true, unsupported: false, edit: false, delete: false, apply: false },
      metadata: { isDirectory: true, filePath: "chapters" },
      children: [volumeDir],
    }];
    makeTabs({ id: "file:chapters/卷01/0001_雨夜.md", kind: "chapter", view: "resources" });
    const onOpen = vi.fn();
    render(<IdeWorkbench nodes={[]} selectedNode={null} onOpen={onOpen} onSave={vi.fn()} />);

    const volumeSegment = await screen.findByText("卷01");
    expect(volumeSegment.className).toContain("cursor-pointer");
    fireEvent.click(volumeSegment);
    expect(onOpen).toHaveBeenCalledWith(volumeDir);
  });

  it("写作视图一键修跳分类：经统一打开链路解析嵌套的分类节点", async () => {
    const onOpen = vi.fn();
    saveHarness.renderPanels = true;
    const runtimeFetch = vi.fn(async (input: string) => {
      if (input.includes("/jingwei/entries")) {
        return { entries: [{ id: "e1", title: "韩立", category: "characters", contentMd: "" }] };
      }
      if (input.includes("narrative-memory/facts")) return { facts: [] };
      return {};
    });
    render(<IdeWorkbench bookId="book-1" nodes={[]} selectedNode={null} onOpen={onOpen} onSave={vi.fn()} runtimeFetch={runtimeFetch} />);
    await screen.findByTestId("ide-workbench");
    await waitFor(() => expect(saveHarness.writeView?.onOpenLorePanel).toBeTypeOf("function"));

    // 经纬树异步载入：载好前调用是空转，等到分类节点真正解析出来
    await waitFor(() => {
      act(() => { saveHarness.writeView!.onOpenLorePanel!("characters"); });
      expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "jingwei-cat:characters" }));
    });
  });
});
