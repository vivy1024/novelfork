/**
 * Tools Tab - 可选工具管理
 */

import { useState } from "react";
import { Search } from "lucide-react";
import type { Tool } from "../../types/routines";

interface ToolsTabProps {
  tools: Tool[];
  onChange: (tools: Tool[]) => void;
}

const AVAILABLE_TOOLS: Tool[] = [
  // 核心创作工具（默认开启）
  { name: "Bash", enabled: true, description: "Execute shell commands", loadCommand: "/load bash" },
  { name: "Read", enabled: true, description: "Read file contents", loadCommand: "/load read" },
  { name: "Write", enabled: true, description: "Write files", loadCommand: "/load write" },
  { name: "Edit", enabled: true, description: "Edit existing files", loadCommand: "/load edit" },
  { name: "Grep", enabled: true, description: "Search file contents", loadCommand: "/load grep" },
  { name: "Glob", enabled: true, description: "Find files by pattern", loadCommand: "/load glob" },
  // 工作区管理（默认开启）
  { name: "EnterWorktree", enabled: true, description: "Enter git worktree", loadCommand: "/load enter_worktree" },
  { name: "ExitWorktree", enabled: true, description: "Exit git worktree", loadCommand: "/load exit_worktree" },
  { name: "TodoWrite", enabled: true, description: "Write todo lists", loadCommand: "/load todo_write" },
  // 联网工具（默认关闭，按需开启）
  { name: "WebFetch", enabled: false, description: "Fetch web content", loadCommand: "/load web_fetch" },
  { name: "WebSearch", enabled: false, description: "Search the web", loadCommand: "/load web_search" },
  // NarraFork 运维工具（默认关闭）
  { name: "Terminal", enabled: false, description: "Interact with persistent terminals", loadCommand: "/load terminal" },
  { name: "Recall", enabled: false, description: "Search previous NarraFork conversations", loadCommand: "/load recall" },
  { name: "Browser", enabled: false, description: "Control a browser for multi-step interactions", loadCommand: "/load browser" },
  { name: "ShareFile", enabled: false, description: "Generate temporary download links", loadCommand: "/load share_file" },
  { name: "ForkNarrator", enabled: false, description: "Fork an independent narrator workstream", loadCommand: "/load fork_narrator" },
  { name: "NarraForkAdmin", enabled: false, description: "Manage NarraFork server settings", loadCommand: "/load narrafork_admin" },
  // 团队协作（默认关闭）
  { name: "TeamCreate", enabled: false, description: "Create agent teams" },
  { name: "TeamDelete", enabled: false, description: "Delete agent teams" },
  { name: "Monitor", enabled: false, description: "Monitor processes" },
  { name: "SendMessage", enabled: false, description: "Send messages" },
  { name: "PushNotification", enabled: false, description: "Push notifications" },
];

export function ToolsTab({ tools, onChange }: ToolsTabProps) {
  const [search, setSearch] = useState("");

  // 合并默认工具和用户配置，保留用户新增的未知工具。
  const catalogTools = AVAILABLE_TOOLS.map((defaultTool) => {
    const userTool = tools.find((t) => t.name === defaultTool.name);
    return { ...defaultTool, ...userTool, loadCommand: userTool?.loadCommand ?? defaultTool.loadCommand ?? `/LOAD ${defaultTool.name}` };
  });
  const customTools = tools
    .filter((tool) => !AVAILABLE_TOOLS.some((defaultTool) => defaultTool.name === tool.name))
    .map((tool) => ({ ...tool, loadCommand: tool.loadCommand ?? `/LOAD ${tool.name}` }));
  const mergedTools = [...catalogTools, ...customTools];

  const filteredTools = mergedTools.filter((tool) =>
    tool.name.toLowerCase().includes(search.toLowerCase()) ||
    tool.description?.toLowerCase().includes(search.toLowerCase()) ||
    tool.loadCommand?.toLowerCase().includes(search.toLowerCase())
  );

  const handleToggle = (name: string) => {
    const existing = tools.find((t) => t.name === name);
    if (existing) {
      onChange(
        tools.map((t) => (t.name === name ? { ...t, enabled: !t.enabled } : t))
      );
    } else {
      const defaultTool = AVAILABLE_TOOLS.find((t) => t.name === name);
      if (defaultTool) {
        onChange([...tools, { ...defaultTool, enabled: !defaultTool.enabled }]);
      }
    }
  };

  const enabledCount = filteredTools.filter((t) => t.enabled).length;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted-foreground mb-3">
          Enable or disable optional tools. Core tools (Bash, Read, Write, Edit) are always available.
        </p>
        <div className="flex items-center justify-between mb-4">
          <div className="relative flex-1 max-w-md">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tools..."
              className="w-full pl-9 pr-3 py-2 text-sm border rounded-lg bg-background"
            />
          </div>
          <div className="text-sm text-muted-foreground">
            {enabledCount} / {filteredTools.length} enabled
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {filteredTools.map((tool) => (
          <div
            key={tool.name}
            className="border rounded-lg p-3 bg-card flex items-start justify-between gap-3"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-medium font-mono">{tool.name}</span>
                {!tool.enabled && (
                  <span className="text-xs text-muted-foreground">(disabled)</span>
                )}
              </div>
              <code className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                {tool.loadCommand ?? `/LOAD ${tool.name}`}
              </code>
              {tool.description && (
                <p className="mt-1 text-xs text-muted-foreground">{tool.description}</p>
              )}
            </div>
            <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
              <input
                type="checkbox"
                checked={tool.enabled}
                onChange={() => handleToggle(tool.name)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
            </label>
          </div>
        ))}
      </div>

      {filteredTools.length === 0 && (
        <div className="text-center py-8 text-sm text-muted-foreground">
          No tools found matching "{search}"
        </div>
      )}
    </div>
  );
}
