/** 统一工具目录 — 合并 Core 内置工具和 NarraFork 通用工具 */

export type ToolCategory = "core-writing" | "narrafork-general" | "narrafork-ops";
export type ToolVisibility = "author" | "advanced";

export interface ToolCatalogEntry {
  name: string;
  description: string;
  loadCommand: string;
  enabled: boolean;
  category: ToolCategory;
  visibility: ToolVisibility;
}

const CORE_TOOL_NAMES = [
  "plan_chapter", "compose_chapter", "write_draft", "write_full_pipeline",
  "audit_chapter", "revise_chapter",
  "read_truth_files", "write_truth_file", "update_author_intent", "update_current_focus",
  "import_style", "import_canon",
  "create_book", "get_book_status", "list_books", "import_chapters",
  "scan_market", "web_fetch",
];

const NARRAFORK_GENERAL_TOOLS: ToolCatalogEntry[] = [
  { name: "Bash", description: "Execute shell commands", loadCommand: "/load bash", enabled: true, category: "narrafork-general", visibility: "advanced" },
  { name: "Read", description: "Read file contents", loadCommand: "/load read", enabled: true, category: "narrafork-general", visibility: "advanced" },
  { name: "Write", description: "Write files", loadCommand: "/load write", enabled: true, category: "narrafork-general", visibility: "advanced" },
  { name: "Edit", description: "Edit existing files", loadCommand: "/load edit", enabled: true, category: "narrafork-general", visibility: "advanced" },
  { name: "Grep", description: "Search file contents", loadCommand: "/load grep", enabled: true, category: "narrafork-general", visibility: "advanced" },
  { name: "Glob", description: "Find files by pattern", loadCommand: "/load glob", enabled: true, category: "narrafork-general", visibility: "advanced" },
  { name: "EnterWorktree", description: "Enter git worktree", loadCommand: "/load enter_worktree", enabled: true, category: "narrafork-general", visibility: "advanced" },
  { name: "ExitWorktree", description: "Exit git worktree", loadCommand: "/load exit_worktree", enabled: true, category: "narrafork-general", visibility: "advanced" },
  { name: "TodoWrite", description: "Write todo lists", loadCommand: "/load todo_write", enabled: true, category: "narrafork-general", visibility: "advanced" },
];

const NARRAFORK_OPS_TOOLS: ToolCatalogEntry[] = [
  { name: "WebFetch", description: "Fetch web content", loadCommand: "/load web_fetch", enabled: false, category: "narrafork-ops", visibility: "advanced" },
  { name: "WebSearch", description: "Search the web", loadCommand: "/load web_search", enabled: false, category: "narrafork-ops", visibility: "advanced" },
  { name: "Terminal", description: "Interact with persistent terminals", loadCommand: "/load terminal", enabled: false, category: "narrafork-ops", visibility: "advanced" },
  { name: "Recall", description: "Search previous conversations", loadCommand: "/load recall", enabled: false, category: "narrafork-ops", visibility: "advanced" },
  { name: "Browser", description: "Control a browser", loadCommand: "/load browser", enabled: false, category: "narrafork-ops", visibility: "advanced" },
  { name: "ShareFile", description: "Generate temporary download links", loadCommand: "/load share_file", enabled: false, category: "narrafork-ops", visibility: "advanced" },
  { name: "ForkNarrator", description: "Fork an independent narrator", loadCommand: "/load fork_narrator", enabled: false, category: "narrafork-ops", visibility: "advanced" },
  { name: "NarraForkAdmin", description: "Manage server settings", loadCommand: "/load narrafork_admin", enabled: false, category: "narrafork-ops", visibility: "advanced" },
  { name: "TeamCreate", description: "Create agent teams", loadCommand: "", enabled: false, category: "narrafork-ops", visibility: "advanced" },
  { name: "TeamDelete", description: "Delete agent teams", loadCommand: "", enabled: false, category: "narrafork-ops", visibility: "advanced" },
  { name: "Monitor", description: "Monitor processes", loadCommand: "", enabled: false, category: "narrafork-ops", visibility: "advanced" },
  { name: "SendMessage", description: "Send messages", loadCommand: "", enabled: false, category: "narrafork-ops", visibility: "advanced" },
  { name: "PushNotification", description: "Push notifications", loadCommand: "", enabled: false, category: "narrafork-ops", visibility: "advanced" },
];

const CORE_TOOLS: ToolCatalogEntry[] = CORE_TOOL_NAMES.map((name) => ({
  name,
  description: "",
  loadCommand: `/load ${name}`,
  enabled: true,
  category: "core-writing" as const,
  visibility: "author" as const,
}));

export const TOOL_CATALOG: ToolCatalogEntry[] = [
  ...CORE_TOOLS,
  ...NARRAFORK_GENERAL_TOOLS,
  ...NARRAFORK_OPS_TOOLS,
];

export function getToolsByCategory(category: ToolCategory): ToolCatalogEntry[] {
  return TOOL_CATALOG.filter((t) => t.category === category);
}

export function getEnabledTools(): ToolCatalogEntry[] {
  return TOOL_CATALOG.filter((t) => t.enabled);
}

export function getVisibleToolsForWorkbenchMode(workbenchMode: boolean): ToolCatalogEntry[] {
  return TOOL_CATALOG.filter((tool) => workbenchMode || tool.visibility === "author");
}
