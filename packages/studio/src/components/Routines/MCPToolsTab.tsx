/**
 * MCP Tools Tab - MCP 工具管理
 */

import { useState } from "react";
import { Search, Server, CheckCircle, XCircle } from "lucide-react";
import type { MCPTool } from "../../types/routines";

interface MCPToolsTabProps {
  mcpTools: MCPTool[];
  onChange: (tools: MCPTool[]) => void;
}

export function MCPToolsTab({ mcpTools, onChange }: MCPToolsTabProps) {
  const [search, setSearch] = useState("");

  const filteredTools = mcpTools.filter((tool) =>
    tool.serverName.toLowerCase().includes(search.toLowerCase()) ||
    tool.toolName.toLowerCase().includes(search.toLowerCase())
  );

  const handleToggle = (id: string) => {
    onChange(
      mcpTools.map((tool) =>
        tool.id === id ? { ...tool, enabled: !tool.enabled } : tool
      )
    );
  };

  const handleApprove = (id: string) => {
    onChange(
      mcpTools.map((tool) =>
        tool.id === id ? { ...tool, approved: true, enabled: true } : tool
      )
    );
  };

  const handleDeny = (id: string) => {
    onChange(
      mcpTools.map((tool) =>
        tool.id === id ? { ...tool, approved: false, enabled: false } : tool
      )
    );
  };

  const groupedByServer = filteredTools.reduce((acc, tool) => {
    if (!acc[tool.serverName]) {
      acc[tool.serverName] = [];
    }
    acc[tool.serverName].push(tool);
    return acc;
  }, {} as Record<string, MCPTool[]>);

  const approvedCount = mcpTools.filter((t) => t.approved).length;
  const enabledCount = mcpTools.filter((t) => t.enabled).length;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted-foreground mb-3">
          管理外部服务器提供的 MCP（Model Context Protocol）工具
        </p>
        <div className="flex items-center justify-between mb-4">
          <div className="relative flex-1 max-w-md">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索 MCP 工具..."
              className="w-full pl-9 pr-3 py-2 text-sm border rounded-lg bg-background"
            />
          </div>
          <div className="text-sm text-muted-foreground">
            已通过 {approvedCount} · 已启用 {enabledCount}
          </div>
        </div>
      </div>

      {Object.keys(groupedByServer).length === 0 ? (
        <div className="text-center py-8 text-sm text-muted-foreground">
          {search ? `未找到匹配“${search}”的 MCP 工具` : "还没有配置 MCP 工具"}
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(groupedByServer).map(([serverName, tools]) => (
            <div key={serverName} className="border rounded-lg p-4 bg-card">
              <div className="flex items-center gap-2 mb-3">
                <Server size={16} className="text-primary" />
                <h3 className="text-sm font-medium">{serverName}</h3>
                <span className="text-xs text-muted-foreground">
                  （{tools.length} 个工具）
                </span>
              </div>

              <div className="space-y-2">
                {tools.map((tool) => (
                  <div
                    key={tool.id}
                    className="flex items-center justify-between gap-3 p-2 rounded hover:bg-accent/50"
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {tool.approved ? (
                        <CheckCircle size={14} className="text-green-600 flex-shrink-0" />
                      ) : (
                        <XCircle size={14} className="text-red-600 flex-shrink-0" />
                      )}
                      <code className="text-sm font-mono truncate">
                        mcp__{serverName}__{tool.toolName}
                      </code>
                      {!tool.enabled && (
                        <span className="text-xs text-muted-foreground">（已停用）</span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {!tool.approved && (
                        <>
                          <button
                            onClick={() => handleApprove(tool.id)}
                            className="px-2 py-1 text-xs rounded bg-green-600 text-white hover:bg-green-700"
                          >
                            通过
                          </button>
                          <button
                            onClick={() => handleDeny(tool.id)}
                            className="px-2 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-700"
                          >
                            拒绝
                          </button>
                        </>
                      )}
                      {tool.approved && (
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={tool.enabled}
                            onChange={() => handleToggle(tool.id)}
                            className="sr-only peer"
                          />
                          <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                        </label>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
