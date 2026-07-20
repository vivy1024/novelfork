import { Pencil, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

import {
  maskedSecretSummary,
  providerApiTypeLabel,
  providerSecrets,
  type RuntimeEditableProvider,
  type RuntimeEditableNugProvider,
  type RuntimeModelOption,
  type RuntimeProviderArrayKey,
} from "../runtime-settings-utils";

export interface ProviderCardProps {
  readonly arrayKey: RuntimeProviderArrayKey;
  readonly provider: RuntimeEditableProvider | RuntimeEditableNugProvider;
  readonly models: readonly RuntimeModelOption[];
  readonly busy?: boolean;
  readonly onSelect: () => void;
  readonly onToggle: (enabled: boolean) => void;
  readonly onDelete: () => void;
}

export function ProviderCard({
  arrayKey,
  provider,
  models,
  busy = false,
  onSelect,
  onToggle,
  onDelete,
}: ProviderCardProps) {
  const primarySecret = providerSecrets(arrayKey, provider)[0];
  const previewModels = models.filter((model) => !model.hidden).slice(0, 3);

  return (
    <Card className={provider.disabled ? "opacity-60" : undefined}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <span className="truncate">{provider.name || provider.prefix || "未命名供应商"}</span>
          <Badge variant={provider.disabled ? "secondary" : "default"}>
            {provider.disabled ? "已停用" : "已启用"}
          </Badge>
          <Badge variant="outline">{providerApiTypeLabel(arrayKey, provider)}</Badge>
        </CardTitle>
        <CardDescription className="truncate">
          {provider.prefix || "未配置前缀"} · {provider.baseUrl || "未配置地址"}
        </CardDescription>
        <CardAction>
          <Switch
            aria-label={`启用 ${provider.name || provider.prefix}`}
            checked={!provider.disabled}
            disabled={busy}
            onCheckedChange={onToggle}
          />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-xs text-muted-foreground">
        <p>
          默认模型：<span className="font-mono text-foreground">{provider.defaultModel || "未配置"}</span>
        </p>
        <p>
          模型数量：<span className="text-foreground">{models.length}</span>
        </p>
        <p>
          {primarySecret?.label ?? "密钥"}：<span className="font-mono text-foreground">{maskedSecretSummary(primarySecret?.value)}</span>
        </p>
        {previewModels.length > 0 ? (
          <div className="flex flex-wrap gap-1 pt-1">
            {previewModels.map((model) => (
              <Badge key={model.value} variant="secondary" className="max-w-full truncate font-mono text-[10px]">
                {model.modelId}
              </Badge>
            ))}
            {models.length > previewModels.length ? (
              <Badge variant="outline">+{models.length - previewModels.length}</Badge>
            ) : null}
          </div>
        ) : (
          <span className="italic">尚未获取模型</span>
        )}
      </CardContent>
      <CardFooter className="justify-between gap-3">
        <Button type="button" variant="outline" aria-label={`编辑与模型 ${provider.name || provider.prefix}`} onClick={onSelect}>
          <Pencil data-icon="inline-start" />
          编辑与模型
        </Button>
        <Button type="button" variant="ghost" onClick={onDelete} disabled={busy}>
          <Trash2 data-icon="inline-start" />
          删除
        </Button>
      </CardFooter>
    </Card>
  );
}
