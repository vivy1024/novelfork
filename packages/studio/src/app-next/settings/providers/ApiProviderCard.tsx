import { providerApiModeLabel, providerCompatibilityLabel } from "../../lib/display-labels";
import type { ApiProvider } from "../provider-types";
import type { ApiProviderStatusSummary } from "./ApiProvidersSection";

export function ApiProviderCard({
  provider,
  status,
  isTestFixture = false,
  onSelect,
  onToggle,
}: {
  readonly provider: ApiProvider;
  readonly status?: ApiProviderStatusSummary;
  readonly isTestFixture?: boolean;
  readonly onSelect: (providerId: string) => void;
  readonly onToggle: (providerId: string, enabled: boolean) => void;
}) {
  const enabledModels = provider.models.filter((model) => model.enabled !== false);
  const previewModels = enabledModels.slice(0, 3);
  const moreCount = enabledModels.length - previewModels.length;
  const state = status?.status ?? "degraded";
  const stateLabel = state === "error" ? "degraded/error" : state;
  const catalogLabel = status?.catalogEnabled === false ? "未开放" : "可配置";
  const configuredLabel = status?.configured ? "已配置" : "未配置";
  const verifiedLabel = status?.verified ? "已验证" : "未验证";
  const callableLabel = status?.callableModelCount ? "可调用" : "不可调用";
  const reasons = status?.reasons ?? [];

  return (
    <div
      aria-label={`查看 ${provider.name} API key 接入详情`}
      className="cursor-pointer rounded-lg border border-border p-3 transition hover:border-primary/40 hover:shadow-sm"
      onClick={() => onSelect(provider.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(provider.id);
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium leading-tight">{provider.name}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${state === "callable" ? "bg-emerald-500/10 text-emerald-600" : state === "error" ? "bg-destructive/10 text-destructive" : "bg-amber-500/10 text-amber-600"}`}>
              {stateLabel}
            </span>
            <span className="inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">{catalogLabel}</span>
            <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${status?.configured ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground"}`}>{configuredLabel}</span>
            <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${status?.verified ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground"}`}>{verifiedLabel}</span>
            <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${status?.callableModelCount ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground"}`}>{callableLabel}</span>
            {provider.apiMode && (
              <span className="inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {providerApiModeLabel(provider.apiMode)}
              </span>
            )}
            {provider.compatibility && (
              <span className="inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {providerCompatibilityLabel(provider.compatibility)}
              </span>
            )}
            {isTestFixture ? <span className="inline-block rounded bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-purple-600">测试夹具</span> : null}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={provider.enabled}
          aria-label={provider.enabled ? `禁用 ${provider.name} API key 接入` : `启用 ${provider.name} API key 接入`}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${provider.enabled ? "bg-primary" : "bg-muted"}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggle(provider.id, !provider.enabled);
          }}
        >
          <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${provider.enabled ? "translate-x-4" : "translate-x-0.5"}`} />
        </button>
      </div>

      {previewModels.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1">
          {previewModels.map((model) => (
            <span key={model.id} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{model.name}</span>
          ))}
          {moreCount > 0 && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">+{moreCount} 更多模型</span>}
        </div>
      ) : (
        <div className="mt-3 text-xs text-muted-foreground">暂无模型，进入详情后刷新。</div>
      )}
      {reasons.length > 0 && <div className="mt-2 text-xs text-muted-foreground">{reasons.join(" / ")}</div>}
      {isTestFixture ? <div className="mt-2 text-xs text-muted-foreground">开发数据：测试夹具，请使用隔离 root 或清理该 provider 后再做发布验收。</div> : null}
      <div className="mt-2 text-xs text-muted-foreground">{provider.models.length} 个模型 · {status?.callableModelCount ?? 0} 可调用模型</div>
      <div className="mt-2 text-xs text-muted-foreground">恢复动作：添加密钥 / 刷新模型 / 测试模型 / 启停 provider</div>
    </div>
  );
}
