import { useMemo } from "react";
import { Plus } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Button } from "@/components/ui/button";

import {
  type RuntimeEditableNugProvider,
  type RuntimeEditableProvider,
  type RuntimeModelGroup,
  type RuntimeModelOption,
  type RuntimeProviderArrayKey,
} from "../runtime-settings-utils";
import { ProviderCard } from "./ProviderCard";
import type { PlatformProviderKind } from "./PlatformProviderDetail";

export interface PlatformProviderSummary {
  readonly platform: PlatformProviderKind;
  readonly title: string;
  readonly description: string;
  readonly status: string;
  readonly detail?: string;
}

export interface ProviderOverviewViewProps {
  readonly providers: ReadonlyArray<{
    readonly arrayKey: RuntimeProviderArrayKey;
    readonly provider: RuntimeEditableProvider | RuntimeEditableNugProvider;
    readonly models: readonly RuntimeModelOption[];
  }>;
  readonly modelGroups: readonly RuntimeModelGroup[];
  readonly platformProviders?: readonly PlatformProviderSummary[];
  readonly providerOrder?: readonly string[];
  readonly busy?: boolean;
  readonly error?: string | null;
  readonly feedback?: string | null;
  readonly onAdd: () => void;
  readonly onSelectPlatform?: (platform: PlatformProviderKind) => void;
  readonly onSelect: (arrayKey: RuntimeProviderArrayKey, providerId: string) => void;
  readonly onToggle: (arrayKey: RuntimeProviderArrayKey, providerId: string, enabled: boolean) => void;
  readonly onDelete: (arrayKey: RuntimeProviderArrayKey, providerId: string) => void;
}

export function ProviderOverviewView({
  providers,
  modelGroups,
  platformProviders = [],
  providerOrder,
  busy = false,
  error,
  feedback,
  onAdd,
  onSelectPlatform,
  onSelect,
  onToggle,
  onDelete,
}: ProviderOverviewViewProps) {
  const sortedProviders = useMemo(() => {
    if (!providerOrder || providerOrder.length === 0) return providers;
    return [...providers].sort((a, b) => {
      const indexA = providerOrder.indexOf(a.provider.id);
      const indexB = providerOrder.indexOf(b.provider.id);
      return (indexA === -1 ? Infinity : indexA) - (indexB === -1 ? Infinity : indexB);
    });
  }, [providers, providerOrder]);
  const enabledCount = providers.filter(({ provider }) => !provider.disabled).length;
  const discoveredModels = modelGroups.reduce((total, group) => total + group.models.length, 0);
  const customProviders = sortedProviders.filter(({ arrayKey }) => arrayKey === "customApiProviders");
  const nugProviders = sortedProviders.filter(({ arrayKey }) => arrayKey === "nugProviders");

  return (
    <section aria-label="AI 供应商设置" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">AI 供应商</h2>
          <p className="text-sm text-muted-foreground">管理 API 连接、反代服务和可用模型。</p>
        </div>
        <Button type="button" onClick={onAdd}>
          <Plus data-icon="inline-start" />
          添加供应商
        </Button>
      </div>

      {error ? (
        <Alert>
          <AlertTitle>供应商操作失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {feedback ? (
        <Alert>
          <AlertTitle>设置已更新</AlertTitle>
          <AlertDescription>{feedback}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard label="供应商" value={providers.length} />
        <SummaryCard label="已启用" value={enabledCount} />
        <SummaryCard label="已发现模型" value={discoveredModels} />
      </div>

      <PlatformProviderGroup
        providers={platformProviders}
        busy={busy}
        onSelect={onSelectPlatform}
      />

      <ProviderGroup
        heading="标准 API 连接"
        description="Anthropic、Responses、Chat Completions 和 Codex Native 连接。"
        providers={customProviders}
        modelGroups={modelGroups}
        busy={busy}
        onSelect={onSelect}
        onToggle={onToggle}
        onDelete={onDelete}
      />
      <ProviderGroup
        heading="NUG 反代服务"
        description="连接 NUG (NovelFork Universal Gateway) 网关，统一管理远端模型通道与算力。"
        providers={nugProviders}
        modelGroups={modelGroups}
        busy={busy}
        onSelect={onSelect}
        onToggle={onToggle}
        onDelete={onDelete}
        emptyDescription="还没有配置 NUG 反代服务。点击上方按钮选择 NUG。"
      />
    </section>
  );
}

function ProviderGroup({
  heading,
  description,
  providers,
  modelGroups,
  busy,
  onSelect,
  onToggle,
  onDelete,
  emptyDescription = "还没有配置此类供应商。点击上方按钮添加。",
}: {
  readonly heading: string;
  readonly description: string;
  readonly providers: ProviderOverviewViewProps["providers"];
  readonly modelGroups: readonly RuntimeModelGroup[];
  readonly busy: boolean;
  readonly onSelect: ProviderOverviewViewProps["onSelect"];
  readonly onToggle: ProviderOverviewViewProps["onToggle"];
  readonly onDelete: ProviderOverviewViewProps["onDelete"];
  readonly emptyDescription?: string;
}) {
  return (
    <section aria-labelledby={`${heading}-heading`} className="flex flex-col gap-3">
      <div>
        <h3 id={`${heading}-heading`} className="text-base font-semibold text-foreground">{heading}</h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {providers.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>暂无{heading}</EmptyTitle>
            <EmptyDescription>{emptyDescription}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {providers.map(({ arrayKey, provider, models }) => (
            <ProviderCard
              key={`${arrayKey}:${provider.id}`}
              arrayKey={arrayKey}
              provider={provider}
              models={models}
              busy={busy}
              onSelect={() => onSelect(arrayKey, provider.id)}
              onToggle={(enabled) => onToggle(arrayKey, provider.id, enabled)}
              onDelete={() => onDelete(arrayKey, provider.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function PlatformProviderGroup({
  providers,
  busy,
  onSelect,
}: {
  readonly providers: readonly PlatformProviderSummary[];
  readonly busy: boolean;
  readonly onSelect?: (platform: PlatformProviderKind) => void;
}) {
  return (
    <section aria-labelledby="platform-providers-heading" className="flex flex-col gap-3">
      <div>
        <h3 id="platform-providers-heading" className="text-base font-semibold text-foreground">Runtime 平台供应商</h3>
        <p className="text-xs text-muted-foreground">Kiro、内建 Codex 账号池和 Cline 独立于自定义 API 连接管理。</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {providers.map((provider) => (
          <Card key={provider.platform}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                {provider.title}
                <Badge variant="outline">平台</Badge>
              </CardTitle>
              <CardDescription>{provider.description}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 text-sm">
              <span>{provider.status}</span>
              {provider.detail ? <span className="text-xs text-muted-foreground">{provider.detail}</span> : null}
            </CardContent>
            <CardFooter className="justify-end">
              <Button type="button" variant="outline" size="sm" onClick={() => onSelect?.(provider.platform)} disabled={busy || !onSelect}>
                管理平台
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </section>
  );
}

function SummaryCard({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle>{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

