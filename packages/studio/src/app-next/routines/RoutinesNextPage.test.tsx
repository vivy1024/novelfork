import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
  routines: {
    listGlobal: vi.fn(),
    toggleGlobal: vi.fn(),
    getGlobalPrompt: vi.fn(),
    putGlobalPrompt: vi.fn(),
  },
  skills: {
    listGlobal: vi.fn(),
    getGlobal: vi.fn(),
    createGlobal: vi.fn(),
    updateGlobal: vi.fn(),
    deleteGlobal: vi.fn(),
    toggleGlobal: vi.fn(),
  },
  subagents: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  hooks: {
    listGlobal: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  mcp: {
    list: vi.fn(),
    create: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    test: vi.fn(),
    import: vi.fn(),
    tools: vi.fn(),
  },
  settings: {
    get: vi.fn(),
    patch: vi.fn(),
  },
  preferences: {
    get: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
  },
}));

const productMocks = vi.hoisted(() => ({
  listBookRoutines: vi.fn(),
  toggleBookRoutine: vi.fn(),
  listBookSkills: vi.fn(),
  getBookSkill: vi.fn(),
  listBookMcpOverrides: vi.fn(),
  putBookMcpOverride: vi.fn(),
  createBookSkill: vi.fn(),
  updateBookSkill: vi.fn(),
  deleteBookSkill: vi.fn(),
  listBookHooks: vi.fn(),
  createBookHook: vi.fn(),
  updateBookHook: vi.fn(),
  deleteBookHook: vi.fn(),
  listBookRules: vi.fn(),
  putBookRules: vi.fn(),
}));

const cacheMocks = vi.hoisted(() => ({ invalidateNarratorCommands: vi.fn() }));

vi.mock("../runtime-admin", async () => {
  const actual = await vi.importActual<typeof import("../runtime-admin")>("../runtime-admin");
  return {
    ...actual,
    createRoutinesClient: () => runtimeMocks.routines,
    createSkillsClient: () => runtimeMocks.skills,
    createCustomSubagentsClient: () => runtimeMocks.subagents,
    createHooksClient: () => runtimeMocks.hooks,
    createMcpClient: () => runtimeMocks.mcp,
    createSettingsClient: () => runtimeMocks.settings,
    createUserPreferencesClient: () => runtimeMocks.preferences,
  };
});

vi.mock("../runtime/product-contract", async () => {
  const actual = await vi.importActual<typeof import("../runtime/product-contract")>("../runtime/product-contract");
  return { ...actual, createRuntimeProductClient: () => productMocks };
});

vi.mock("@frontend/lib/query-client", () => ({
  invalidateNarratorCommands: cacheMocks.invalidateNarratorCommands,
}));

vi.mock("@/components/ui/simple-select", () => ({
  SimpleSelect: ({
    value,
    onValueChange,
    options,
    disabled,
    className,
    "aria-label": ariaLabel,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    options: Array<{ value: string; label: string; disabled?: boolean }>;
    disabled?: boolean;
    className?: string;
    "aria-label"?: string;
  }) => (
    <select
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      className={className}
      onChange={(event) => onValueChange(event.currentTarget.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>
      ))}
    </select>
  ),
}));

import { RoutinesNextPage } from "./RoutinesNextPage";

const globalRoutines = [
  {
    id: "write-next",
    type: "command",
    category: "Writing",
    name: "Write Next",
    descriptionEn: "Write the next chapter",
    descriptionZh: "续写下一章",
    enabled: true,
  },
  {
    id: "review",
    type: "skill",
    category: "Writing",
    name: "Review",
    descriptionEn: "Review a draft",
    descriptionZh: "审阅草稿",
    enabled: false,
  },
  {
    id: "terminal",
    type: "tool",
    category: "Tools",
    name: "Terminal",
    descriptionEn: "Persistent terminal",
    descriptionZh: "持久终端",
    enabled: true,
  },
] as const;

const bookRoutines = globalRoutines.map((routine) => ({
  ...routine,
  override: routine.id === "review" ? "enabled" : "global",
  enabled: routine.id === "review" ? true : routine.enabled,
  globalEnabled: routine.enabled,
})) as const;

const globalSkills = [
  { name: "reviewer", description: "Review prose", location: "C:/Users/Test/.narrafork/skills/reviewer/SKILL.md", files: ["SKILL.md"], disabled: false },
] as const;

const bookSkills = [
  { name: "book-style", description: "Book prose rules", location: "book", files: ["SKILL.md"], disabled: false },
] as const;

