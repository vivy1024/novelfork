import { useCallback, useEffect, useState } from "react";
import { Clipboard, Laptop, Pencil, PlugZap, Plus, RefreshCw, Send, Stethoscope, Trash2 } from "lucide-react";

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
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  createDevicesClient,
  type CreateRuntimeDeviceInput,
  type DeviceConnectionDiagnostics,
  type DeviceConnectionMode,
  type DeviceConnectionTestResult,
  type DeviceScope,
  type DeviceTransferInput,
  type DevicesClient,
  type RuntimeDevice,
  type RuntimeProjectOption,
  type UpdateRuntimeDeviceInput,
} from "../../runtime-admin/devices";

const defaultDevicesClient = createDevicesClient();

/** Chinese labels for the Runtime handshake stages, so a stalled connection is readable. */
const STAGE_LABELS: Readonly<Record<string, string>> = {
  ready: "已就绪",
  rpc_ready: "RPC 可用",
  rpc_failed: "RPC 调用失败",
  waiting_for_executor: "等待执行器接入",
  idle: "未发起连接",
  connecting: "正在建立连接",
  waiting_auth_init: "等待认证初始化",
  authenticating: "正在认证",
  waiting_hello: "等待 hello 帧",
  reconnect_wait: "等待重连",
  offline: "离线",
};

const SOCKET_STATE_LABELS: Readonly<Record<string, string>> = {
  connecting: "connecting（正在握手）",
  open: "open（已打开）",
  closing: "closing（正在关闭）",
  closed: "closed（已关闭）",
};

function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] ? `${STAGE_LABELS[stage]}（${stage}）` : stage;
}

