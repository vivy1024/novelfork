import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hostMocks = vi.hoisted(() => ({
  hostProps: [] as Array<{
    path: string;
    isEmbeddedPath: (pathname: string) => boolean;
    onPathChange?: (path: string) => void;
    onNavigateOutside?: (path: string) => void;
  }>,
}));

const runtimeMocks = vi.hoisted(() => ({
  subagents: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  mcp: { list: vi.fn() },
}));

const productMocks = vi.hoisted(() => ({
  listBookRoutines: vi.fn(),
  toggleBookRoutine: vi.fn(),
  listBookSkills: vi.fn(),
  getBookSkill: vi.fn(),
  createBookSkill: vi.fn(),
  updateBookSkill: vi.fn(),
  deleteBookSkill: vi.fn(),
  listBookMcpOverrides: vi.fn(),
  putBookMcpOverride: vi.fn(),
  listBookHooks: vi.fn(),
  createBookHook: vi.fn(),
  updateBookHook: vi.fn(),
  deleteBookHook: vi.fn(),
  listBookRules: vi.fn(),
  putBookRules: vi.fn(),
}));

const cacheMocks = vi.hoisted(() => ({ invalidateNarratorCommands: vi.fn() }));

vi.mock("@vivy1024/narrafork-runtime-bridge/frontend/runtime-page", () => ({
  EmbeddedRuntimePageHost: (props: (typeof hostMocks.hostProps)[number]) => {
    hostMocks.hostProps.push(props);
    return <div data-testid="runtime-page-host-mock" data-path={props.path} />;
  },
}));

vi.mock("../runtime-admin", async () => {
  const actual = await vi.importActual<typeof import("../runtime-admin")>("../runtime-admin");
  return {
    ...actual,
    createCustomSubagentsClient: () => runtimeMocks.subagents,
    createMcpClient: () => runtimeMocks.mcp,
  };
});

vi.mock("../runtime/product-contract", async () => {
  const actual = await vi.importActual<typeof import("../runtime/product-contract")>("../runtime/product-contract");
  return { ...actual, createRuntimeProductClient: () => productMocks };
});

vi.mock("../runtime/narrator-command-cache", () => ({
  invalidateNarratorCommands: cacheMocks.invalidateNarratorCommands,
}));

// 写作配置来自小说插件；这里换成桩组件，只验证宿主把它挂进「本书设置」并传入书籍标识。
vi.mock("../plugin-ui/register-plugins", () => ({
  getPluginUISections: (mountPoint: string) =>
    mountPoint === "routines"
      ? [{ id: "novel-writing-config", label: "写作配置", icon: "PenLine", mountPoint: "routines", requiresBook: true, order: 100, componentKey: "novel-writing-config" }]
      : [],
}));
vi.mock("../plugin-ui/section-registry", () => ({
  getPluginSection: (key: string) =>
    key === "novel-writing-config"
      ? ({ bookId }: { bookId?: string }) => <div data-testid="writing-config-stub">写作配置：{bookId}</div>
      : undefined,
}));

