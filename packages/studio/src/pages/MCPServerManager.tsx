import { useMemo, useState } from "react";
import {
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Server,
  Square,
  Trash2,
  Wrench,
} from "lucide-react";

import { PageEmptyState } from "@/components/layout/PageEmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { postApi, putApi, useApi } from "../hooks/use-api";
import type { TFunction } from "../hooks/use-i18n";
import type { Theme } from "../hooks/use-theme";
import { describeToolAccessReason, type ToolAccessReasonKey } from "../shared/tool-access-reasons";

interface MCPServerTool {
  name: string;
  description: string;
  access?: "allow" | "prompt" | "deny";
  source?: string;
  reason?: string;
  reasonKey?: ToolAccessReasonKey;
}

interface MCPServer {
  id: string;
  name: string;
  transport: "stdio" | "sse";
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  status: "disconnected" | "connecting" | "connected" | "reconnecting" | "failed";
  tools: MCPServerTool[];
  toolCount: number;
  error?: string;
}

interface MCPRegistryResponse {
  summary: {
    totalServers: number;
    connectedServers: number;
    enabledTools: number;
    discoveredTools: number;
    allowTools?: number;
    promptTools?: number;
    denyTools?: number;
    policySource?: string;
    mcpStrategy?: "allow" | "ask" | "deny" | "inherit";
  };
  servers: MCPServer[];
}

interface Props {
  nav: { toWorkflow?: () => void };
  theme: Theme;
  t: TFunction;
}

interface ServerFormState {
  name: string;
  transport: "stdio" | "sse";
  command: string;
  args: string;
  url: string;
  env: string;
}

const EMPTY_FORM: ServerFormState = {
  name: "",
  transport: "stdio",
  command: "",
  args: "",
  url: "",
  env: "",
};

function toFormState(server?: MCPServer): ServerFormState {
  if (!server) {
    return { ...EMPTY_FORM };
  }
  return {
    name: server.name,
    transport: server.transport,
    command: server.command ?? "",
    args: (server.args ?? []).join(", "),
    url: server.url ?? "",
    env: server.env ? JSON.stringify(server.env, null, 2) : "",
  };
}

function isMCPConfigBundle(value: unknown): value is { mcpServers: Partial<MCPServer>[] } {
  return typeof value === "object" && value !== null && Array.isArray((value as { mcpServers?: unknown }).mcpServers);
}

function parseFormPayload(form: ServerFormState) {
  const args = form.args
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    name: form.name.trim(),
    transport: form.transport,
    command: form.transport === "stdio" ? form.command.trim() : undefined,
    args: form.transport === "stdio" ? args : undefined,
    url: form.transport === "sse" ? form.url.trim() : undefined,
    env: form.env.trim() ? JSON.parse(form.env) : undefined,
  };
}

function renderStatusLabel(status: MCPServer["status"]) {
  if (status === "connected") return "已连接";
  if (status === "connecting") return "连接中";
  if (status === "reconnecting") return "重连中";
  if (status === "failed") return "失败";
  return "未连接";
}

