import type { PlatformImportMethod, PlatformIntegrationCatalogItem } from "../provider-types";

const IMPORT_METHOD_LABELS: Record<PlatformImportMethod, string> = {
  "json-account": "JSON 账号",
  "local-auth-json": "本机 auth.json",
  oauth: "OAuth",
  "device-code": "设备码",
};

function importStatusLabel(integration: PlatformIntegrationCatalogItem): string {
  return integration.supportedImportMethods.includes("json-account") ? "可导入" : "未开放";
}

function buildPlatformState(integration: PlatformIntegrationCatalogItem, accountCount: number) {
  const modelCount = integration.modelCount ?? 0;
  if (!integration.enabled) {
    return { catalog: "未开放", account: accountCount > 0 ? "已配置账号" : "未配置账号", summary: "未开放 / 不可调用", callable: false };
  }
  if (accountCount === 0) {
    return { catalog: "可导入", account: "未配置账号", summary: "可导入 / 未配置账号 / 不可调用", callable: false };
  }
  if (modelCount === 0) {
    return { catalog: "未验证", account: "已配置账号", summary: "未验证 / 0 个模型 / 不可调用", callable: false };
  }
  return { catalog: "可配置", account: "已配置账号", summary: "可配置 / 已配置账号 / 可调用", callable: true };
}

export function PlatformIntegrationCard({
  integration,
  accountCount,
  onSelect,
}: {
  readonly integration: PlatformIntegrationCatalogItem;
  readonly accountCount: number;
  readonly onSelect: (platformId: PlatformIntegrationCatalogItem["id"]) => void;
}) {
  const state = buildPlatformState(integration, accountCount);

  return (
    <div
      aria-label={`查看 ${integration.name} 平台集成详情`}
      className="cursor-pointer rounded-lg border border-border p-3 transition hover:border-primary/40 hover:shadow-sm"
      onClick={() => onSelect(integration.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(integration.id);
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium leading-tight">{integration.name}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            <span className="inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-muted-foreground">
              平台
            </span>
            <span className="inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
              {state.catalog}
            </span>
            <span className="inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
              {state.account}
            </span>
          </div>
        </div>
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${state.callable ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
          {state.callable ? "可调用" : "不可调用"}
        </span>
      </div>

      <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{integration.description}</p>

      <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
        <div className="rounded-md bg-muted/50 px-2 py-1.5">
          <div className="font-medium text-foreground">{accountCount}</div>
          <div>账号</div>
        </div>
        <div className="rounded-md bg-muted/50 px-2 py-1.5">
          <div className="font-medium text-foreground">{integration.modelCount ?? 0}</div>
          <div>模型</div>
        </div>
        <div className="rounded-md bg-muted/50 px-2 py-1.5">
          <div className="font-medium text-foreground">{importStatusLabel(integration)}</div>
          <div>导入</div>
        </div>
      </div>

      <div className="mt-2 text-xs text-muted-foreground">{state.summary}</div>

      <div className="mt-3 flex flex-wrap gap-1">
        {integration.supportedImportMethods.map((method) => (
          <span key={method} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {IMPORT_METHOD_LABELS[method]}
          </span>
        ))}
      </div>
    </div>
  );
}
