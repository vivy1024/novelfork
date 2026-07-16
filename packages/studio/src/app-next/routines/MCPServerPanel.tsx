import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Cable,
  CircleStop,
  FlaskConical,
  Pencil,
  PlugZap,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  Upload,
  Wrench,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SimpleSelect } from "@/components/ui/simple-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import {
  createMcpClient,
  type McpBehavior,
  type McpExternalTool,
  type McpServerInput,
  type McpServerPatch,
  type McpServerStatus,
  type McpTestResult,
  type McpTransport,
} from "../runtime-admin";
import {
  createRuntimeProductClient,
  type RuntimeBookMcpServerOverride,
} from "../runtime/product-contract";

const mcpClient = createMcpClient();
const productClient = createRuntimeProductClient();

interface ServerFormState {
  name: string;
  transport: McpTransport;
  command: string;
  args: string;
  cwd: string;
  env: string;
  url: string;
  headers: string;
  enabled: boolean;
  defaultBehavior: McpBehavior | "inherit";
}

const EMPTY_FORM: ServerFormState = {
  name: "",
  transport: "stdio",
  command: "",
  args: "",
  cwd: "",
  env: "",
  url: "",
  headers: "",
  enabled: true,
  defaultBehavior: "inherit",
};

function toForm(server?: McpServerStatus): ServerFormState {
  if (!server) return EMPTY_FORM;
  return {
    name: server.name,
    transport: server.transport,
    command: server.command ?? "",
    args: (server.args ?? []).join("\n"),
    cwd: server.cwd ?? "",
    env: server.env ? JSON.stringify(server.env, null, 2) : "",
    url: server.url ?? "",
    headers: server.headers ? JSON.stringify(server.headers, null, 2) : "",
    enabled: server.enabled,
    defaultBehavior: server.defaultBehavior ?? "inherit",
  };
}

