import { useState } from "react";
import { useApi, postApi, putApi } from "../hooks/use-api";
import { useColors } from "../hooks/use-colors";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { Server, Play, Square, Trash2, Plus, RefreshCw, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

interface MCPServer {
  id: string;
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  status: "stopped" | "starting" | "running" | "error";
  tools?: Array<{ name: string; description: string }>;
  error?: string;
}

interface Props {
  nav: any;
  theme: Theme;
  t: TFunction;
}

export function MCPServerManager({ nav, theme, t }: Props) {
  const c = useColors(theme);
  const { data, refetch } = useApi<{ servers: MCPServer[] }>("/mcp/servers");
  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    command: "",
    args: "",
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
    const args = formData.args.split(",").map((s) => s.trim()).filter(Boolean);
    const env = formData.env ? JSON.parse(formData.env) : undefined;
    await postApi("/mcp/servers", {
      name: formData.name,
      command: formData.command,
      args,
      env,
    });
    setShowAddForm(false);
    setFormData({ name: "", command: "", args: "", env: "" });
    refetch();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1 text-foreground">MCP Server 管理</h1>
          <p className="text-sm text-muted-foreground">
            管理 Model Context Protocol 服务器连接
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={refetch} className={c.btnSecondary}>
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={() => setShowAddForm(true)} className={c.btnPrimary}>
            <Plus className="w-4 h-4 mr-2" />
            添加 Server
          </button>
        </div>
      </div>

      {showAddForm && (
        <div className={c.cardStatic + " mb-6"}>
          <h3 className="font-semibold mb-4 text-foreground">添加 MCP Server</h3>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium mb-1 text-foreground">名称</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className={c.input}
                placeholder="my-mcp-server"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-foreground">命令</label>
              <input
                type="text"
                value={formData.command}
                onChange={(e) => setFormData({ ...formData, command: e.target.value })}
                className={c.input}
                placeholder="npx"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-foreground">参数（逗号分隔）</label>
              <input
                type="text"
                value={formData.args}
                onChange={(e) => setFormData({ ...formData, args: e.target.value })}
                className={c.input}
                placeholder="-y, @modelcontextprotocol/server-filesystem, /path/to/dir"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-foreground">环境变量（JSON）</label>
              <textarea
                value={formData.env}
                onChange={(e) => setFormData({ ...formData, env: e.target.value })}
                className={c.input}
                rows={3}
                placeholder='{"API_KEY": "xxx"}'
              />
            </div>
            <div className="flex gap-2">
              <button onClick={handleAdd} className={c.btnPrimary}>
                添加
              </button>
              <button onClick={() => setShowAddForm(false)} className={c.btnSecondary}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {data?.servers.map((server) => (
          <div key={server.id} className={c.cardStatic}>
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <Server className="w-5 h-5 text-primary" />
                <div>
                  <h3 className="font-semibold text-foreground">{server.name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {server.command} {server.args.join(" ")}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {server.status === "running" && (
                  <span className="flex items-center gap-1 text-xs text-green-500">
                    <CheckCircle2 className="w-3 h-3" />
                    运行中
                  </span>
                )}
                {server.status === "starting" && (
                  <span className="flex items-center gap-1 text-xs text-yellow-500">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    启动中
                  </span>
                )}
                {server.status === "stopped" && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Square className="w-3 h-3" />
                    已停止
                  </span>
                )}
                {server.status === "error" && (
                  <span className="flex items-center gap-1 text-xs text-red-500">
                    <AlertCircle className="w-3 h-3" />
                    错误
                  </span>
                )}
              </div>
            </div>

            {server.error && (
              <div className="mb-3 p-2 rounded bg-red-500/10 text-red-500 text-xs">
                {server.error}
              </div>
            )}

            {server.tools && server.tools.length > 0 && (
              <div className="mb-3">
                <p className="text-xs font-medium mb-2 text-foreground">可用工具 ({server.tools.length})</p>
                <div className="space-y-1">
                  {server.tools.slice(0, 3).map((tool) => (
                    <div key={tool.name} className="text-xs p-2 rounded bg-secondary/50">
                      <span className="font-mono text-foreground">{tool.name}</span>
                      <span className="text-muted-foreground ml-2">— {tool.description}</span>
                    </div>
                  ))}
                  {server.tools.length > 3 && (
                    <p className="text-xs text-muted-foreground">
                      ...还有 {server.tools.length - 3} 个工具
                    </p>
                  )}
                </div>
              </div>
            )}

            <div className="flex gap-2">
              {server.status === "stopped" && (
                <button onClick={() => handleStart(server.id)} className={c.btnPrimary + " text-xs"}>
                  <Play className="w-3 h-3 mr-1" />
                  启动
                </button>
              )}
              {(server.status === "running" || server.status === "starting") && (
                <button onClick={() => handleStop(server.id)} className={c.btnSecondary + " text-xs"}>
                  <Square className="w-3 h-3 mr-1" />
                  停止
                </button>
              )}
              <button onClick={() => handleDelete(server.id)} className={c.btnDanger + " text-xs"}>
                <Trash2 className="w-3 h-3 mr-1" />
                删除
              </button>
            </div>
          </div>
        ))}

        {(!data?.servers || data.servers.length === 0) && (
          <div className={c.cardStatic}>
            <p className="text-sm text-muted-foreground text-center py-8">
              暂无 MCP Server，点击右上角添加
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
