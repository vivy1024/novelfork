import { useApi } from "../../hooks/use-api";
import { InlineError } from "../components/feedback";
import { Row } from "../components/shared";

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

export function ProjectConfigSection() {
  const { data, loading, error } = useApi<ProjectInfo>("/project");
  const { data: overrides, loading: oLoading, error: oError } = useApi<OverridesResponse>("/project/overrides");

  const isLoading = loading || oLoading;
  const firstError = error || oError;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 text-foreground">项目配置</h2>
        <p className="text-sm text-muted-foreground">模型路由与 Agent 覆盖（只读）。</p>
      </div>

      {isLoading && <p className="text-muted-foreground">加载中...</p>}
      {firstError && <InlineError message={firstError} />}

      {data && (
        <div className="space-y-3 rounded-lg border border-border p-4">
          <h3 className="text-sm font-semibold text-foreground">模型路由</h3>
          <Row label="项目名称" value={data.name} />
          <Row label="模型" value={data.model} />
          <Row label="供应商" value={data.provider} />
          <Row label="接口地址" value={data.baseUrl} />
          <Row label="语言" value={data.language} />
          <Row label="流式输出" value={data.stream ? "是" : "否"} />
          <Row label="随机性" value={String(data.temperature)} />
          <Row label="最大令牌数" value={String(data.maxTokens)} />
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


    </div>
  );
}