const subagents = [
  {
    name: "critic",
    description: "Critiques chapters",
    toolAccess: "custom",
    customTools: ["Read", "Grep"],
    defaultModel: "codex:gpt-5",
    prompt: "Review the chapter carefully.",
  },
] as const;

const globalHook = {
  id: "global-hook",
  projectId: null,
  event: "PostToolUse",
  matcher: "Write",
  type: "command",
  command: "bun scripts/audit.ts",
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

const bookHook = {
  ...globalHook,
  id: "book-hook",
  matcher: "novel_write_chapter",
  command: "bun scripts/book-audit.ts",
} as const;

const mcpServer = {
  id: "memory-server",
  name: "Memory",
  transport: "stdio",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-memory"],
  enabled: true,
  defaultBehavior: "readOnly",
  status: "connected",
  tools: [{ name: "recall", description: "Recall memory" }],
  toolPermissions: [],
} as const;

let preferenceState: Record<string, unknown>;
let settingsState: Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();

  preferenceState = {
    commands: [
      { name: "draft-review", prompt: "Review the current draft", description: "Review draft" },
      {
        name: "routine-review",
        prompt: "Run routine review",
        description: `Routine command ${"[routine:"}review]`,
      },
    ],
  };
  settingsState = {
    agent: {
      commandWhitelist: [{ pattern: "^git status$", enabled: true }],
      commandBlacklist: [{ pattern: "rm\\s+-rf", denyPrompt: "拒绝危险删除", enabled: true }],
      webFetchPolicy: { allowAll: false, whitelist: [], blacklist: [] },
      planReflectionAutoApprove: false,
      defaultSystemPrompt: "Default system rules",
    },
  };

  runtimeMocks.routines.listGlobal.mockResolvedValue({ routines: globalRoutines });
  runtimeMocks.routines.toggleGlobal.mockResolvedValue({ ok: true });
  runtimeMocks.routines.getGlobalPrompt.mockResolvedValue({
    content: "# Global rules",
    filePath: "D:/Workspace/NovelFork/CLAUDE.md",
    candidates: [
      { path: "D:/Workspace/NovelFork/AGENT.md", exists: false },
      { path: "D:/Workspace/NovelFork/CLAUDE.md", exists: true },
    ],
  });
  runtimeMocks.routines.putGlobalPrompt.mockResolvedValue({ ok: true, filePath: "D:/Workspace/NovelFork/CLAUDE.md" });

  runtimeMocks.skills.listGlobal.mockResolvedValue(globalSkills);
  runtimeMocks.skills.getGlobal.mockResolvedValue({ ...globalSkills[0], content: "Review carefully" });
  runtimeMocks.skills.createGlobal.mockResolvedValue({ ...globalSkills[0], content: "New content" });
  runtimeMocks.skills.updateGlobal.mockResolvedValue({ ...globalSkills[0], content: "Updated" });
  runtimeMocks.skills.deleteGlobal.mockResolvedValue({ ok: true });
  runtimeMocks.skills.toggleGlobal.mockResolvedValue(globalSkills[0]);

  runtimeMocks.subagents.list.mockResolvedValue(subagents);
  runtimeMocks.subagents.create.mockResolvedValue(subagents[0]);
  runtimeMocks.subagents.update.mockResolvedValue(subagents[0]);
  runtimeMocks.subagents.delete.mockResolvedValue({ ok: true });

  runtimeMocks.hooks.listGlobal.mockResolvedValue([globalHook]);
  runtimeMocks.hooks.create.mockResolvedValue(globalHook);
  runtimeMocks.hooks.update.mockResolvedValue(globalHook);
  runtimeMocks.hooks.delete.mockResolvedValue({ ok: true });

  runtimeMocks.mcp.list.mockResolvedValue({ servers: [mcpServer] });
  runtimeMocks.mcp.tools.mockResolvedValue({
    tools: [{ name: "recall", description: "Recall memory", serverName: "Memory", serverId: "memory-server", source: "external" }],
  });
  runtimeMocks.mcp.create.mockResolvedValue(mcpServer);
  runtimeMocks.mcp.patch.mockResolvedValue(mcpServer);
  runtimeMocks.mcp.delete.mockResolvedValue({ ok: true });
  runtimeMocks.mcp.connect.mockResolvedValue(mcpServer);
  runtimeMocks.mcp.disconnect.mockResolvedValue({ ok: true });
  runtimeMocks.mcp.test.mockResolvedValue({ ok: true, tools: mcpServer.tools });
  runtimeMocks.mcp.import.mockResolvedValue({ added: 1, skipped: 0 });

  runtimeMocks.preferences.get.mockImplementation(async () => preferenceState);
  runtimeMocks.preferences.patch.mockImplementation(async (patch: Record<string, unknown>) => {
    preferenceState = { ...preferenceState, ...patch };
    return preferenceState;
  });
  runtimeMocks.preferences.put.mockImplementation(async (patch: Record<string, unknown>) => {
    preferenceState = { ...preferenceState, ...patch };
    return preferenceState;
  });

  runtimeMocks.settings.get.mockImplementation(async () => settingsState);
  runtimeMocks.settings.patch.mockImplementation(async (patch: { agent?: Record<string, unknown> }) => {
    settingsState = {
      ...settingsState,
      agent: { ...(settingsState.agent as Record<string, unknown>), ...(patch.agent ?? {}) },
    };
    return settingsState;
  });

  productMocks.listBookRoutines.mockResolvedValue({ routines: bookRoutines });
  productMocks.toggleBookRoutine.mockResolvedValue({ ok: true });
  productMocks.listBookSkills.mockResolvedValue(bookSkills);
  productMocks.getBookSkill.mockResolvedValue({ ...bookSkills[0], content: "Use this style" });
  productMocks.listBookMcpOverrides.mockResolvedValue({
    serverOverrides: [{
      serverId: "memory-server",
      defaultBehavior: "ask",
      toolPermissions: [{ toolName: "recall", behavior: "readOnly" }],
    }],
  });
  productMocks.putBookMcpOverride.mockResolvedValue({ serverOverrides: [] });
  productMocks.createBookSkill.mockResolvedValue({ ...bookSkills[0], content: "Created" });
  productMocks.updateBookSkill.mockResolvedValue({ ...bookSkills[0], content: "Updated" });
  productMocks.deleteBookSkill.mockResolvedValue({ ok: true });
  productMocks.listBookHooks.mockResolvedValue([bookHook]);
  productMocks.createBookHook.mockResolvedValue(bookHook);
  productMocks.updateBookHook.mockResolvedValue(bookHook);
  productMocks.deleteBookHook.mockResolvedValue({ ok: true });
  productMocks.listBookRules.mockResolvedValue({ content: null, filePath: null, candidates: [] });
  productMocks.putBookRules.mockResolvedValue({ ok: true, filePath: "AGENT.md" });
  cacheMocks.invalidateNarratorCommands.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

function routineTabs() {
  return screen.getByRole("tablist", { name: "套路分区" });
}

function openTab(name: string) {
  fireEvent.click(within(routineTabs()).getByRole("tab", { name }));
}

describe("RoutinesNextPage Runtime integration", () => {
  it("uses only global routines when no book is selected", async () => {
    render(<RoutinesNextPage />);

    await waitFor(() => expect(runtimeMocks.routines.listGlobal).toHaveBeenCalled());
    expect(productMocks.listBookRoutines).not.toHaveBeenCalled();
    expect(screen.getByText("未选择作品")).toBeTruthy();
    expect(screen.queryByText(/project-123/)).toBeNull();

    openTab("可选工具");
    expect(await screen.findByText("Terminal")).toBeTruthy();
  });

  it("manages built-in routines and optional tools through book-scoped product methods", async () => {
    render(<RoutinesNextPage bookId="book/a" bookTitle="长夜" />);

    await waitFor(() => expect(productMocks.listBookRoutines).toHaveBeenCalledWith("book/a"));
    fireEvent.click(screen.getByRole("switch", { name: "切换全局状态：Review" }));
    await waitFor(() => expect(runtimeMocks.routines.toggleGlobal).toHaveBeenCalledWith("review", true));

    fireEvent.click(screen.getByRole("button", { name: "禁用作品套路：Review" }));
    await waitFor(() => expect(productMocks.toggleBookRoutine).toHaveBeenCalledWith("book/a", "review", "disable"));
    expect(cacheMocks.invalidateNarratorCommands).toHaveBeenCalled();

    openTab("可选工具");
    expect(await screen.findByText("Terminal")).toBeTruthy();
    expect(screen.queryByText("Review")).toBeNull();
  });

  it("creates, edits, and deletes user commands while preserving routine-managed commands", async () => {
    render(<RoutinesNextPage />);
    openTab("自定义命令");

    expect(await screen.findByText("/draft-review")).toBeTruthy();
    expect(screen.getByText("/routine-review")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "添加命令" }));
    const createDialog = screen.getByRole("dialog");
    fireEvent.change(within(createDialog).getByLabelText("名称"), { target: { value: "planner" } });
    fireEvent.change(within(createDialog).getByLabelText("提示模板"), { target: { value: "Plan the next arc" } });
    fireEvent.click(within(createDialog).getByRole("button", { name: "创建命令" }));

    await waitFor(() => expect(runtimeMocks.preferences.patch).toHaveBeenCalledWith({
      commands: [
        expect.objectContaining({ name: "routine-review" }),
        expect.objectContaining({ name: "draft-review" }),
        expect.objectContaining({ name: "planner", prompt: "Plan the next arc" }),
      ],
    }));
    expect(cacheMocks.invalidateNarratorCommands).toHaveBeenCalled();

    const draftCard = screen.getByText("/draft-review").closest("[data-slot=card]");
    fireEvent.click(within(draftCard as HTMLElement).getByRole("button", { name: "编辑" }));
    const editDialog = screen.getByRole("dialog");
    fireEvent.change(within(editDialog).getByLabelText("提示模板"), { target: { value: "Review and rewrite the draft" } });
    fireEvent.click(within(editDialog).getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(runtimeMocks.preferences.patch).toHaveBeenLastCalledWith({
      commands: expect.arrayContaining([expect.objectContaining({ name: "draft-review", prompt: "Review and rewrite the draft" })]),
    }));

    const plannerCard = await screen.findByText("/planner");
    fireEvent.click(within(plannerCard.closest("[data-slot=card]") as HTMLElement).getByRole("button", { name: "删除" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "删除" }));
    await waitFor(() => expect(runtimeMocks.preferences.patch).toHaveBeenLastCalledWith({
      commands: expect.not.arrayContaining([expect.objectContaining({ name: "planner" })]),
    }));
  });

  it("saves real Bash, WebFetch, and plan reflection settings", async () => {
    render(<RoutinesNextPage />);
    openTab("工具权限");

    expect(await screen.findByText("Bash 命令白名单")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "计划反思自动批准" }));
    fireEvent.click(screen.getByRole("switch", { name: "WebFetch 允许所有 URL" }));
    fireEvent.click(screen.getByRole("button", { name: "保存权限设置" }));

    await waitFor(() => expect(runtimeMocks.settings.patch).toHaveBeenCalledWith({
      agent: {
        commandWhitelist: [{ pattern: "^git status$", enabled: true }],
        commandBlacklist: [{ pattern: "rm\\s+-rf", denyPrompt: "拒绝危险删除", enabled: true }],
        webFetchPolicy: { allowAll: true, whitelist: [], blacklist: [] },
        planReflectionAutoApprove: true,
      },
    }));
  });

  it("uses book-scoped skill CRUD without exposing a Runtime project id", async () => {
    render(<RoutinesNextPage bookId="book-123" bookTitle="长夜" />);
    openTab("作品技能");

    await waitFor(() => expect(productMocks.listBookSkills).toHaveBeenCalledWith("book-123"));
    expect(screen.getByText("book-style")).toBeTruthy();
    expect(screen.getByText("作品")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "创建技能" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("名称"), { target: { value: "continuity" } });
    fireEvent.change(within(dialog).getByLabelText("描述"), { target: { value: "Track continuity" } });
    fireEvent.change(within(dialog).getByLabelText("内容"), { target: { value: "Check facts" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建" }));

    await waitFor(() => expect(productMocks.createBookSkill).toHaveBeenCalledWith("book-123", {
      name: "continuity",
      description: "Track continuity",
      content: "Check facts",
    }));
    expect(cacheMocks.invalidateNarratorCommands).toHaveBeenCalled();
  });

  it("edits default system prompt and repository-root instructions independently", async () => {
    render(<RoutinesNextPage />);
    openTab("规则与提示词");

    expect(await screen.findByText("D:/Workspace/NovelFork/CLAUDE.md · 已存在")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("默认系统提示词 Markdown"), { target: { value: "Updated default" } });
    fireEvent.click(screen.getByRole("button", { name: "保存默认提示词" }));
    await waitFor(() => expect(runtimeMocks.settings.patch).toHaveBeenCalledWith({ agent: { defaultSystemPrompt: "Updated default" } }));

    fireEvent.change(screen.getByLabelText("仓库根目录提示词 Markdown"), { target: { value: "# Updated repository instructions" } });
    fireEvent.click(screen.getByRole("button", { name: "保存仓库提示词" }));
    await waitFor(() => expect(runtimeMocks.routines.putGlobalPrompt).toHaveBeenCalledWith(
      "# Updated repository instructions",
      "D:/Workspace/NovelFork/CLAUDE.md",
    ));
    fireEvent.click(screen.getByRole("button", { name: "恢复继承" }));
    await waitFor(() => expect(runtimeMocks.settings.patch).toHaveBeenLastCalledWith({ agent: { defaultSystemPrompt: null } }));
  });

  it("clears MCP inheritance overrides and edits per-tool permission", async () => {
    render(<RoutinesNextPage />);
    openTab("MCP");

    expect((await screen.findAllByText("Memory")).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("工具权限：Memory/recall"), { target: { value: "deny" } });
    await waitFor(() => expect(runtimeMocks.mcp.patch).toHaveBeenCalledWith("memory-server", {
      toolPermissionPatch: { toolName: "recall", behavior: "deny" },
    }));

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("默认工具行为"), { target: { value: "inherit" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(runtimeMocks.mcp.patch).toHaveBeenCalledWith(
      "memory-server",
      expect.objectContaining({ defaultBehavior: null }),
    ));
  });

  it("writes and clears book MCP server and per-tool overrides through the trusted book gateway", async () => {
    render(<RoutinesNextPage bookId="book-mcp" bookTitle="长夜" />);
    openTab("MCP");

    await waitFor(() => expect(productMocks.listBookMcpOverrides).toHaveBeenCalledWith("book-mcp"));
    expect(screen.getByText("作品权限覆盖 · 长夜")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("作品服务器权限：Memory"), { target: { value: "inherit" } });
    await waitFor(() => expect(productMocks.putBookMcpOverride).toHaveBeenCalledWith(
      "book-mcp",
      "memory-server",
      { defaultBehavior: null },
    ));

    fireEvent.change(screen.getByLabelText("作品工具权限：Memory/recall"), { target: { value: "inherit" } });
    await waitFor(() => expect(productMocks.putBookMcpOverride).toHaveBeenCalledWith(
      "book-mcp",
      "memory-server",
      { toolPermissionPatch: { toolName: "recall", behavior: null } },
    ));
  });

  it("uses book Hook gateway by default for a selected book and never sends projectId", async () => {
    render(<RoutinesNextPage bookId="book-hooks" bookTitle="长夜" />);
    openTab("Hooks");

    await waitFor(() => expect(productMocks.listBookHooks).toHaveBeenCalledWith("book-hooks"));
    expect(screen.getByText("novel_write_chapter")).toBeTruthy();
    expect(screen.queryByText(/project-/)).toBeNull();

    fireEvent.click(screen.getByRole("switch", { name: "切换钩子：book-hook" }));
    await waitFor(() => expect(productMocks.updateBookHook).toHaveBeenCalledWith("book-hooks", "book-hook", { enabled: false }));

    fireEvent.click(screen.getByRole("button", { name: "创建 Hook" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("命令"), { target: { value: "bun scripts/after-write.ts" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建" }));
    await waitFor(() => expect(productMocks.createBookHook).toHaveBeenCalledWith(
      "book-hooks",
      expect.not.objectContaining({ projectId: expect.anything() }),
    ));
  });

  it("resets book-scoped Hook editing when the selected book disappears", async () => {
    const view = render(<RoutinesNextPage bookId="book-hooks" bookTitle="长夜" />);
    openTab("Hooks");

    await waitFor(() => expect(productMocks.listBookHooks).toHaveBeenCalledWith("book-hooks"));
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(screen.getByRole("dialog")).toBeTruthy();

    view.rerender(<RoutinesNextPage />);
    await waitFor(() => expect(runtimeMocks.hooks.listGlobal).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("novel_write_chapter")).toBeNull();
    expect(screen.getByText("PostToolUse")).toBeTruthy();
  });

  it("reports Hook administrator failures honestly", async () => {
    const forbidden = Object.assign(new Error("Admin access required"), { status: 403 });
    runtimeMocks.hooks.listGlobal.mockRejectedValueOnce(forbidden);

    render(<RoutinesNextPage />);
    openTab("Hooks");

    await waitFor(() => expect(screen.getByText(/403 禁止访问 — 钩子管理需要 Runtime 管理员权限/)).toBeTruthy());
  });
});