function parseStringRecord(value: string, label: string): Readonly<Record<string, string>> | undefined {
  if (!value.trim()) return undefined;
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${label} 必须是 JSON 对象。`);
  }
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(parsed)) {
    if (typeof item !== "string") throw new Error(`${label} 的值必须是字符串。`);
    result[key] = item;
  }
  return result;
}

function toInput(form: ServerFormState): McpServerInput {
  const remote = form.transport !== "stdio";
  return {
    name: form.name.trim(),
    transport: form.transport,
    command: remote ? undefined : form.command.trim(),
    args: remote ? undefined : form.args.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean),
    cwd: remote || !form.cwd.trim() ? undefined : form.cwd.trim(),
    env: parseStringRecord(form.env, "环境变量"),
    url: remote ? form.url.trim() : undefined,
    headers: remote ? parseStringRecord(form.headers, "请求头") : undefined,
    enabled: form.enabled,
    defaultBehavior: form.defaultBehavior === "inherit" ? undefined : form.defaultBehavior,
  };
}

function toPatch(form: ServerFormState): McpServerPatch {
  return {
    ...toInput(form),
    defaultBehavior: form.defaultBehavior === "inherit" ? null : form.defaultBehavior,
  };
}

function errorMessage(error: unknown): string {
  const status = typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status?: unknown }).status)
    : undefined;
  const message = error instanceof Error ? error.message : String(error);
  return status ? `${status} — ${message}` : message;
}

function statusLabel(status: McpServerStatus["status"]): string {
  if (status === "connected") return "已连接";
  if (status === "connecting") return "连接中";
  if (status === "error") return "错误";
  return "未连接";
}

function behaviorLabel(behavior: McpBehavior | undefined): string {
  if (behavior === "readOnly") return "只读";
  if (behavior === "readWrite") return "读写";
  if (behavior === "ask") return "询问";
  if (behavior === "deny") return "拒绝";
  return "Runtime 默认设置";
}

export function MCPServerPanel({
  bookId,
  bookTitle,
}: {
  readonly bookId?: string;
  readonly bookTitle?: string;
}) {
  const [servers, setServers] = useState<readonly McpServerStatus[]>([]);
  const [tools, setTools] = useState<readonly McpExternalTool[]>([]);
  const [bookOverrides, setBookOverrides] = useState<readonly RuntimeBookMcpServerOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [editor, setEditor] = useState<
    { mode: "create" } | { mode: "edit"; id: string } | null
  >(null);
  const [form, setForm] = useState<ServerFormState>(EMPTY_FORM);
  const [testResult, setTestResult] = useState<McpTestResult | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importJson, setImportJson] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [serverResult, toolResult, bookResult] = await Promise.all([
        mcpClient.list(),
        mcpClient.tools(),
        bookId ? productClient.listBookMcpOverrides(bookId) : Promise.resolve({ serverOverrides: [] }),
      ]);
      setServers(serverResult.servers);
      setTools(toolResult.tools);
      setBookOverrides(bookResult.serverOverrides);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [bookId]);

  useEffect(() => {
    void load();
  }, [load]);

  const connectedCount = useMemo(
    () => servers.filter((server) => server.status === "connected").length,
    [servers],
  );
  const bookOverrideByServer = useMemo(
    () => new Map(bookOverrides.map((override) => [override.serverId, override] as const)),
    [bookOverrides],
  );

  function openCreate() {
    setForm(EMPTY_FORM);
    setTestResult(null);
    setEditor({ mode: "create" });
  }

  function openEdit(server: McpServerStatus) {
    setForm(toForm(server));
    setTestResult(null);
    setEditor({ mode: "edit", id: server.id });
  }

  async function saveServer() {
    if (!editor) return;
    setPendingId(editor.mode === "edit" ? editor.id : "create");
    setError(null);
    try {
      if (editor.mode === "create") await mcpClient.create(toInput(form));
      else await mcpClient.patch(editor.id, toPatch(form));
      setEditor(null);
      setForm(EMPTY_FORM);
      setTestResult(null);
      await load();
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setPendingId(null);
    }
  }

  async function testServer() {
    setPendingId(editor?.mode === "edit" ? editor.id : "test");
    setError(null);
    setTestResult(null);
    try {
      setTestResult(await mcpClient.test(toInput(form)));
    } catch (testError) {
      setError(errorMessage(testError));
    } finally {
      setPendingId(null);
    }
  }

  async function connect(server: McpServerStatus) {
    setPendingId(server.id);
    setError(null);
    try {
      await mcpClient.connect(server.id);
      await load();
    } catch (connectError) {
      setError(errorMessage(connectError));
    } finally {
      setPendingId(null);
    }
  }

  async function disconnect(server: McpServerStatus) {
    setPendingId(server.id);
    setError(null);
    try {
      await mcpClient.disconnect(server.id);
      await load();
    } catch (disconnectError) {
      setError(errorMessage(disconnectError));
    } finally {
      setPendingId(null);
    }
  }

  async function toggleEnabled(server: McpServerStatus, enabled: boolean) {
    setPendingId(server.id);
    setError(null);
    try {
      await mcpClient.patch(server.id, { enabled });
      await load();
    } catch (patchError) {
      setError(errorMessage(patchError));
    } finally {
      setPendingId(null);
    }
  }

  async function updateToolBehavior(
    server: McpServerStatus,
    toolName: string,
    behavior: McpBehavior | "inherit",
  ) {
    const pendingKey = `tool:${server.id}:${toolName}`;
    setPendingId(pendingKey);
    setError(null);
    try {
      await mcpClient.patch(server.id, {
        toolPermissionPatch: {
          toolName,
          behavior: behavior === "inherit" ? null : behavior,
        },
      });
      await load();
    } catch (patchError) {
      setError(errorMessage(patchError));
    } finally {
      setPendingId(null);
    }
  }

  async function updateBookServerBehavior(
    server: McpServerStatus,
    behavior: McpBehavior | "inherit",
  ) {
    if (!bookId) return;
    const pendingKey = `book-server:${server.id}`;
    setPendingId(pendingKey);
    setError(null);
    try {
      const result = await productClient.putBookMcpOverride(bookId, server.id, {
        defaultBehavior: behavior === "inherit" ? null : behavior,
      });
      setBookOverrides(result.serverOverrides);
    } catch (patchError) {
      setError(errorMessage(patchError));
    } finally {
      setPendingId(null);
    }
  }

  async function updateBookToolBehavior(
    server: McpServerStatus,
    toolName: string,
    behavior: McpBehavior | "inherit",
  ) {
    if (!bookId) return;
    const pendingKey = `book-tool:${server.id}:${toolName}`;
    setPendingId(pendingKey);
    setError(null);
    try {
      const result = await productClient.putBookMcpOverride(bookId, server.id, {
        toolPermissionPatch: {
          toolName,
          behavior: behavior === "inherit" ? null : behavior,
        },
      });
      setBookOverrides(result.serverOverrides);
    } catch (patchError) {
      setError(errorMessage(patchError));
    } finally {
      setPendingId(null);
    }
  }

  async function deleteServer() {
    if (!deleteId) return;
    setPendingId(deleteId);
    setError(null);
    try {
      await mcpClient.delete(deleteId);
      setDeleteId(null);
      await load();
    } catch (deleteError) {
      setError(errorMessage(deleteError));
    } finally {
      setPendingId(null);
    }
  }

  async function importServers() {
    setPendingId("import");
    setError(null);
    try {
      const parsed = JSON.parse(importJson) as unknown;
      await mcpClient.import(parsed);
      setImportOpen(false);
      setImportJson("");
      await load();
    } catch (importError) {
      setError(errorMessage(importError));
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">MCP 服务器</h2>
          <p className="text-sm text-muted-foreground">
            使用原生 Runtime MCP 客户端管理 stdio、streamable-http 和 SSE 传输的服务器生命周期。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw data-icon="inline-start" />
            刷新
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => { setImportJson(""); setImportOpen(true); }}>
            <Upload data-icon="inline-start" />
            导入 JSON
          </Button>
          <Button type="button" size="sm" onClick={openCreate}>
            <Plus data-icon="inline-start" />
            添加服务器
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard label="已注册服务器" value={servers.length} />
        <SummaryCard label="已连接服务器" value={connectedCount} />
        <SummaryCard label="外部工具" value={tools.length} />
      </div>

      <Alert>
        <AlertTitle>连接说明</AlertTitle>
        <AlertDescription>
          连接和断开操作使用原生 Runtime 生命周期接口；测试操作只验证草稿，不会保存配置。
        </AlertDescription>
      </Alert>
      {error && (
        <Alert>
          <AlertTitle>MCP 请求失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {[0, 1].map((item) => (
            <Card key={item}>
              <CardHeader><Skeleton className="h-5 w-40" /><Skeleton className="h-4 w-full" /></CardHeader>
              <CardContent><Skeleton className="h-28 w-full" /></CardContent>
            </Card>
          ))}
        </div>
      ) : servers.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Server /></EmptyMedia>
            <EmptyTitle>暂无 MCP 服务器</EmptyTitle>
            <EmptyDescription>添加或导入 Runtime MCP 服务器。</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button type="button" onClick={openCreate}><Plus data-icon="inline-start" />添加服务器</Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="grid gap-3">
          {servers.map((server) => (
            <Card key={server.id}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {server.name}
                  <Badge variant="outline">{server.transport}</Badge>
                  <Badge variant={server.status === "connected" ? "secondary" : server.status === "error" ? "destructive" : "outline"}>
                    {statusLabel(server.status)}
                  </Badge>
                </CardTitle>
                <CardDescription>
                  {server.transport === "stdio"
                    ? [server.command, ...(server.args ?? [])].filter(Boolean).join(" ")
                    : server.url}
                </CardDescription>
                <CardAction>
                  <Switch
                    aria-label={`启用 MCP 服务器：${server.name}`}
                    checked={server.enabled}
                    disabled={pendingId === server.id}
                    onCheckedChange={(enabled) => void toggleEnabled(server, enabled)}
                  />
                </CardAction>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {server.error && (
                  <Alert><AlertTitle>服务器错误</AlertTitle><AlertDescription>{server.error}</AlertDescription></Alert>
                )}
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">{behaviorLabel(server.defaultBehavior)}</Badge>
                  <Badge variant="outline">{server.tools.length} 个工具</Badge>
                  {server.cwd && <Badge variant="outline">工作目录 {server.cwd}</Badge>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => openEdit(server)}>
                    <Pencil data-icon="inline-start" />
                    编辑
                  </Button>
                  {server.status === "connected" ? (
                    <Button type="button" variant="secondary" size="sm" disabled={pendingId === server.id} onClick={() => void disconnect(server)}>
                      <CircleStop data-icon="inline-start" />
                      断开
                    </Button>
                  ) : (
                    <Button type="button" size="sm" disabled={pendingId === server.id} onClick={() => void connect(server)}>
                      <Cable data-icon="inline-start" />
                      连接
                    </Button>
                  )}
                  <Button type="button" variant="destructive" size="sm" onClick={() => setDeleteId(server.id)}>
                    <Trash2 data-icon="inline-start" />
                    删除
                  </Button>
                </div>
                <div className="flex flex-col gap-2 rounded-lg border p-3">
                  <div className="flex items-center gap-2 font-medium"><Wrench />已发现工具</div>
                  {server.tools.length === 0 ? (
                    <p className="text-sm text-muted-foreground">尚未发现工具。连接或测试服务器后可刷新发现结果。</p>
                  ) : server.tools.map((tool) => {
                    const permission = server.toolPermissions?.find((item) => item.toolName === tool.name);
                    const behavior = permission?.enabled === false
                      ? "inherit"
                      : permission?.behavior ?? "inherit";
                    const pendingKey = `tool:${server.id}:${tool.name}`;
                    return (
                      <div
                        key={tool.name}
                        className="grid gap-3 rounded-lg bg-muted p-3 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-center"
                      >
                        <div className="flex min-w-0 flex-col gap-1">
                          <div className="truncate font-mono text-xs">{tool.name}</div>
                          {tool.description && (
                            <div className="text-xs text-muted-foreground">{tool.description}</div>
                          )}
                        </div>
                        <SimpleSelect
                          aria-label={`工具权限：${server.name}/${tool.name}`}
                          value={behavior}
                          disabled={pendingId === pendingKey}
                          onValueChange={(value) => void updateToolBehavior(
                            server,
                            tool.name,
                            value as McpBehavior | "inherit",
                          )}
                          options={[
                            { value: "inherit", label: "继承服务器设置" },
                            { value: "readOnly", label: "只读" },
                            { value: "readWrite", label: "读写" },
                            { value: "ask", label: "询问" },
                            { value: "deny", label: "拒绝" },
                          ]}
                        />
                      </div>
                    );
                  })}
                </div>
                {bookId && (
                  <BookMcpOverridePanel
                    bookTitle={bookTitle}
                    server={server}
                    override={bookOverrideByServer.get(server.id)}
                    pendingId={pendingId}
                    onServerBehaviorChange={(behavior) => void updateBookServerBehavior(server, behavior)}
                    onToolBehaviorChange={(toolName, behavior) => void updateBookToolBehavior(server, toolName, behavior)}
                  />
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Runtime MCP 工具注册表</CardTitle>
          <CardDescription>由原生 Runtime MCP 工具客户端返回的工具。</CardDescription>
        </CardHeader>
        <CardContent>
          {tools.length === 0 ? (
            <p className="text-sm text-muted-foreground">当前未注册外部 MCP 工具。</p>
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              {tools.map((tool) => (
                <div key={`${tool.serverId}:${tool.name}`} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs">{tool.name}</span>
                    <Badge variant="outline">{tool.serverName}</Badge>
                  </div>
                  {tool.description && <p className="mt-1 text-xs text-muted-foreground">{tool.description}</p>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ServerEditorDialog
        open={editor !== null}
        mode={editor?.mode ?? "create"}
        form={form}
        testResult={testResult}
        pending={editor !== null && pendingId !== null}
        onFormChange={setForm}
        onOpenChange={(open) => { if (!open) { setEditor(null); setForm(EMPTY_FORM); setTestResult(null); } }}
        onTest={() => void testServer()}
        onSave={() => void saveServer()}
      />

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>导入 MCP JSON</DialogTitle>
            <DialogDescription>解析后的 JSON 将通过 Runtime MCP 导入客户端一次性提交。</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="mcp-import-json">MCP JSON</Label>
            <Textarea
              id="mcp-import-json"
              className="min-h-72 font-mono"
              value={importJson}
              onChange={(event) => setImportJson(event.target.value)}
              placeholder='{"mcpServers":{"memory":{"transport":"stdio","command":"npx","args":["-y","@modelcontextprotocol/server-memory"]}}}'
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setImportOpen(false)}>取消</Button>
            <Button type="button" disabled={pendingId === "import" || !importJson.trim()} onClick={() => void importServers()}>
              {pendingId === "import" ? "导入中…" : "导入"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteId !== null} onOpenChange={(open) => { if (!open) setDeleteId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除 MCP 服务器</DialogTitle>
            <DialogDescription>确定通过原生 Runtime MCP 客户端删除此服务器吗？</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteId(null)}>取消</Button>
            <Button type="button" variant="destructive" disabled={deleteId !== null && pendingId === deleteId} onClick={() => void deleteServer()}>
              {deleteId !== null && pendingId === deleteId ? "删除中…" : "删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BookMcpOverridePanel({
  bookTitle,
  server,
  override,
  pendingId,
  onServerBehaviorChange,
  onToolBehaviorChange,
}: {
  readonly bookTitle?: string;
  readonly server: McpServerStatus;
  readonly override?: RuntimeBookMcpServerOverride;
  readonly pendingId: string | null;
  readonly onServerBehaviorChange: (behavior: McpBehavior | "inherit") => void;
  readonly onToolBehaviorChange: (toolName: string, behavior: McpBehavior | "inherit") => void;
}) {
  const serverBehavior = override?.defaultBehavior ?? "inherit";
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
      <div>
        <div className="font-medium">作品权限覆盖{bookTitle ? ` · ${bookTitle}` : ""}</div>
        <p className="text-xs text-muted-foreground">
          仅影响当前作品。选择继承会向 Runtime 发送 null，并真实删除对应作品 override。
        </p>
      </div>
      <div className="grid gap-3 rounded-lg bg-background p-3 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-center">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">服务器默认行为</span>
          <span className="text-xs text-muted-foreground">全局当前值：{behaviorLabel(server.defaultBehavior)}</span>
        </div>
        <SimpleSelect
          aria-label={`作品服务器权限：${server.name}`}
          value={serverBehavior}
          disabled={pendingId === `book-server:${server.id}`}
          onValueChange={(value) => onServerBehaviorChange(value as McpBehavior | "inherit")}
          options={[
            { value: "inherit", label: "继承全局设置" },
            { value: "readOnly", label: "只读" },
            { value: "readWrite", label: "读写" },
            { value: "ask", label: "询问" },
            { value: "deny", label: "拒绝" },
          ]}
        />
      </div>
      {server.tools.length > 0 && (
        <div className="flex flex-col gap-2">
          {server.tools.map((tool) => {
            const permission = override?.toolPermissions?.find((item) => item.toolName === tool.name);
            const behavior = permission?.enabled === false
              ? "inherit"
              : permission?.behavior ?? "inherit";
            const pendingKey = `book-tool:${server.id}:${tool.name}`;
            return (
              <div
                key={tool.name}
                className="grid gap-3 rounded-lg bg-background p-3 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-center"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="truncate font-mono text-xs">{tool.name}</span>
                  <span className="text-xs text-muted-foreground">
                    继承时使用作品服务器覆盖；若作品也未覆盖，则使用全局逐工具或服务器设置。
                  </span>
                </div>
                <SimpleSelect
                  aria-label={`作品工具权限：${server.name}/${tool.name}`}
                  value={behavior}
                  disabled={pendingId === pendingKey}
                  onValueChange={(value) => onToolBehaviorChange(
                    tool.name,
                    value as McpBehavior | "inherit",
                  )}
                  options={[
                    { value: "inherit", label: "继承上层设置" },
                    { value: "readOnly", label: "只读" },
                    { value: "readWrite", label: "读写" },
                    { value: "ask", label: "询问" },
                    { value: "deny", label: "拒绝" },
                  ]}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ServerEditorDialog({
  open,
  mode,
  form,
  testResult,
  pending,
  onFormChange,
  onOpenChange,
  onTest,
  onSave,
}: {
  readonly open: boolean;
  readonly mode: "create" | "edit";
  readonly form: ServerFormState;
  readonly testResult: McpTestResult | null;
  readonly pending: boolean;
  readonly onFormChange: (form: ServerFormState) => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly onTest: () => void;
  readonly onSave: () => void;
}) {
  const remote = form.transport !== "stdio";
  const validTarget = remote ? form.url.trim() : form.command.trim();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "添加 MCP 服务器" : "编辑 MCP 服务器"}</DialogTitle>
          <DialogDescription>配置原生 Runtime MCP 服务器，并可在保存前测试草稿。</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="mcp-server-name">名称</Label>
              <Input id="mcp-server-name" value={form.name} onChange={(event) => onFormChange({ ...form, name: event.target.value })} />
            </div>
            <div className="flex flex-col gap-2">
              <Label>传输方式</Label>
              <SimpleSelect
                aria-label="MCP 传输方式"
                value={form.transport}
                onValueChange={(value) => onFormChange({ ...form, transport: value as McpTransport })}
                options={[
                  { value: "stdio", label: "stdio" },
                  { value: "streamable-http", label: "streamable-http" },
                  { value: "sse", label: "sse" },
                ]}
              />
            </div>
          </div>
          {remote ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="mcp-server-url">URL</Label>
              <Input id="mcp-server-url" value={form.url} onChange={(event) => onFormChange({ ...form, url: event.target.value })} placeholder="https://example.com/mcp" />
            </div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="mcp-server-command">命令</Label>
                  <Input id="mcp-server-command" value={form.command} onChange={(event) => onFormChange({ ...form, command: event.target.value })} placeholder="npx" />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="mcp-server-cwd">工作目录</Label>
                  <Input id="mcp-server-cwd" value={form.cwd} onChange={(event) => onFormChange({ ...form, cwd: event.target.value })} />
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="mcp-server-args">参数（每行一个或使用逗号分隔）</Label>
                <Textarea id="mcp-server-args" className="min-h-24 font-mono" value={form.args} onChange={(event) => onFormChange({ ...form, args: event.target.value })} />
              </div>
            </>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="mcp-server-env">环境变量 JSON</Label>
              <Textarea id="mcp-server-env" className="min-h-28 font-mono" value={form.env} onChange={(event) => onFormChange({ ...form, env: event.target.value })} placeholder='{"API_KEY":"…"}' />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="mcp-server-headers">请求头 JSON</Label>
              <Textarea id="mcp-server-headers" disabled={!remote} className="min-h-28 font-mono" value={form.headers} onChange={(event) => onFormChange({ ...form, headers: event.target.value })} placeholder='{"Authorization":"Bearer …"}' />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label>默认工具行为</Label>
              <SimpleSelect
                aria-label="默认工具行为"
                value={form.defaultBehavior}
                onValueChange={(value) => onFormChange({ ...form, defaultBehavior: value as ServerFormState["defaultBehavior"] })}
                options={[
                  { value: "inherit", label: "Runtime 默认设置" },
                  { value: "readOnly", label: "只读" },
                  { value: "readWrite", label: "读写" },
                  { value: "ask", label: "询问" },
                  { value: "deny", label: "拒绝" },
                ]}
              />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <Label>已启用</Label>
              <Switch aria-label="MCP 服务器已启用" checked={form.enabled} onCheckedChange={(enabled) => onFormChange({ ...form, enabled })} />
            </div>
          </div>
          {testResult && (
            <Alert>
              <AlertTitle>{testResult.ok ? "连接测试成功" : "连接测试失败"}</AlertTitle>
              <AlertDescription>
                {testResult.ok ? `${testResult.tools?.length ?? 0} 个工具已发现。` : testResult.error ?? "Runtime 返回了失败的测试结果。"}
              </AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button type="button" variant="secondary" disabled={pending || !validTarget} onClick={onTest}>
            <FlaskConical data-icon="inline-start" />
            测试
          </Button>
          <Button type="button" disabled={pending || !form.name.trim() || !validTarget} onClick={onSave}>
            <PlugZap data-icon="inline-start" />
            {pending ? "保存中…" : mode === "create" ? "添加服务器" : "保存修改"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SummaryCard({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
