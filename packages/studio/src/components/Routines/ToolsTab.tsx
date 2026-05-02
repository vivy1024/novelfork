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
  { name: "Bash", enabled: true, description: "执行 shell 命令", loadCommand: "/load bash" },
  { name: "Read", enabled: true, description: "读取文件内容", loadCommand: "/load read" },
  { name: "Write", enabled: true, description: "写入文件", loadCommand: "/load write" },
  { name: "Edit", enabled: true, description: "编辑已有文件", loadCommand: "/load edit" },
  { name: "Grep", enabled: true, description: "搜索文件内容", loadCommand: "/load grep" },
  { name: "Glob", enabled: true, description: "按模式查找文件", loadCommand: "/load glob" },
  // 工作区管理（默认开启）
  { name: "EnterWorktree", enabled: true, description: "进入 Git 工作树", loadCommand: "/load enter_worktree" },
  { name: "ExitWorktree", enabled: true, description: "退出 Git 工作树", loadCommand: "/load exit_worktree" },
  { name: "TodoWrite", enabled: true, description: "维护待办清单", loadCommand: "/load todo_write" },
  // 联网工具（默认关闭，按需开启）
  { name: "WebFetch", enabled: false, description: "抓取网页内容", loadCommand: "/load web_fetch" },
  { name: "WebSearch", enabled: false, description: "搜索网页", loadCommand: "/load web_search" },
  // NarraFork 运维工具（默认关闭）
  { name: "Terminal", enabled: false, description: "操作持久终端", loadCommand: "/load terminal" },
  { name: "Recall", enabled: false, description: "搜索历史对话", loadCommand: "/load recall" },
  { name: "Browser", enabled: false, description: "控制浏览器执行多步操作", loadCommand: "/load browser" },
  { name: "ShareFile", enabled: false, description: "生成临时下载链接", loadCommand: "/load share_file" },
  { name: "ForkNarrator", enabled: false, description: "分叉独立叙述者工作流", loadCommand: "/load fork_narrator" },
  { name: "NarraForkAdmin", enabled: false, description: "管理 NarraFork 服务器设置", loadCommand: "/load narrafork_admin" },
  // 团队协作（默认关闭）
  { name: "TeamCreate", enabled: false, description: "创建代理团队" },
  { name: "TeamDelete", enabled: false, description: "删除代理团队" },
  { name: "Monitor", enabled: false, description: "监控进程" },
  { name: "SendMessage", enabled: false, description: "发送消息" },
  { name: "PushNotification", enabled: false, description: "推送通知" },
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
          启用或停用可选工具。核心工具（Bash、Read、Write、Edit）始终可用。
        </p>
        <div className="flex items-center justify-between mb-4">
          <div className="relative flex-1 max-w-md">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索工具..."
              className="w-full pl-9 pr-3 py-2 text-sm border rounded-lg bg-background"
            />
          </div>
          <div className="text-sm text-muted-foreground">
            已启用 {enabledCount} / {filteredTools.length}
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
                  <span className="text-xs text-muted-foreground">（已停用）</span>
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
          未找到匹配“{search}”的工具
        </div>
      )}
    </div>
  );
}