vi.mock("@/components/ui/simple-select", () => ({
  SimpleSelect: ({
    value,
    onValueChange,
    options,
    disabled,
    "aria-label": ariaLabel,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    options: Array<{ value: string; label: string; disabled?: boolean }>;
    disabled?: boolean;
    "aria-label"?: string;
  }) => (
    <select aria-label={ariaLabel} value={value} disabled={disabled} onChange={(event) => onValueChange(event.currentTarget.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

import { RoutinesNextPage, type RoutinesNextPageProps } from "./RoutinesNextPage";

const books = [
  { id: "book-1", title: "长夜" },
  { id: "book-2", title: "旧站台" },
] as const;

const bookRoutines = [
  {
    id: "terminal",
    type: "tool",
    category: "tools",
    name: "Terminal",
    descriptionEn: "Persistent terminal",
    descriptionZh: "持久终端",
    enabled: false,
    override: "global",
    globalEnabled: false,
    mode: "auto",
    modeOverride: "global",
    globalMode: "auto",
  },
  {
    id: "browser",
    type: "tool",
    category: "tools",
    name: "Browser",
    descriptionEn: "Browser",
    descriptionZh: "浏览器",
    enabled: true,
    override: "enabled",
    globalEnabled: false,
    mode: "resident",
    modeOverride: "resident",
    globalMode: "manual",
  },
] as const;

const bookHook = {
  id: "book-hook",
  event: "PostToolUse",
  matcher: "novel_write_chapter",
  type: "command",
  command: "bun scripts/book-audit.ts",
  url: null,
  headers: null,
  proxyMode: null,
  proxyUrl: null,
  prompt: null,
  model: null,
  timeout: 30,
  enabled: true,
  sortOrder: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
} as const;

const mcpServer = {
  id: "memory-server",
  name: "Memory",
  transport: "stdio",
  enabled: true,
  defaultBehavior: "readOnly",
  status: "connected",
  tools: [{ name: "recall", description: "Recall memory" }],
} as const;

const subagents = [
  {
    name: "critic",
    description: "Critiques chapters",
    toolAccess: "custom",
    customTools: ["Read", "Grep"],
    defaultModel: "",
    prompt: "Review the chapter carefully.",
  },
  {
    name: "helper",
    description: "General helper",
    toolAccess: "general",
    customTools: [],
    defaultModel: "",
    prompt: "Help.",
  },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  hostMocks.hostProps.length = 0;

  runtimeMocks.subagents.list.mockResolvedValue(subagents);
  runtimeMocks.subagents.update.mockImplementation(async (_name: string, input: unknown) => input);
  runtimeMocks.mcp.list.mockResolvedValue({ servers: [mcpServer] });

  productMocks.listBookRoutines.mockResolvedValue({ routines: bookRoutines });
  productMocks.toggleBookRoutine.mockResolvedValue({ ok: true });
  productMocks.listBookSkills.mockResolvedValue([{ name: "book-style", description: "Book prose rules", location: "book", files: ["SKILL.md"], disabled: false }]);
  productMocks.getBookSkill.mockResolvedValue({ name: "book-style", description: "Book prose rules", content: "Use this style" });
  productMocks.createBookSkill.mockResolvedValue({ name: "continuity", description: "Track continuity", content: "Check facts" });
  productMocks.deleteBookSkill.mockResolvedValue({ ok: true });
  productMocks.listBookMcpOverrides.mockResolvedValue({
    serverOverrides: [{ serverId: "memory-server", defaultBehavior: "ask", toolPermissions: [{ toolName: "recall", behavior: "readOnly" }] }],
  });
  productMocks.putBookMcpOverride.mockResolvedValue({ serverOverrides: [] });
  productMocks.listBookHooks.mockResolvedValue([bookHook]);
  productMocks.createBookHook.mockResolvedValue(bookHook);
  productMocks.updateBookHook.mockResolvedValue(bookHook);
  productMocks.deleteBookHook.mockResolvedValue({ ok: true });
  productMocks.listBookRules.mockResolvedValue({
    content: null,
    filePath: null,
    candidates: [{ path: "AGENT.md", exists: false }, { path: "CLAUDE.md", exists: false }],
  });
  productMocks.putBookRules.mockResolvedValue({ ok: true, filePath: "AGENT.md" });
  cacheMocks.invalidateNarratorCommands.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

function renderPage(overrides: Partial<RoutinesNextPageProps> = {}) {
  const props: RoutinesNextPageProps = {
    route: { kind: "routines" },
    onNavigate: vi.fn(),
    onNavigateRuntimePath: vi.fn(),
    books,
    selectedBook: books[0],
    onSelectBook: vi.fn(),
    ...overrides,
  };
  const view = render(<RoutinesNextPage {...props} />);
  return { ...view, props, rerenderWith: (next: Partial<RoutinesNextPageProps>) => view.rerender(<RoutinesNextPage {...props} {...next} />) };
}

function pageTab(name: string) {
  return within(screen.getByRole("tablist", { name: "套路页签" })).getByRole("tab", { name });
}

function openBookSection(name: string) {
  fireEvent.click(within(screen.getByRole("tablist", { name: "本书设置分区" })).getByRole("tab", { name }));
}

describe("套路页：通用部分嵌入 Runtime 原页", () => {
  it("默认打开 Runtime 原生套路页，Studio 不再有自己的通用分区", async () => {
    renderPage();

    expect((await screen.findByTestId("runtime-page-host-mock")).getAttribute("data-path")).toBe("/routines");
    expect(pageTab("通用套路").getAttribute("aria-selected")).toBe("true");
    const { isEmbeddedPath } = hostMocks.hostProps.at(-1)!;
    expect(isEmbeddedPath("/routines/tool-permissions")).toBe(true);
    expect(isEmbeddedPath("/narrators/n-1")).toBe(false);
    // 旧复制品的分区（自定义命令、工具权限、全局技能……）不再由 Studio 渲染
    expect(screen.queryByRole("tablist", { name: "套路分区" })).toBeNull();
    expect(screen.queryByText("自定义命令")).toBeNull();
  });

  it("原页内跳转同步进 Studio 地址，跳出范围的链接交给外壳", async () => {
    const { props } = renderPage({ route: { kind: "routines", path: "/routines/tool-permissions" } });

    expect((await screen.findByTestId("runtime-page-host-mock")).getAttribute("data-path")).toBe("/routines/tool-permissions");
    const host = hostMocks.hostProps.at(-1)!;
    host.onPathChange?.("/routines");
    expect(props.onNavigate).toHaveBeenCalledWith({ kind: "routines", path: "/routines" });
    host.onNavigateOutside?.("/settings/agent");
    expect(props.onNavigateRuntimePath).toHaveBeenCalledWith("/settings/agent");
  });

  it("切到 NovelFork 面板时原页只是藏起来，切回去回到原来的子页", async () => {
    const view = renderPage({ route: { kind: "routines", path: "/routines/tool-permissions" } });
    await screen.findByTestId("runtime-page-host-mock");

    fireEvent.click(pageTab("本书设置"));
    expect(view.props.onNavigate).toHaveBeenLastCalledWith({ kind: "routines", panel: "book" });

    view.rerenderWith({ route: { kind: "routines", panel: "book" } });
    expect(screen.getByTestId("routines-runtime-page").hidden).toBe(true);
    expect(screen.getByTestId("runtime-page-host-mock").getAttribute("data-path")).toBe("/routines/tool-permissions");
    expect(pageTab("本书设置").getAttribute("aria-selected")).toBe("true");

    fireEvent.click(pageTab("通用套路"));
    expect(view.props.onNavigate).toHaveBeenLastCalledWith({ kind: "routines", path: "/routines/tool-permissions" });
  });

  it("直接打开 NovelFork 面板时不加载 Runtime 原页", () => {
    renderPage({ route: { kind: "routines", panel: "subagent-tools" } });
    expect(screen.queryByTestId("runtime-page-host-mock")).toBeNull();
  });
});

describe("套路页：本书设置", () => {
  it("没有作品时说明先建书", () => {
    renderPage({ route: { kind: "routines", panel: "book" }, books: [], selectedBook: null });
    expect(screen.getByText("还没有作品")).toBeTruthy();
    expect(productMocks.listBookRoutines).not.toHaveBeenCalled();
  });

  it("写作配置排在最前，按选中的书挂载；换书交给外壳", () => {
    const { props } = renderPage({ route: { kind: "routines", panel: "book" } });

    expect(screen.getByTestId("writing-config-stub").textContent).toBe("写作配置：book-1");
    fireEvent.change(screen.getByLabelText("选择作品"), { target: { value: "book-2" } });
    expect(props.onSelectBook).toHaveBeenCalledWith("book-2");
  });

  it("可选工具按书覆盖：显示全局的自动档，按书写常驻 / 手动 / 跟随全局", async () => {
    renderPage({ route: { kind: "routines", panel: "book" } });
    openBookSection("可选工具");

    await waitFor(() => expect(productMocks.listBookRoutines).toHaveBeenCalledWith("book-1"));
    expect(await screen.findByText("全局：自动")).toBeTruthy();
    const terminal = screen.getByRole("group", { name: "本书覆盖：Terminal" });
    expect(within(terminal).getByRole("button", { name: "跟随全局" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(within(terminal).getByRole("button", { name: "常驻" }));
    await waitFor(() => expect(productMocks.toggleBookRoutine).toHaveBeenCalledWith("book-1", "terminal", "enable"));
    expect(cacheMocks.invalidateNarratorCommands).toHaveBeenCalled();

    const browser = screen.getByRole("group", { name: "本书覆盖：Browser" });
    expect(within(browser).getByRole("button", { name: "常驻" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(browser).getByRole("button", { name: "跟随全局" }));
    await waitFor(() => expect(productMocks.toggleBookRoutine).toHaveBeenCalledWith("book-1", "browser", "reset"));
  });

  it("本书技能走书籍网关，不带 Runtime 项目标识", async () => {
    renderPage({ route: { kind: "routines", panel: "book" } });
    openBookSection("技能");

    expect(await screen.findByText("book-style")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "创建技能" })[0]!);
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("名称"), { target: { value: "continuity" } });
    fireEvent.change(within(dialog).getByLabelText("描述"), { target: { value: "Track continuity" } });
    fireEvent.change(within(dialog).getByLabelText("内容"), { target: { value: "Check facts" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建" }));

    await waitFor(() =>
      expect(productMocks.createBookSkill).toHaveBeenCalledWith("book-1", {
        name: "continuity",
        description: "Track continuity",
        content: "Check facts",
      }),
    );
    expect(cacheMocks.invalidateNarratorCommands).toHaveBeenCalled();
  });

  it("本书规则写到服务端给出的候选文件", async () => {
    renderPage({ route: { kind: "routines", panel: "book" } });
    openBookSection("规则");

    const editor = await screen.findByLabelText("本书规则 Markdown");
    fireEvent.change(editor, { target: { value: "# 本书规则\n不写现代词。" } });
    fireEvent.click(screen.getByRole("button", { name: "保存本书规则" }));
    await waitFor(() => expect(productMocks.putBookRules).toHaveBeenCalledWith("book-1", "# 本书规则\n不写现代词。", "AGENT.md"));
    expect(await screen.findByText("已保存")).toBeTruthy();
  });

  it("MCP 权限覆盖：选继承时发送 null 删除本书覆盖", async () => {
    renderPage({ route: { kind: "routines", panel: "book" } });
    openBookSection("MCP 权限");

    await waitFor(() => expect(productMocks.listBookMcpOverrides).toHaveBeenCalledWith("book-1"));
    const serverSelect = await screen.findByLabelText("本书服务器权限：Memory");
    expect((serverSelect as HTMLSelectElement).value).toBe("ask");
    fireEvent.change(serverSelect, { target: { value: "inherit" } });
    await waitFor(() => expect(productMocks.putBookMcpOverride).toHaveBeenCalledWith("book-1", "memory-server", { defaultBehavior: null }));

    fireEvent.change(screen.getByLabelText("本书工具权限：Memory/recall"), { target: { value: "deny" } });
    await waitFor(() =>
      expect(productMocks.putBookMcpOverride).toHaveBeenCalledWith("book-1", "memory-server", {
        toolPermissionPatch: { toolName: "recall", behavior: "deny" },
      }),
    );
  });

  it("本书钩子：切换、创建都只发书籍标识", async () => {
    renderPage({ route: { kind: "routines", panel: "book" } });
    openBookSection("钩子");

    expect(await screen.findByText("novel_write_chapter")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "启用钩子：book-hook" }));
    await waitFor(() => expect(productMocks.updateBookHook).toHaveBeenCalledWith("book-1", "book-hook", { enabled: false }));

    fireEvent.click(screen.getByRole("button", { name: "创建钩子" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("命令"), { target: { value: "bun scripts/after-write.ts" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建" }));
    await waitFor(() =>
      expect(productMocks.createBookHook).toHaveBeenCalledWith(
        "book-1",
        expect.objectContaining({ type: "command", command: "bun scripts/after-write.ts" }),
      ),
    );
    expect(productMocks.createBookHook.mock.calls[0]![1]).not.toHaveProperty("projectId");
  });

  it("钩子编辑：Attention 事件改用原因枚举，裸主机名补全协议", async () => {
    productMocks.listBookHooks.mockResolvedValue([]);
    renderPage({ route: { kind: "routines", panel: "book" } });
    openBookSection("钩子");

    fireEvent.click(await screen.findByRole("button", { name: "创建钩子" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("匹配器"), { target: { value: "Write" } });
    fireEvent.change(within(dialog).getByLabelText("钩子事件"), { target: { value: "Attention" } });
    await waitFor(() => expect(within(dialog).queryByLabelText("匹配器")).toBeNull());
    fireEvent.change(within(dialog).getByLabelText("钩子关注原因"), { target: { value: "waiting_permission" } });
    fireEvent.change(within(dialog).getByLabelText("钩子类型"), { target: { value: "http" } });
    fireEvent.change(await within(dialog).findByLabelText("URL"), { target: { value: "example.com/hook" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /查看传入字段与示例/ }));
    expect(within(dialog).getByText(/通用字段（所有事件）/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "创建" }));

    await waitFor(() =>
      expect(productMocks.createBookHook).toHaveBeenCalledWith(
        "book-1",
        expect.objectContaining({ event: "Attention", matcher: "waiting_permission", type: "http", url: "https://example.com/hook" }),
      ),
    );
  });

  it("钩子接口 403 时如实说明需要管理员", async () => {
    productMocks.listBookHooks.mockRejectedValueOnce(Object.assign(new Error("Admin access required"), { status: 403 }));
    renderPage({ route: { kind: "routines", panel: "book" } });
    openBookSection("钩子");

    expect(await screen.findByText(/403 禁止访问 — 钩子管理需要 Runtime 管理员权限/)).toBeTruthy();
  });
});

describe("套路页：子代理小说工具", () => {
  it("给自定义工具列表的子代理加小说工具，原样保留其余字段与通用工具", async () => {
    renderPage({ route: { kind: "routines", panel: "subagent-tools" } });

    const tools = await screen.findByRole("group", { name: "小说工具：critic" });
    expect(screen.getByText("通用工具（在原页勾选）：Read、Grep")).toBeTruthy();
    fireEvent.click(within(tools).getByRole("button", { name: "读章节" }));

    await waitFor(() =>
      expect(runtimeMocks.subagents.update).toHaveBeenCalledWith("critic", {
        ...subagents[0],
        customTools: ["Read", "Grep", "chapter.read"],
      }),
    );
    await waitFor(() => expect(within(tools).getByRole("button", { name: "读章节" }).getAttribute("aria-pressed")).toBe("true"));
  });

  it("不是工具列表模式的子代理只给说明，不能单独加工具", async () => {
    renderPage({ route: { kind: "routines", panel: "subagent-tools" } });

    expect(await screen.findByText(/工具访问是「General（可写）」/)).toBeTruthy();
    expect(screen.queryByRole("group", { name: "小说工具：helper" })).toBeNull();
  });
});