interface VisibleToken {
  readonly name: string;
  readonly slug: string;
  readonly token: string;
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export interface DevicesPanelProps {
  readonly client?: DevicesClient;
  readonly refreshIntervalMs?: number;
}

export function DevicesPanel({ client = defaultDevicesClient, refreshIntervalMs = 10_000 }: DevicesPanelProps) {
  const [devices, setDevices] = useState<ReadonlyArray<RuntimeDevice> | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [issuedToken, setIssuedToken] = useState<VisibleToken | null>(null);
  const [editingDevice, setEditingDevice] = useState<RuntimeDevice | null>(null);
  const [rotatingDevice, setRotatingDevice] = useState<RuntimeDevice | null>(null);
  const [deletingDevice, setDeletingDevice] = useState<RuntimeDevice | null>(null);
  const [transferDevice, setTransferDevice] = useState<RuntimeDevice | null>(null);
  const [diagnostics, setDiagnostics] = useState<Readonly<Record<string, DeviceConnectionDiagnostics>>>({});
  const [testResults, setTestResults] = useState<Readonly<Record<string, DeviceConnectionTestResult>>>({});
  const [probingDevice, setProbingDevice] = useState<string | null>(null);
  const [projects, setProjects] = useState<readonly RuntimeProjectOption[]>([]);

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      setDevices(await client.listDevices());
      setError(null);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  // Project options let a project-scoped device be bound by name instead of by a
  // hand-typed id. A failure is non-fatal: the dialog falls back to text input.
  useEffect(() => {
    let active = true;
    client.listProjects()
      .then((rows) => {
        if (active && Array.isArray(rows)) setProjects(rows);
      })
      .catch(() => {
        // Fallback to manual id entry.
      });
    return () => { active = false; };
  }, [client]);

  useEffect(() => {
    if (refreshIntervalMs <= 0) return;
    const interval = window.setInterval(() => void load(false), refreshIntervalMs);
    return () => window.clearInterval(interval);
  }, [load, refreshIntervalMs]);

  async function createDevice(input: CreateRuntimeDeviceInput) {
    setBusyAction("create");
    setError(null);
    setNotice(null);
    try {
      const result = await client.createDevice(input);
      setDevices((current) => current ? [...current, result.device] : [result.device]);
      setCreateOpen(false);
      setIssuedToken({ name: result.device.name, slug: result.device.slug, token: result.token });
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusyAction(null);
    }
  }

  async function updateDevice(input: UpdateRuntimeDeviceInput) {
    if (!editingDevice) return;
    setBusyAction("edit");
    setError(null);
    setNotice(null);
    try {
      const updated = await client.updateDevice(editingDevice.id, input);
      setDevices((current) => current?.map((device) => device.id === updated.id ? updated : device) ?? current);
      setEditingDevice(null);
      setNotice(`设备“${updated.name}”已更新。`);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusyAction(null);
    }
  }

  async function rotateToken() {
    if (!rotatingDevice) return;
    setBusyAction("rotate");
    setError(null);
    setNotice(null);
    try {
      const result = await client.rotateToken(rotatingDevice.id);
      setIssuedToken({ name: rotatingDevice.name, slug: rotatingDevice.slug, token: result.token });
      setRotatingDevice(null);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusyAction(null);
    }
  }

  async function deleteDevice() {
    if (!deletingDevice) return;
    setBusyAction("delete");
    setError(null);
    setNotice(null);
    try {
      await client.deleteDevice(deletingDevice.id);
      setDevices((current) => current?.filter((device) => device.id !== deletingDevice.id) ?? current);
      setNotice(`设备“${deletingDevice.name}”已撤销。`);
      setDeletingDevice(null);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusyAction(null);
    }
  }

  async function transferFiles(input: DeviceTransferInput) {
    if (!transferDevice) return;
    setBusyAction("transfer");
    setError(null);
    setNotice(null);
    try {
      const result = await client.transferFiles(transferDevice.id, input);
      setNotice(`文件传输完成：${result.filesTransferred} 个文件，${formatBytes(result.bytesTransferred)}。`);
      setTransferDevice(null);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusyAction(null);
    }
  }

  /**
   * Probe the connection and keep the diagnostics.
   *
   * The Runtime's test endpoint dials a direct device before probing, so a
   * failure here is the only place an operator can see where the handshake
   * actually stopped and what the transport error was.
   */
  async function testConnection(device: RuntimeDevice) {
    setProbingDevice(device.id);
    setError(null);
    setNotice(null);
    try {
      const result = await client.testConnection(device.id);
      setTestResults((current) => ({ ...current, [device.id]: result }));
      setDiagnostics((current) => ({ ...current, [device.id]: result.diagnostics }));
      await load(false);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setProbingDevice(null);
    }
  }

  async function loadDiagnostics(device: RuntimeDevice) {
    setProbingDevice(device.id);
    setError(null);
    try {
      const result = await client.diagnostics(device.id);
      setDiagnostics((current) => ({ ...current, [device.id]: result }));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setProbingDevice(null);
    }
  }

  async function copyToken(token: string) {
    try {
      if (!navigator.clipboard) throw new Error("当前浏览器不允许访问剪贴板");
      await navigator.clipboard.writeText(token);
      setNotice("设备令牌已复制。请立即保存到安全位置。");
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4" aria-label="正在读取设备列表">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-36 w-full" />
      </div>
    );
  }  if (!devices) {
    return (
      <Alert>
        <AlertTitle>无法读取设备列表</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-3">
          <span>{error ?? "Runtime 未返回设备数据。"}</span>
          <Button variant="outline" size="sm" onClick={() => void load()}>重试</Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">设备管理</h2>
          <p className="text-sm text-muted-foreground">管理远程执行器设备、一次性令牌和真实文件传输。</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void load(false)}>
            <RefreshCw data-icon="inline-start" />刷新
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus data-icon="inline-start" />添加设备
          </Button>
        </div>
      </div>

      {error ? (
        <Alert>
          <AlertTitle>设备操作失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert>
          <AlertTitle>设备设置已更新</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      {devices.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><Laptop /></EmptyMedia>
            <EmptyTitle>尚未添加远程设备</EmptyTitle>
            <EmptyDescription>添加设备后，Runtime 会显示一次仅可见的连接令牌。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-4">
          {devices.map((device) => (
            <DeviceCard
              key={device.id}
              device={device}
              probing={probingDevice === device.id}
              diagnostics={diagnostics[device.id]}
              testResult={testResults[device.id]}
              onTest={() => void testConnection(device)}
              onDiagnostics={() => void loadDiagnostics(device)}
              onTransfer={() => setTransferDevice(device)}
              onEdit={() => setEditingDevice(device)}
              onRotate={() => setRotatingDevice(device)}
              onDelete={() => setDeletingDevice(device)}
            />
          ))}
        </div>
      )}

      <CreateDeviceDialog
        open={createOpen}
        busy={busyAction === "create"}
        projects={projects}
        onOpenChange={setCreateOpen}
        onSubmit={(input) => void createDevice(input)}
      />

      <TokenDialog issued={issuedToken} onClose={() => setIssuedToken(null)} onCopy={(token) => void copyToken(token)} />

      <EditDeviceDialog
        device={editingDevice}
        busy={busyAction === "edit"}
        projects={projects}
        onClose={() => setEditingDevice(null)}
        onSubmit={(input) => void updateDevice(input)}
      />

      <TransferDialog
        device={transferDevice}
        busy={busyAction === "transfer"}
        onClose={() => setTransferDevice(null)}
        onSubmit={(input) => void transferFiles(input)}
      />

      <Dialog open={rotatingDevice !== null} onOpenChange={(open) => { if (!open) setRotatingDevice(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>轮换设备令牌</DialogTitle>
            <DialogDescription>旧令牌会立即失效。“{rotatingDevice?.name ?? ""}”必须使用新令牌重新连接。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRotatingDevice(null)}>取消</Button>
            <Button disabled={busyAction === "rotate"} onClick={() => void rotateToken()}>
              {busyAction === "rotate" ? "正在轮换…" : "确认轮换"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deletingDevice !== null} onOpenChange={(open) => { if (!open) setDeletingDevice(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除设备</DialogTitle>
            <DialogDescription>撤销“{deletingDevice?.name ?? ""}”后，其令牌和远程执行权限会立即失效。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingDevice(null)}>取消</Button>
            <Button variant="destructive" disabled={busyAction === "delete"} onClick={() => void deleteDevice()}>
              {busyAction === "delete" ? "正在删除…" : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DeviceCard({
  device,
  probing,
  diagnostics,
  testResult,
  onTest,
  onDiagnostics,
  onTransfer,
  onEdit,
  onRotate,
  onDelete,
}: {
  readonly device: RuntimeDevice;
  readonly probing: boolean;
  readonly diagnostics?: DeviceConnectionDiagnostics;
  readonly testResult?: DeviceConnectionTestResult;
  readonly onTest: () => void;
  readonly onDiagnostics: () => void;
  readonly onTransfer: () => void;
  readonly onEdit: () => void;
  readonly onRotate: () => void;
  readonly onDelete: () => void;
}) {
  const platform = device.platformOs && device.platformArch
    ? `${device.platformOs}/${device.platformArch}`
    : "平台未知";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Laptop />
          {device.name}
          <Badge variant={device.status === "online" ? "default" : "secondary"}>
            {device.status === "online" ? "在线" : "离线"}
          </Badge>
          <Badge variant="outline">{device.connectionMode === "reverse" ? "反向连接" : "直接连接"}</Badge>
          <Badge variant="outline">
            {device.scope === "project" ? `项目：${device.projectId ?? "未绑定"}` : "全局"}
          </Badge>
        </CardTitle>
        <CardDescription>{device.description || "未填写设备说明"}</CardDescription>
        <CardAction>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" size="sm" disabled={probing} onClick={onTest}>
              <PlugZap data-icon="inline-start" />
              {probing ? "测试中…" : "测试连接"}
            </Button>
            <Button variant="outline" size="sm" disabled={probing} onClick={onDiagnostics}>
              <Stethoscope data-icon="inline-start" />诊断
            </Button>
            {device.status === "online" ? (
              <Button variant="outline" size="sm" onClick={onTransfer}>
                <Send data-icon="inline-start" />文件传输
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={onEdit}>
              <Pencil data-icon="inline-start" />编辑
            </Button>
            <Button variant="outline" size="sm" onClick={onRotate}>轮换令牌</Button>
            <Button variant="destructive" size="icon-sm" aria-label={`删除 ${device.name}`} onClick={onDelete}>
              <Trash2 />
            </Button>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
          <code className="rounded-md bg-muted px-2 py-1 text-foreground">{device.slug}</code>
          <span>{platform}</span>
          <span>令牌前缀：{device.tokenPrefix}…</span>
          {device.defaultCwd ? <span>默认目录：{device.defaultCwd}</span> : null}
          {device.agentVersion ? <span>执行器版本：{device.agentVersion}</span> : null}
        </div>
        {testResult ? (
          <div className="flex flex-wrap items-center gap-2 text-xs" role="status">
            <Badge variant={testResult.ok ? "default" : "destructive"}>
              {testResult.ok ? "连接测试通过" : "连接测试失败"}
            </Badge>
            <span className="text-muted-foreground">阶段：{stageLabel(testResult.stage)}</span>
            {testResult.latencyMs !== undefined ? (
              <span className="text-muted-foreground">耗时 {testResult.latencyMs} ms</span>
            ) : null}
            {testResult.message ? (
              <span className="min-w-0 break-words text-muted-foreground">{testResult.message}</span>
            ) : null}
          </div>
        ) : null}
        {diagnostics ? <DeviceDiagnosticsDetails diagnostics={diagnostics} /> : null}
      </CardContent>
    </Card>
  );
}

function DeviceDiagnosticsDetails({ diagnostics }: {
  readonly diagnostics: DeviceConnectionDiagnostics;
}) {
  const capabilityEntries = diagnostics.capabilities
    ? Object.entries(diagnostics.capabilities)
    : [];

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3 text-xs" data-slot="device-diagnostics">
      <p className="font-medium text-foreground">连接诊断</p>
      <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
        <span className="text-muted-foreground">握手阶段：{stageLabel(diagnostics.stage)}</span>
        <span className="text-muted-foreground">
          连接方式：{diagnostics.mode === "reverse" ? "反向连接" : "直接连接"}
          {diagnostics.online ? " · 在线" : " · 离线"}
        </span>
        {diagnostics.socketState ? (
          <span className="text-muted-foreground">
            Socket 状态：{SOCKET_STATE_LABELS[diagnostics.socketState] ?? diagnostics.socketState}
          </span>
        ) : null}
        {diagnostics.protocolVersion !== undefined ? (
          <span className="text-muted-foreground">协议版本：{diagnostics.protocolVersion}</span>
        ) : null}
        {diagnostics.agentVersion ? (
          <span className="text-muted-foreground">执行器版本：{diagnostics.agentVersion}</span>
        ) : null}
        {diagnostics.lastEventAt !== undefined ? (
          <span className="text-muted-foreground">
            最近事件：{new Date(diagnostics.lastEventAt).toLocaleString("zh-CN")}
          </span>
        ) : null}
        {diagnostics.directUrl ? (
          <span className="min-w-0 break-all text-muted-foreground">直连地址：{diagnostics.directUrl}</span>
        ) : null}
      </div>
      {diagnostics.lastError ? (
        <p className="break-words text-destructive">最近错误：{diagnostics.lastError}</p>
      ) : null}
      {capabilityEntries.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {capabilityEntries.map(([key, value]) => (
            <Badge key={key} variant="secondary" className="font-normal">
              {key}
              {typeof value === "boolean" ? (value ? "" : "：否") : `：${String(value)}`}
            </Badge>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground">执行器尚未上报能力集。</p>
      )}
    </div>
  );
}

/**
 * Bind a project-scoped device. A project list turns this into a pick-from-list
 * action; without the list (request failed, or the project predates it) the
 * operator can still type the id so an existing binding stays editable.
 */
function ProjectBindingField({ idPrefix, projects, value, onChange }: {
  readonly idPrefix: string;
  readonly projects: readonly RuntimeProjectOption[];
  readonly value: string;
  readonly onChange: (projectId: string) => void;
}) {
  const known = projects.some((project) => project.id === value);
  if (projects.length === 0) {
    return (
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-project-id`}>项目 ID</FieldLabel>
        <Input
          id={`${idPrefix}-project-id`}
          aria-label="项目 ID"
          value={value}
          placeholder="Runtime 项目标识"
          onChange={(event) => onChange(event.currentTarget.value)}
        />
        <FieldDescription>未能读取项目列表，请手动填写项目标识。</FieldDescription>
      </Field>
    );
  }
  return (
    <Field>
      <FieldLabel htmlFor={`${idPrefix}-project`}>绑定项目</FieldLabel>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={`${idPrefix}-project`} aria-label="绑定项目" className="w-full">
          <SelectValue placeholder="请选择项目" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>
            ))}
            {value && !known ? (
              <SelectItem value={value}>{value}（当前绑定，不在活跃项目列表中）</SelectItem>
            ) : null}
          </SelectGroup>
        </SelectContent>
      </Select>
      <FieldDescription>仅该项目内的叙述者可以使用此设备。</FieldDescription>
    </Field>
  );
}

function CreateDeviceDialog({
  open,
  busy,
  projects,
  onOpenChange,
  onSubmit,
}: {
  readonly open: boolean;
  readonly busy: boolean;
  readonly projects: readonly RuntimeProjectOption[];
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (input: CreateRuntimeDeviceInput) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [connectionMode, setConnectionMode] = useState<DeviceConnectionMode>("reverse");
  const [directUrl, setDirectUrl] = useState("");
  const [scope, setScope] = useState<DeviceScope>("global");
  const [projectId, setProjectId] = useState("");
  // A project-scoped device is only reachable from that project, so the binding
  // must be supplied at creation time rather than defaulted to global.
  const valid = Boolean(name.trim())
    && (connectionMode !== "direct" || Boolean(directUrl.trim()))
    && (scope !== "project" || Boolean(projectId.trim()));

  function submit() {
    if (!valid) return;
    onSubmit({
      name: name.trim(),
      description: description.trim() || undefined,
      connectionMode,
      directUrl: connectionMode === "direct" ? directUrl.trim() : undefined,
      scope,
      projectId: scope === "project" ? projectId.trim() : undefined,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>添加远程设备</DialogTitle>
          <DialogDescription>注册远程执行器，可选择全局可用或绑定到某个项目。创建后令牌只显示一次。</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="device-name">设备名称</FieldLabel>
            <Input id="device-name" aria-label="设备名称" value={name} onChange={(event) => setName(event.currentTarget.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="device-description">设备说明</FieldLabel>
            <Textarea id="device-description" aria-label="设备说明" value={description} onChange={(event) => setDescription(event.currentTarget.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="device-scope">作用域</FieldLabel>
            <Select value={scope} onValueChange={(value) => setScope(value as DeviceScope)}>
              <SelectTrigger id="device-scope" aria-label="作用域" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="global">全局（所有项目可用）</SelectItem>
                  <SelectItem value="project">仅指定项目</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          {scope === "project" ? (
            <ProjectBindingField
              idPrefix="device"
              projects={projects}
              value={projectId}
              onChange={setProjectId}
            />
          ) : null}
          <Field>
            <FieldLabel htmlFor="device-mode">连接方式</FieldLabel>
            <Select value={connectionMode} onValueChange={(value) => setConnectionMode(value as DeviceConnectionMode)}>
              <SelectTrigger id="device-mode" aria-label="连接方式" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="reverse">反向连接</SelectItem>
                  <SelectItem value="direct">直接连接</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldDescription>反向连接由执行器主动连接 Runtime；直接连接要求可访问的 WebSocket 地址。</FieldDescription>
          </Field>
          {connectionMode === "direct" ? (
            <Field>
              <FieldLabel htmlFor="device-direct-url">直接连接地址</FieldLabel>
              <Input id="device-direct-url" aria-label="直接连接地址" placeholder="ws://host:port/ws/device" value={directUrl} onChange={(event) => setDirectUrl(event.currentTarget.value)} />
            </Field>
          ) : null}
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button disabled={!valid || busy} onClick={submit}>{busy ? "正在创建…" : "创建设备"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditDeviceDialog({
  device,
  busy,
  projects,
  onClose,
  onSubmit,
}: {
  readonly device: RuntimeDevice | null;
  readonly busy: boolean;
  readonly projects: readonly RuntimeProjectOption[];
  readonly onClose: () => void;
  readonly onSubmit: (input: UpdateRuntimeDeviceInput) => void;
}) {
  const [name, setName] = useState(device?.name ?? "");
  const [description, setDescription] = useState(device?.description ?? "");
  const [connectionMode, setConnectionMode] = useState<DeviceConnectionMode>(device?.connectionMode ?? "reverse");
  const [directUrl, setDirectUrl] = useState(device?.directUrl ?? "");
  const [scope, setScope] = useState<DeviceScope>(device?.scope ?? "global");
  const [projectId, setProjectId] = useState(device?.projectId ?? "");

  useEffect(() => {
    if (!device) return;
    setName(device.name);
    setDescription(device.description ?? "");
    setConnectionMode(device.connectionMode);
    setDirectUrl(device.directUrl ?? "");
    setScope(device.scope);
    setProjectId(device.projectId ?? "");
  }, [device]);

  const valid = Boolean(name.trim())
    && (connectionMode !== "direct" || Boolean(directUrl.trim()))
    && (scope !== "project" || Boolean(projectId.trim()));
  return (
    <Dialog open={device !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>编辑设备</DialogTitle>
          <DialogDescription>更新设备元数据、作用域与连接方式；设备令牌不会回显。</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="edit-device-name">设备名称</FieldLabel>
            <Input id="edit-device-name" aria-label="设备名称" value={name} onChange={(event) => setName(event.currentTarget.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="edit-device-description">设备说明</FieldLabel>
            <Textarea id="edit-device-description" aria-label="设备说明" value={description} onChange={(event) => setDescription(event.currentTarget.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="edit-device-scope">作用域</FieldLabel>
            <Select value={scope} onValueChange={(value) => setScope(value as DeviceScope)}>
              <SelectTrigger id="edit-device-scope" aria-label="作用域" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                <SelectItem value="global">全局（所有项目可用）</SelectItem>
                <SelectItem value="project">仅指定项目</SelectItem>
              </SelectGroup></SelectContent>
            </Select>
          </Field>
          {scope === "project" ? (
            <ProjectBindingField
              idPrefix="edit-device"
              projects={projects}
              value={projectId}
              onChange={setProjectId}
            />
          ) : null}
          <Field>
            <FieldLabel htmlFor="edit-device-mode">连接方式</FieldLabel>
            <Select value={connectionMode} onValueChange={(value) => setConnectionMode(value as DeviceConnectionMode)}>
              <SelectTrigger id="edit-device-mode" aria-label="连接方式" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                <SelectItem value="reverse">反向连接</SelectItem>
                <SelectItem value="direct">直接连接</SelectItem>
              </SelectGroup></SelectContent>
            </Select>
          </Field>
          {connectionMode === "direct" ? (
            <Field>
              <FieldLabel htmlFor="edit-device-direct-url">直接连接地址</FieldLabel>
              <Input id="edit-device-direct-url" aria-label="直接连接地址" value={directUrl} onChange={(event) => setDirectUrl(event.currentTarget.value)} />
            </Field>
          ) : null}
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button disabled={!valid || busy} onClick={() => onSubmit({
            name: name.trim(),
            description: description.trim() || null,
            connectionMode,
            directUrl: connectionMode === "direct" ? directUrl.trim() : null,
            scope,
            projectId: scope === "project" ? projectId.trim() : null,
          })}>{busy ? "正在保存…" : "保存"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TokenDialog({
  issued,
  onClose,
  onCopy,
}: {
  readonly issued: VisibleToken | null;
  readonly onClose: () => void;
  readonly onCopy: (token: string) => void;
}) {
  return (
    <Dialog open={issued !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>保存设备令牌</DialogTitle>
          <DialogDescription>“{issued?.name ?? ""}”的明文令牌仅显示这一次，关闭后无法再次读取。</DialogDescription>
        </DialogHeader>
        {issued ? (
          <div className="flex flex-col gap-4">
            <Alert>
              <AlertTitle>立即保存令牌</AlertTitle>
              <AlertDescription>请将令牌存入受保护的凭据存储，不要粘贴到小说项目或日志中。</AlertDescription>
            </Alert>
            <code className="break-all rounded-lg bg-muted p-3 text-sm">{issued.token}</code>
            <Button variant="outline" onClick={() => onCopy(issued.token)}>
              <Clipboard data-icon="inline-start" />复制令牌
            </Button>
            <Field>
              <FieldLabel>执行器启动示例</FieldLabel>
              <code className="break-all rounded-lg bg-muted p-3 text-xs">
                {`narrafork-executor --server wss://<host>/ws/device --device ${issued.slug} --token ${issued.token}`}
              </code>
            </Field>
          </div>
        ) : null}
        <DialogFooter>
          <Button onClick={onClose}>我已保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TransferDialog({
  device,
  busy,
  onClose,
  onSubmit,
}: {
  readonly device: RuntimeDevice | null;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (input: DeviceTransferInput) => void;
}) {
  const [direction, setDirection] = useState<DeviceTransferInput["direction"]>("download");
  const [remotePath, setRemotePath] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [recursive, setRecursive] = useState(false);
  const valid = Boolean(remotePath.trim() && localPath.trim());

  return (
    <Dialog open={device !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>与“{device?.name ?? ""}”传输文件</DialogTitle>
          <DialogDescription>下载会把远程设备文件写入 Runtime 主机；上传方向相反。路径会由真实 Runtime 端点处理。</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="transfer-direction">传输方向</FieldLabel>
            <Select value={direction} onValueChange={(value) => setDirection(value as DeviceTransferInput["direction"])}>
              <SelectTrigger id="transfer-direction" aria-label="传输方向" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="download">从设备下载到 Runtime 主机</SelectItem>
                  <SelectItem value="upload">从 Runtime 主机上传到设备</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="transfer-remote-path">设备路径</FieldLabel>
            <Input id="transfer-remote-path" aria-label="设备路径" placeholder="/home/user/file.bin" value={remotePath} onChange={(event) => setRemotePath(event.currentTarget.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="transfer-local-path">Runtime 主机路径</FieldLabel>
            <Input id="transfer-local-path" aria-label="Runtime 主机路径" placeholder="/path/on/server/file.bin" value={localPath} onChange={(event) => setLocalPath(event.currentTarget.value)} />
          </Field>
          <Field orientation="horizontal">
            <FieldLabel htmlFor="transfer-recursive">递归传输目录</FieldLabel>
            <Switch aria-label="递归传输目录" checked={recursive} onCheckedChange={setRecursive} />
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button disabled={!valid || busy} onClick={() => onSubmit({
            direction,
            remotePath: remotePath.trim(),
            localPath: localPath.trim(),
            recursive,
          })}>
            {busy ? "正在传输…" : "开始传输"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
