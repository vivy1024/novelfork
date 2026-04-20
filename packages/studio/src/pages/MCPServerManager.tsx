import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Server,
  Square,
  Trash2,
} from "lucide-react";

import { PageEmptyState } from "@/components/layout/PageEmptyState";
import { PageScaffold } from "@/components/layout/PageScaffold";
import { Button } from "@/components/ui/button";
import { postApi, useApi } from "../hooks/use-api";
import { useColors } from "../hooks/use-colors";
import type { TFunction } from "../hooks/use-i18n";
import type { Theme } from "../hooks/use-theme";

interface MCPServer {
  id: string;
  name: string;
  transport: "stdio" | "sse";
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  status: "disconnected" | "connecting" | "connected" | "reconnecting" | "failed";
  tools?: Array<{ name: string; description: string }>;
  error?: string;
}

interface Props {
  nav: unknown;
  theme: Theme;
  t: TFunction;
}

export function MCPServerManager({ nav, theme, t }: Props) {
  const c = useColors(theme);
  const { data, refetch } = useApi<{ servers: MCPServer[] }>("/mcp/servers");
  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    transport: "stdio" as "stdio" | "sse",
    command: "",
    args: "",
    url: "",
    env: "",
  });

  async function handleStart(id: string) {
    await postApi(`/mcp/servers/${id}/start`, {});
    refetch();
  }

  async function handleStop(id: string) {
    await postApi(`/mcp/servers/${id}/stop`, {});
    refetch();
  }

  async function handleDelete(id: string) {
    if (!confirm("确定删除此 MCP Server？")) return;
    await postApi(`/mcp/servers/${id}/delete`, {});
    refetch();
  }

  async function handleAdd() {
    const args = formData.args
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const env = formData.env ? JSON.parse(formData.env) : undefined;

    await postApi("/mcp/servers", {
      name: formData.name,
      transport: formData.transport,
      command: formData.transport === "stdio" ? formData.command : undefined,
      args: formData.transport === "stdio" ? args : undefined,
      url: formData.transport === "sse" ? formData.url : undefined,
      env,
    });

    setShowAddForm(false);
    setFormData({ name: "", transport: "stdio", command: "", args: "", url: "", env: "" });
    refetch();
  }

  return (
    <PageScaffold
      title="MCP Server 管理"
      description="管理 Model Context Protocol 的本地/远程服务连接，并查看当前可用工具。"
      actions={
        <div className="flex gap-2">
          <Button variant="outline" onClick={refetch}>
            <RefreshCw className="size-4" />
          </Button>
          <Button onClick={() => setShowAddForm(true)}>
            <Plus className="size-4" />
            添加 Server
          </Button>
        </div>
      }
    >
      {showAddForm && (
        <div className={`${c.cardStatic} mb-6`}>
          <h3 className="mb-4 font-semibold text-foreground">添加 MCP Server</h3>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">名称</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className={c.input}
                placeholder="my-mcp-server"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">传输方式</label>
              <select
                value={formData.transport}
                onChange={(e) => setFormData({ ...formData, transport: e.target.value as "stdio" | "sse" })}
                className={c.input}
              >
                <option value="stdio">stdio（本地进程）</option>
                <option value="sse">SSE（远程 HTTP）</option>
              </select>
            </div>
            {formData.transport === "stdio" ? (
              <>
                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground">命令</label>
                  <input
                    type="text"
                    value={formData.command}
                    onChange={(e) => setFormData({ ...formData, command: e.target.value })}
                    className={c.input}
                    placeholder="npx"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground">参数（逗号分隔）</label>
                  <input
                    type="text"
                    value={formData.args}
                    onChange={(e) => setFormData({ ...formData, args: e.target.value })}
                    className={c.input}
                    placeholder="-y, @modelcontextprotocol/server-filesystem, /path/to/dir"
                  />
                </div>
              </>
            ) : (
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">URL</label>
                <input
                  type="text"
                  value={formData.url}
                  onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                  className={c.input}
                  placeholder="http://localhost:3001/sse"
                />
              </div>
            )}
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">环境变量（JSON）</label>
              <textarea
                value={formData.env}
                onChange={(e) => setFormData({ ...formData, env: e.target.value })}
                className={c.input}
                rows={3}
                placeholder='{"API_KEY": "xxx"}'
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleAdd}>添加</Button>
              <Button variant="outline" onClick={() => setShowAddForm(false)}>
                取消
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {data?.servers.map((server) => (
          <div key={server.id} className={c.cardStatic}>
            <div className="mb-3 flex items-start justify-between">
              <div className="flex items-center gap-3">
                <Server className="size-5 text-primary" />
                <div>
                  <h3 className="font-semibold text-foreground">{server.name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {server.transport === "sse"
                      ? server.url
                      : `${server.command ?? ""} ${(server.args ?? []).join(" ")}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {server.status === "connected" && (
                  <span className="flex items-center gap-1 text-xs text-green-500">
                    <CheckCircle2 className="size-3" />
                    已连接
                  </span>
                )}
                {(server.status === "connecting" || server.status === "reconnecting") && (
                  <span className="flex items-center gap-1 text-xs text-yellow-500">
                    <Loader2 className="size-3 animate-spin" />
                    {server.status === "connecting" ? "连接中" : "重连中"}
                  </span>
                )}
                {server.status === "disconnected" && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Square className="size-3" />
                    未连接
                  </span>
                )}
                {server.status === "failed" && (
                  <span className="flex items-center gap-1 text-xs text-red-500">
                    <AlertCircle className="size-3" />
                    失败
                  </span>
                )}
              </div>
            </div>

            {server.error && (
              <div className="mb-3 rounded bg-red-500/10 p-2 text-xs text-red-500">{server.error}</div>
            )}

            {server.tools && server.tools.length > 0 && (
              <div className="mb-3">
                <p className="mb-2 text-xs font-medium text-foreground">可用工具（{server.tools.length}）</p>
                <div className="space-y-1">
                  {server.tools.slice(0, 3).map((tool) => (
                    <div key={tool.name} className="rounded bg-secondary/50 p-2 text-xs">
                      <span className="font-mono text-foreground">{tool.name}</span>
                      <span className="ml-2 text-muted-foreground">— {tool.description}</span>
                    </div>
                  ))}
                  {server.tools.length > 3 && (
                    <p className="text-xs text-muted-foreground">...还有 {server.tools.length - 3} 个工具</p>
                  )}
                </div>
              </div>
            )}

            <div className="flex gap-2">
              {server.status === "disconnected" && (
                <button onClick={() => handleStart(server.id)} className={`${c.btnPrimary} text-xs`}>
                  <Play className="mr-1 inline size-3" />
                  连接
                </button>
              )}
              {server.status === "failed" && (
                <button onClick={() => handleStart(server.id)} className={`${c.btnPrimary} text-xs`}>
                  <Play className="mr-1 inline size-3" />
                  重连
                </button>
              )}
              {(server.status === "connected" ||
                server.status === "connecting" ||
                server.status === "reconnecting") && (
                <button onClick={() => handleStop(server.id)} className={`${c.btnSecondary} text-xs`}>
                  <Square className="mr-1 inline size-3" />
                  断开
                </button>
              )}
              <button onClick={() => handleDelete(server.id)} className={`${c.btnDanger} text-xs`}>
                <Trash2 className="mr-1 inline size-3" />
                删除
              </button>
            </div>
          </div>
        ))}

        {(!data?.servers || data.servers.length === 0) && (
          <PageEmptyState title="暂无 MCP Server" description="点击右上角添加，接入本地或远程 MCP 工具服务。" />
        )}
      </div>
    </PageScaffold>
  );
}
