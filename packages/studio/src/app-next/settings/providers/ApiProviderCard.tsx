import type { ApiProvider } from "../provider-types";

export function ApiProviderCard({
  provider,
  onSelect,
  onToggle,
}: {
  readonly provider: ApiProvider;
  readonly onSelect: (providerId: string) => void;
  readonly onToggle: (providerId: string, enabled: boolean) => void;
}) {
  const enabledModels = provider.models.filter((model) => model.enabled !== false);
  const previewModels = enabledModels.slice(0, 3);
  const moreCount = enabledModels.length - previewModels.length;

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
            {provider.apiMode && (
              <span className="inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {provider.apiMode}
              </span>
            )}
            {provider.compatibility && (
              <span className="inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {provider.compatibility.replace("-compatible", "")}
              </span>
            )}
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
      <div className="mt-2 text-xs text-muted-foreground">{provider.models.length} 个模型</div>
    </div>
  );
}
