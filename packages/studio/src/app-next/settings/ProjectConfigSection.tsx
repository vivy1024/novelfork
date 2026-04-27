import { useApi } from "../../hooks/use-api";
import { InlineError } from "../components/feedback";

interface ProjectInfo {
  readonly name: string;
  readonly language: string;
  readonly model: string;
  readonly provider: string;
  readonly baseUrl: string;
  readonly stream: boolean;
  readonly temperature: number;
  readonly maxTokens: number;
}

interface AgentOverride {
  readonly model: string;
  readonly provider: string;
  readonly baseUrl: string;
}

interface OverridesResponse {
  readonly overrides?: Record<string, AgentOverride>;
}

function Row({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-foreground">{value ?? "—"}</span>
    </div>
  );
}

export function ProjectConfigSection() {
  const { data, loading, error } = useApi<ProjectInfo>("/project");
  const { data: overrides, loading: oLoading, error: oError } = useApi<OverridesResponse>("/project/overrides");

  const isLoading = loading || oLoading;
  const firstError = error || oError;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 text-foreground">项目配置</h2>
        <p className="text-sm text-muted-foreground">模型路由、Agent 覆盖与环境变量（只读）。</p>
      </div>

      {isLoading && <p className="text-muted-foreground">加载中...</p>}
      {firstError && <InlineError message={firstError} />}

      {data && (
        <div className="space-y-3 rounded-lg border border-border p-4">
          <h3 className="text-sm font-semibold text-foreground">模型路由</h3>
          <Row label="项目名称" value={data.name} />
          <Row label="模型" value={data.model} />
          <Row label="供应商" value={data.provider} />
          <Row label="Base URL" value={data.baseUrl} />
          <Row label="语言" value={data.language} />
          <Row label="流式输出" value={data.stream ? "是" : "否"} />
          <Row label="Temperature" value={String(data.temperature)} />
          <Row label="Max Tokens" value={String(data.maxTokens)} />
        </div>
      )}

      <div className="space-y-3 rounded-lg border border-border p-4">
        <h3 className="text-sm font-semibold text-foreground">Agent 覆盖</h3>
        {overrides?.overrides && Object.keys(overrides.overrides).length > 0 ? (
          Object.entries(overrides.overrides).map(([agent, cfg]) => (
            <div key={agent} className="border-t border-border pt-2 first:border-t-0 first:pt-0">
              <div className="text-xs font-medium text-foreground mb-1">{agent}</div>
              <Row label="模型" value={cfg.model} />
              <Row label="供应商" value={cfg.provider} />
              <Row label="Base URL" value={cfg.baseUrl} />
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">{firstError ? "" : "未配置 Agent 覆盖"}</p>
        )}
      </div>

      <div className="space-y-3 rounded-lg border border-border p-4">
        <h3 className="text-sm font-semibold text-foreground">环境变量</h3>
        <p className="text-sm text-muted-foreground">未接入 · 等待环境变量读取 API</p>
      </div>
    </div>
  );
}
