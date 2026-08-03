import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Plug, PlugZap, RefreshCw, Terminal as TerminalIcon, Trash2, X } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { notify } from "@/lib/notify";
import { getRuntimeToken } from "../../runtime/auth";
import {
  createTerminalsAdminClient,
  type RuntimeAdminTerminal,
  type RuntimeAdminTerminalsResponse,
} from "../../runtime-admin/terminals";

const client = createTerminalsAdminClient();
const REFRESH_INTERVAL_MS = 10_000;

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function formatRss(kb: number): string {
  if (kb < 1024) return `${kb}K`;
  if (kb < 1024 * 1024) return `${(kb / 1024).toFixed(1)}M`;
  return `${(kb / 1024 / 1024).toFixed(1)}G`;
}

function ProcessList({ terminal }: { readonly terminal: RuntimeAdminTerminal }) {
  if (terminal.processes.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex max-w-64 flex-col gap-1">
      {terminal.processes.map((process) => (
        <div key={process.pid} className="flex items-center gap-2 text-xs">
          <Badge variant="outline">{process.command}</Badge>
          <span className="font-mono text-muted-foreground">{formatRss(process.rss)}</span>
          <span className="text-muted-foreground">{process.elapsed}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Embedded terminal panel (xterm.js + WebSocket to /ws/terminal)
// ---------------------------------------------------------------------------

const TerminalEmbed = lazy(() => import("./TerminalEmbed").then((m) => ({ default: m.TerminalEmbed })));

export function TerminalsPanel() {
  const [data, setData] = useState<RuntimeAdminTerminalsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [openTerminalId, setOpenTerminalId] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true);
    try {
      const next = await client.list();
      setData(next);
      setSelected((current) => new Set([...current].filter((id) => next.terminals.some((terminal) => terminal.id === id && terminal.status === "running"))));
      setError(null);
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setLoading(false);
      if (!quiet) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(true);
    const timer = window.setInterval(() => void load(true), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const running = useMemo(() => data?.terminals.filter((terminal) => terminal.status === "running") ?? [], [data]);
  const exited = useMemo(() => data?.terminals.filter((terminal) => terminal.status !== "running") ?? [], [data]);
  const allRunningSelected = running.length > 0 && running.every((terminal) => selected.has(terminal.id));

  async function runAction(key: string, action: () => Promise<unknown>, success: string) {
    setBusyAction(key);
    setError(null);
    try {
      await action();
      notify.success(success);
      await load(true);
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusyAction(null);
    }
  }

  async function kill(id: string) {
    if (!window.confirm("确定要终止这个终端吗？")) return;
    if (openTerminalId === id) setOpenTerminalId(null);
    await runAction(`kill:${id}`, () => client.kill(id), "终端已终止");
  }

  async function batchKill() {
    const ids = [...selected];
    if (ids.length === 0 || !window.confirm(`确定要终止选中的 ${ids.length} 个终端吗？`)) return;
    setBusyAction("batch-kill");
    setError(null);
    try {
      const result = await client.batchKill(ids);
      const failures = result.results.filter((item) => !item.ok);
      if (failures.length > 0) {
        setError(failures.map((item) => `${item.id}: ${item.error ?? "终止失败"}`).join("；"));
      } else {
        notify.success(`已终止 ${ids.length} 个终端`);
      }
      if (openTerminalId && ids.includes(openTerminalId)) setOpenTerminalId(null);
      setSelected(new Set());
      await load(true);
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusyAction(null);
    }
  }

  function handleConnect(id: string, attached: boolean) {
    if (!attached) {
      // Reattach first, then open panel
      void runAction(`reattach:${id}`, () => client.reattach(id), "终端已恢复").then(() => {
        setOpenTerminalId(id);
      });
    } else {
      // Toggle panel
      setOpenTerminalId(openTerminalId === id ? null : id);
    }
  }

  if (loading) return <p className="py-8 text-center text-sm text-muted-foreground">正在读取 Runtime 终端…</p>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">终端</h2>
          <p className="text-sm text-muted-foreground">查看并管理 Runtime 当前记录的终端、进程和孤立 dtach socket。可附加到运行中的终端进行交互。</p>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={refreshing} onClick={() => void load()}>
          <RefreshCw data-icon="inline-start" />
          {refreshing ? "刷新中…" : "刷新"}
        </Button>
      </div>

      {error ? (
        <Alert>
          <AlertTitle>终端管理操作失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {/* Embedded terminal panel */}
      {openTerminalId ? (
        <Card>
          <CardHeader className="flex-row items-center justify-between py-2 px-4">
            <div className="flex items-center gap-2">
              <TerminalIcon className="h-4 w-4" />
              <span className="font-mono text-xs">{openTerminalId}</span>
            </div>
            <Button type="button" variant="ghost" size="xs" onClick={() => setOpenTerminalId(null)}>
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <div className="h-[400px] overflow-hidden">
              <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-muted-foreground">正在加载终端…</div>}>
                <TerminalEmbed terminalId={openTerminalId} />
              </Suspense>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {(data?.orphanSockets.length ?? 0) > 0 ? (
        <Card className="ring-amber-500/40">
          <CardHeader>
            <CardTitle>孤立终端 socket（{data?.orphanSockets.length}）</CardTitle>
            <CardDescription>Runtime 找到了没有活动终端记录的 dtach socket。</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {data?.orphanSockets.map((socket) => (
              <div key={socket.terminalId} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-mono text-xs text-foreground">{socket.terminalId}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">{socket.socketPath}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button type="button" aria-label={`恢复孤立终端 ${socket.terminalId}`} variant="outline" size="sm" disabled={busyAction !== null} onClick={() => void runAction(`orphan-reattach:${socket.terminalId}`, () => client.reattachOrphan(socket.terminalId), "孤立终端已恢复") }>
                    <Plug data-icon="inline-start" />恢复
                  </Button>
                  <Button type="button" aria-label={`删除孤立终端 ${socket.terminalId}`} variant="destructive" size="sm" disabled={busyAction !== null} onClick={() => {
                    if (window.confirm("确定要删除这个孤立终端 socket 吗？")) {
                      void runAction(`orphan-kill:${socket.terminalId}`, () => client.killOrphan(socket.terminalId), "孤立终端 socket 已删除");
                    }
                  }}>
                    <Trash2 data-icon="inline-start" />删除
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="sm:grid-cols-[1fr_auto]">
          <div>
            <CardTitle>运行中（{running.length}）</CardTitle>
            <CardDescription>可附加到终端进行交互操作，恢复已脱离的终端，或终止单个及多个终端。</CardDescription>
          </div>
          {selected.size > 0 ? (
            <Button type="button" variant="destructive" size="sm" disabled={busyAction !== null} onClick={() => void batchKill()}>
              <Trash2 data-icon="inline-start" />终止所选（{selected.size}）
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          <TerminalTable
            terminals={running}
            selectable
            selected={selected}
            allSelected={allRunningSelected}
            disabled={busyAction !== null}
            openTerminalId={openTerminalId}
            onToggleAll={() => setSelected(allRunningSelected ? new Set() : new Set(running.map((terminal) => terminal.id)))}
            onToggle={(id) => setSelected((current) => {
              const next = new Set(current);
              if (next.has(id)) next.delete(id); else next.add(id);
              return next;
            })}
            onConnect={handleConnect}
            onKill={(id) => void kill(id)}
          />
        </CardContent>
      </Card>

      {exited.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>已退出（{exited.length}）</CardTitle>
            <CardDescription>Runtime 保留的已退出终端记录。</CardDescription>
          </CardHeader>
          <CardContent><TerminalTable terminals={exited} /></CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function TerminalTable({ terminals, selectable = false, selected, allSelected = false, disabled = false, openTerminalId, onToggleAll, onToggle, onConnect, onKill }: {
  readonly terminals: readonly RuntimeAdminTerminal[];
  readonly selectable?: boolean;
  readonly selected?: ReadonlySet<string>;
  readonly allSelected?: boolean;
  readonly disabled?: boolean;
  readonly openTerminalId?: string | null;
  readonly onToggleAll?: () => void;
  readonly onToggle?: (id: string) => void;
  readonly onConnect?: (id: string, attached: boolean) => void;
  readonly onKill?: (id: string) => void;
}) {
  if (terminals.length === 0) return <p className="py-4 text-center text-sm text-muted-foreground">没有终端。</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {selectable ? <TableHead><input aria-label="选择全部运行中终端" type="checkbox" checked={allSelected} onChange={onToggleAll} /></TableHead> : null}
          <TableHead>名称</TableHead><TableHead>状态</TableHead><TableHead>进程</TableHead><TableHead>工作目录</TableHead><TableHead>创建时间</TableHead>
          {onKill || onConnect ? <TableHead>操作</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {terminals.map((terminal) => (
          <TableRow key={terminal.id} className={openTerminalId === terminal.id ? "bg-muted/50" : undefined}>
            {selectable ? <TableCell><input aria-label={`选择终端 ${terminal.name}`} type="checkbox" checked={selected?.has(terminal.id) ?? false} onChange={() => onToggle?.(terminal.id)} /></TableCell> : null}
            <TableCell><p>{terminal.name}</p><p className="font-mono text-xs text-muted-foreground">{terminal.id}</p></TableCell>
            <TableCell><div className="flex gap-1"><Badge variant={terminal.status === "running" ? "default" : "secondary"}>{terminal.status === "running" ? "运行中" : "已退出"}</Badge>{terminal.status === "running" ? <Badge variant="outline">{terminal.attached ? "已连接" : "已脱离"}</Badge> : null}</div></TableCell>
            <TableCell><ProcessList terminal={terminal} /></TableCell>
            <TableCell><span className="block max-w-56 truncate font-mono text-xs">{terminal.cwd ?? "—"}</span></TableCell>
            <TableCell>{new Date(terminal.createdAt).toLocaleString()}</TableCell>
            {onKill || onConnect ? (
              <TableCell><div className="flex gap-1">
                {onConnect ? (
                  <Button
                    type="button"
                    aria-label={terminal.attached ? (openTerminalId === terminal.id ? `关闭终端面板 ${terminal.name}` : `附加终端 ${terminal.name}`) : `恢复终端 ${terminal.name}`}
                    variant={openTerminalId === terminal.id ? "default" : "outline"}
                    size="xs"
                    disabled={disabled}
                    onClick={() => onConnect(terminal.id, !!terminal.attached)}
                  >
                    {terminal.attached ? <TerminalIcon data-icon="inline-start" /> : <PlugZap data-icon="inline-start" />}
                    {terminal.attached ? (openTerminalId === terminal.id ? "关闭" : "附加") : "恢复"}
                  </Button>
                ) : null}
                {onKill ? <Button type="button" aria-label={`终止终端 ${terminal.name}`} variant="destructive" size="xs" disabled={disabled} onClick={() => onKill(terminal.id)}><Trash2 data-icon="inline-start" />终止</Button> : null}
              </div></TableCell>
            ) : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