export function MCPServerManager({ nav, theme, t }: Props) {
  void theme;
  void t;

  const { data, refetch } = useApi<MCPRegistryResponse>("/mcp/registry");
  const [editorMode, setEditorMode] = useState<"create" | "edit" | "import" | null>(null);
  const [editingServerId, setEditingServerId] = useState<string | null>(null);
  const [formData, setFormData] = useState<ServerFormState>({ ...EMPTY_FORM });
  const [importJson, setImportJson] = useState("");

  const servers = data?.servers ?? [];
  const summary = data?.summary ?? {
    totalServers: 0,
    connectedServers: 0,
    enabledTools: 0,
    discoveredTools: 0,
    allowTools: 0,
    promptTools: 0,
    denyTools: 0,
  };

  const connectedRatio = useMemo(() => {
    if (summary.totalServers === 0) return "0%";
    return `${Math.round((summary.connectedServers / summary.totalServers) * 100)}%`;
  }, [summary.connectedServers, summary.totalServers]);

  function openCreateForm() {
    setEditorMode("create");
    setEditingServerId(null);
    setFormData({ ...EMPTY_FORM });
  }

  function openImportForm() {
    setEditorMode("import");
    setEditingServerId(null);
    setImportJson(JSON.stringify({ mcpServers: [] }, null, 2));
  }

  function openEditForm(server: MCPServer) {
    setEditorMode("edit");
    setEditingServerId(server.id);
    setFormData(toFormState(server));
  }

  function closeEditor() {
    setEditorMode(null);
    setEditingServerId(null);
    setFormData({ ...EMPTY_FORM });
    setImportJson("");
  }

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

  async function handleSave() {
    const payload = parseFormPayload(formData);

    if (editorMode === "edit" && editingServerId) {
      await putApi(`/mcp/servers/${editingServerId}`, payload);
    } else {
      await postApi("/mcp/servers", payload);
    }

    closeEditor();
    refetch();
  }

  async function handleImportJson() {
    const parsed = JSON.parse(importJson) as unknown;
    const entries = Array.isArray(parsed)
      ? parsed as Partial<MCPServer>[]
      : isMCPConfigBundle(parsed)
        ? parsed.mcpServers
        : [parsed as Partial<MCPServer>];

    for (const entry of entries) {
      await postApi("/mcp/servers", {
        name: entry.name,
        transport: entry.transport ?? "stdio",
        command: entry.transport === "sse" ? undefined : entry.command,
        args: entry.transport === "sse" ? undefined : entry.args,
        url: entry.transport === "sse" ? entry.url : undefined,
        env: entry.env,
      });
    }

    closeEditor();
    refetch();
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 rounded-2xl border border-border/60 bg-card/80 p-6 shadow-sm backdrop-blur-sm lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">NovelFork Studio</p>
          <div className="space-y-1">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">MCP Server 管理</h1>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              在工作流配置台统一管理 Model Context Protocol 的本地/远程服务连接，并把 transport、连接状态、工具数量与编辑能力收口到统一注册表视图。
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-2">
            {nav.toWorkflow && (
              <Button variant="outline" onClick={() => nav.toWorkflow?.()}>
                工作流总览
              </Button>
            )}
            <Button variant="outline" onClick={refetch}>
              <RefreshCw className="size-4" />
              刷新
            </Button>
            <Button variant="outline" onClick={openImportForm}>
              导入 JSON
            </Button>
            <Button onClick={openCreateForm}>
              <Plus className="size-4" />
              添加 Server
            </Button>
          </div>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard title="已注册 Server" value={String(summary.totalServers)} description="当前已写入 novelfork.json 的 MCP 服务数" />
        <SummaryCard title="已连接" value={String(summary.connectedServers)} description={`连接占比 ${connectedRatio}`} />
        <SummaryCard title="已发现工具" value={String(summary.discoveredTools)} description={`allow ${summary.allowTools ?? 0} / prompt ${summary.promptTools ?? 0} / deny ${summary.denyTools ?? 0}`} />
        <SummaryCard title="已启用工具" value={String(summary.enabledTools)} description="当前进入系统注册视图的工具数量" />
      </div>

      <Card className="border-dashed bg-muted/20">
        <CardHeader>
          <CardTitle className="text-base">治理总览</CardTitle>
          <CardDescription>让 MCP 注册表直接映射 Settings 的权限策略，而不是只显示连接与工具数量。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm text-muted-foreground md:grid-cols-3">
          <div>策略来源：{summary.policySource ?? "runtimeControls.toolAccess"}</div>
          <div>MCP 默认策略：{summary.mcpStrategy ?? "inherit"}</div>
          <div>调用执行链：遵循 Settings 的重试 / trace / dump 配置</div>
        </CardContent>
      </Card>

      <Card className="border-amber-500/20 bg-amber-500/10">
        <CardHeader>
          <CardTitle className="text-base text-amber-900">MCP 权限与风险说明</CardTitle>
          <CardDescription className="text-amber-900/80">
            stdio MCP 会启动本地进程，SSE MCP 会连接远端服务；工具参数、环境变量和返回值可能包含本地路径、账号上下文或敏感素材。所有调用必须遵循 mcpStrategy、allowlist、blocklist 与会话权限模式。
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-amber-900/90">
          返回作者模式路径：使用页面顶部“切回作者模式”；切回后 MCP Server 管理和原始工具注册表会从侧边栏与命令面板隐藏。
        </CardContent>
      </Card>

      {editorMode === "import" && (
        <Card className="border-dashed bg-muted/20">
          <CardHeader>
            <CardTitle>导入 MCP JSON</CardTitle>
            <CardDescription>支持粘贴 {"{ mcpServers: [...] }"}、Server 数组或单个 Server 配置，保存后逐个写入现有 MCP API。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="mcp-import-json">MCP JSON</Label>
              <textarea
                id="mcp-import-json"
                aria-label="MCP JSON"
                value={importJson}
                onChange={(event) => setImportJson(event.target.value)}
                className="min-h-40 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono"
                placeholder='{"mcpServers":[{"name":"memory","transport":"stdio","command":"npx","args":["-y","@modelcontextprotocol/server-memory"]}]}'
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={() => void handleImportJson()}>保存导入</Button>
              <Button variant="outline" onClick={closeEditor}>取消</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {(editorMode === "create" || editorMode === "edit") && (
        <Card className="border-dashed bg-muted/20">
          <CardHeader>
            <CardTitle>{editorMode === "edit" ? "编辑 MCP Server" : "添加 MCP Server"}</CardTitle>
            <CardDescription>
              {editorMode === "edit" ? "修改 transport、命令/URL 与环境变量。保存后需要重新连接。" : "添加本地 stdio 或远程 SSE MCP 服务。"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="mcp-server-name">名称</Label>
                <Input id="mcp-server-name" aria-label="名称" value={formData.name} onChange={(event) => setFormData((current) => ({ ...current, name: event.target.value }))} placeholder="my-mcp-server" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mcp-server-transport">传输方式</Label>
                <select
                  id="mcp-server-transport"
                  aria-label="传输方式"
                  value={formData.transport}
                  onChange={(event) => setFormData((current) => ({ ...current, transport: event.target.value as "stdio" | "sse" }))}
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                >
                  <option value="stdio">stdio（本地进程）</option>
                  <option value="sse">SSE（远程 HTTP）</option>
                </select>
              </div>
            </div>

            {formData.transport === "stdio" ? (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="mcp-server-command">命令</Label>
                  <Input id="mcp-server-command" aria-label="命令" value={formData.command} onChange={(event) => setFormData((current) => ({ ...current, command: event.target.value }))} placeholder="npx" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="mcp-server-args">参数（逗号分隔）</Label>
                  <Input id="mcp-server-args" aria-label="参数（逗号分隔）" value={formData.args} onChange={(event) => setFormData((current) => ({ ...current, args: event.target.value }))} placeholder="-y, @modelcontextprotocol/server-filesystem, ." />
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="mcp-server-url">URL</Label>
                <Input id="mcp-server-url" aria-label="URL" value={formData.url} onChange={(event) => setFormData((current) => ({ ...current, url: event.target.value }))} placeholder="http://localhost:3001/sse" />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="mcp-server-env">环境变量（JSON）</Label>
              <textarea
                id="mcp-server-env"
                aria-label="环境变量（JSON）"
                value={formData.env}
                onChange={(event) => setFormData((current) => ({ ...current, env: event.target.value }))}
                className="min-h-28 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                placeholder='{"API_KEY": "xxx"}'
              />
            </div>

            <div className="flex gap-2">
              <Button onClick={() => void handleSave()}>{editorMode === "edit" ? "保存修改" : "添加"}</Button>
              <Button variant="outline" onClick={closeEditor}>取消</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {servers.length === 0 ? (
        <PageEmptyState
          title="暂无 MCP Server"
          description="点击右上角添加，接入本地或远程 MCP 工具服务。"
          action={
            <Button onClick={openCreateForm}>
              <Plus className="size-4" />
              添加 Server
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4">
          {servers.map((server) => (
            <Card key={server.id}>
              <CardHeader className="gap-3 md:flex-row md:items-start md:justify-between">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="text-lg">{server.name}</CardTitle>
                    <Badge variant="outline">{server.transport.toUpperCase()}</Badge>
                    <Badge variant={server.status === "connected" ? "secondary" : "outline"}>{server.status}</Badge>
                    <Badge variant="outline">{server.toolCount} 个工具</Badge>
                  </div>
                  <CardDescription>
                    {server.transport === "sse" ? server.url : `${server.command ?? ""} ${(server.args ?? []).join(" ")}`}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => openEditForm(server)}>
                    <Pencil className="size-4" />
                    编辑
                  </Button>
                  {server.status === "disconnected" || server.status === "failed" ? (
                    <Button onClick={() => void handleStart(server.id)}>
                      <Play className="size-4" />
                      {server.status === "failed" ? "重连" : "连接"}
                    </Button>
                  ) : (
                    <Button variant="secondary" onClick={() => void handleStop(server.id)}>
                      <Square className="size-4" />
                      断开
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => void handleDelete(server.id)}>
                    <Trash2 className="size-4" />
                    删除
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-[minmax(0,1fr)_240px]">
                <div className="space-y-3">
                  {server.error && (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                      {server.error}
                    </div>
                  )}
                  <div className="rounded-xl border border-border/70 p-3">
                    <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      <Wrench className="size-3.5" />
                      工具注册表
                    </div>
                    <div className="space-y-2">
                      {server.tools.length > 0 ? (
                        server.tools.map((tool) => (
                          <div key={tool.name} className="rounded-lg bg-muted/40 p-2 text-xs">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-foreground">{tool.name}</span>
                              {tool.access ? (
                                <Badge variant={tool.access === "allow" ? "secondary" : tool.access === "prompt" ? "outline" : "destructive"}>
                                  {tool.access}
                                </Badge>
                              ) : null}
                            </div>
                            <div className="mt-1 text-muted-foreground">— {tool.description}</div>
                            {tool.source ? <div className="mt-1 text-muted-foreground">来源：{tool.source}</div> : null}
                            {(tool.reasonKey || tool.reason) ? (
                              <div className="mt-1 text-muted-foreground">治理解释：{describeToolAccessReason(tool.reasonKey, tool.reason)}</div>
                            ) : null}
                            {tool.reason ? <div className="mt-1 text-muted-foreground">原因：{tool.reason}</div> : null}
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground">尚未发现工具；连接后会把已发现工具汇总到这里。</p>
                      )}
                    </div>
                  </div>
                </div>
                <div className="rounded-xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
                  <div className="mb-3 flex items-center gap-2 text-foreground">
                    <Server className="size-4 text-primary" />
                    注册表摘要
                  </div>
                  <ul className="space-y-2">
                    <li>传输方式：{server.transport.toUpperCase()}</li>
                    <li>连接状态：{renderStatusLabel(server.status)}</li>
                    <li>已发现工具：{server.toolCount}</li>
                    <li>连接入口：{server.transport === "sse" ? (server.url ?? "未配置") : (server.command ?? "未配置")}</li>
                    <li>调用执行链：遵循 Settings 的重试 / trace / dump 配置</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryCard({ title, value, description }: { title: string; value: string; description: string }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-3xl">{value}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 text-xs text-muted-foreground">{description}</CardContent>
    </Card>
  );
}
