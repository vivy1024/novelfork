import type { PlatformId, PlatformIntegrationCatalogItem } from "../provider-types";
import { PlatformIntegrationCard } from "./PlatformIntegrationCard";

export function PlatformIntegrationsSection({
  integrations,
  accountCounts,
  onSelect,
}: {
  readonly integrations: readonly PlatformIntegrationCatalogItem[];
  readonly accountCounts: Readonly<Record<PlatformId, number>>;
  readonly onSelect: (platformId: PlatformId) => void;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-base font-semibold">平台集成</h3>
        <p className="text-xs text-muted-foreground">Codex、Kiro 等平台账号通过 JSON 账号数据导入后使用；这里管理平台账号、凭据、配额与切号，不是 Base URL / API Key 接入表单。</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {integrations.map((integration) => (
          <PlatformIntegrationCard
            key={integration.id}
            integration={integration}
            accountCount={accountCounts[integration.id] ?? 0}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
}
