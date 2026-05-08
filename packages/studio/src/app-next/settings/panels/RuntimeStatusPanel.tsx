import { useApi } from "../../../hooks/use-api";
import { InlineError } from "../../components/feedback";
import { Row } from "../../components/shared";

interface RuntimeStatusResponse {
  storage: {
    runtimeDir: string;
    userConfigPath: string;
    providerStorePath: string;
    sessionStorePath: string;
    transcriptStorePath: string;
    checkpointStorePath: string;
  };
  mcp: {
    strategy: string;
    servers: unknown[];
    status: string;
  };
  sandbox: {
    mode?: string;
    status: string;
    note: string;
  };
  capabilities: readonly {
    id: string;
    label: string;
    value: string;
    status: string;
    currentBehavior: string;
    unsupportedReason?: string;
  }[];
}

function statusBadge(status: string) {
  const colors: Record<string, string> = {
    current: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    partial: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    planned: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    "reference-only": "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
    unsupported: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  };
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${colors[status] ?? "bg-gray-100 text-gray-600"}`}>
      {status}
    </span>
  );
}

export function RuntimeStatusPanel() {
  const { data, loading, error } = useApi<RuntimeStatusResponse>("/settings/runtime-status");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-2 text-foreground">运行时状态</h2>
        <p className="text-sm text-muted-foreground">MCP、Sandbox、存储路径与 Codex 能力状态。不可用项明确标注 planned/unsupported。</p>
      </div>
      {loading && <p className="text-muted-foreground">加载中...</p>}
      {error && <InlineError message={error} />}
      {data && (
        <>
          {/* Storage Paths */}
          <div className="space-y-3 rounded-lg border border-border p-4">
            <h3 className="text-sm font-semibold text-foreground">存储路径</h3>
            <Row label="运行时目录" value={data.storage.runtimeDir} />
            <Row label="用户配置" value={data.storage.userConfigPath} />
            <Row label="Provider 存储" value={data.storage.providerStorePath} />
            <Row label="会话存储" value={data.storage.sessionStorePath} />
            <Row label="Transcript 存储" value={data.storage.transcriptStorePath} />
            <Row label="Checkpoint 存储" value={data.storage.checkpointStorePath} />
          </div>

          {/* MCP */}
          <div className="space-y-3 rounded-lg border border-border p-4">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">MCP Server</h3>
              {statusBadge(data.mcp.status)}
            </div>
            <Row label="策略" value={data.mcp.strategy} />
            <Row label="已注册 Server" value={`${data.mcp.servers.length} 个`} />
            {data.mcp.status === "planned" && (
              <p className="text-xs text-muted-foreground">MCP server 连接管理尚未实现。当前只有工具策略字段（mcpStrategy）。</p>
            )}
          </div>

          {/* Sandbox */}
          <div className="space-y-3 rounded-lg border border-border p-4">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">Codex Sandbox</h3>
              {statusBadge(data.sandbox.status)}
            </div>
            <Row label="模式" value={data.sandbox.mode ?? "未配置"} />
            <p className="text-xs text-muted-foreground">{data.sandbox.note}</p>
          </div>

          {/* Capabilities */}
          <div className="space-y-3 rounded-lg border border-border p-4">
            <h3 className="text-sm font-semibold text-foreground">Codex 能力状态</h3>
            <div className="space-y-2">
              {data.capabilities.map((cap) => (
                <div key={cap.id} className="flex items-start justify-between gap-3 py-1.5 text-sm border-b border-border last:border-0">
                  <div className="space-y-0.5">
                    <div className="text-foreground">{cap.label}</div>
                    <div className="text-[11px] text-muted-foreground">{cap.currentBehavior}</div>
                  </div>
                  <div className="shrink-0">{statusBadge(cap.status)}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
