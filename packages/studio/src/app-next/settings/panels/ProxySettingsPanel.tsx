import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Save } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/ui/simple-select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  createProxyOverridesClient,
  type RuntimeHookProxyTarget,
  type RuntimeProviderProxyTarget,
  type RuntimeProxyOverride,
  type RuntimeProxyOverridesSnapshot,
} from "../../runtime-admin/proxy-overrides";
import type { RuntimeProxySettings } from "../../runtime-admin/settings";

const proxyClient = createProxyOverridesClient();
const PROXY_URL_PATTERN = /^(https?|socks4|socks5h?):\/\/\S+$/i;

const MODE_OPTIONS = [
  { value: "default", label: "继承统一策略" },
  { value: "system", label: "跟随系统环境变量" },
  { value: "direct", label: "直接连接" },
  { value: "custom", label: "自定义代理" },
] as const;

const OUTBOUND_MODE_OPTIONS = MODE_OPTIONS.filter((option) => option.value !== "default");

const PLATFORM_LABELS: Readonly<Record<string, string>> = {
  telegram: "Telegram",
  discord: "Discord",
  slack: "Slack",
  feishu: "Feishu / Lark",
  webhook: "Webhook",
  weixin: "微信",
  qqbot: "QQ Bot",
};

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function validProxy(value: RuntimeProxyOverride | RuntimeProxySettings): boolean {
  return value.mode !== "custom" || PROXY_URL_PATTERN.test(value.url?.trim() ?? "");
}

function overrideKey(target: RuntimeProviderProxyTarget | RuntimeHookProxyTarget): string {
  if ("scope" in target) return `hook:${target.id}`;
  return target.kind === "builtin"
    ? `provider:${target.key}`
    : `provider:${target.section}:${target.id}`;
}

interface OverrideRowProps {
  readonly name: string;
  readonly badge?: string;
  readonly value: RuntimeProxyOverride;
  readonly saving: boolean;
  readonly saved: boolean;
  readonly onChange: (value: RuntimeProxyOverride) => void;
  readonly onSave: () => void;
}

function OverrideRow({ name, badge, value, saving, saved, onChange, onSave }: OverrideRowProps) {
  const valid = validProxy(value);
  return (
    <div data-slot="proxy-override-row" className="flex flex-col gap-4 rounded-lg border p-4">
      <div data-slot="proxy-override-row-header" className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 truncate text-sm font-medium">{name}</span>
        {badge ? <Badge variant="secondary">{badge}</Badge> : null}
      </div>
      <FieldGroup>
        <Field orientation="responsive" data-disabled={saving}>
          <FieldLabel>代理策略</FieldLabel>
          <SimpleSelect
            aria-label={`${name} 代理策略`}
            value={value.mode}
            onValueChange={(mode) => onChange(
              mode === "custom"
                ? { mode: "custom", url: value.url ?? "" }
                : { mode: mode as Exclude<RuntimeProxyOverride["mode"], "custom"> },
            )}
            options={[...MODE_OPTIONS]}
            disabled={saving}
          />
        </Field>
        {value.mode === "custom" ? (
          <Field data-invalid={!valid} data-disabled={saving}>
            <FieldLabel>代理 URL</FieldLabel>
            <Input
              aria-label={`${name} 代理 URL`}
              aria-invalid={!valid}
              autoComplete="off"
              value={value.url ?? ""}
              onChange={(event) => onChange({ mode: "custom", url: event.currentTarget.value })}
              placeholder="http://127.0.0.1:7890"
              disabled={saving}
            />
            <FieldDescription>支持 http、https、socks4、socks5 和 socks5h。</FieldDescription>
          </Field>
        ) : null}
      </FieldGroup>
      <div className="flex justify-end">
        <Button type="button" size="sm" variant="outline" onClick={onSave} disabled={saving || !valid}>
          {saved ? <Check data-icon="inline-start" /> : <Save data-icon="inline-start" />}
          {saving ? "保存中…" : saved ? "已保存" : "保存覆盖"}
        </Button>
      </div>
    </div>
  );
}

interface OverrideGroupProps {
  readonly title: string;
  readonly description: string;
  readonly emptyDescription: string;
  readonly children: React.ReactNode;
  readonly empty: boolean;
}

function OverrideGroup({ title, description, emptyDescription, children, empty }: OverrideGroupProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {empty ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>暂无可配置项</EmptyTitle>
              <EmptyDescription>{emptyDescription}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div data-slot="proxy-override-list" className="flex flex-col gap-4">{children}</div>
        )}
      </CardContent>
    </Card>
  );
}

export function ProxySettingsPanel() {
  const [snapshot, setSnapshot] = useState<RuntimeProxyOverridesSnapshot | null>(null);
  const [outbound, setOutbound] = useState<RuntimeProxySettings>({ mode: "system" });
  const [drafts, setDrafts] = useState<Readonly<Record<string, RuntimeProxyOverride>>>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await proxyClient.get();
      const nextDrafts: Record<string, RuntimeProxyOverride> = {};
      for (const provider of next.providers) nextDrafts[overrideKey(provider)] = provider.proxy;
      for (const gateway of next.gateways) nextDrafts[`gateway:${gateway.platform}`] = gateway.proxy;
      for (const hook of next.hooks) nextDrafts[overrideKey(hook)] = hook.proxy;
      setSnapshot(next);
      setOutbound(next.outbound);
      setDrafts(nextDrafts);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setDraft = useCallback((key: string, value: RuntimeProxyOverride) => {
    setSavedKey(null);
    setDrafts((current) => ({ ...current, [key]: value }));
  }, []);

  async function runSave(key: string, operation: () => Promise<unknown>) {
    setSavingKey(key);
    setSavedKey(null);
    setError(null);
    try {
      await operation();
      setSavedKey(key);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSavingKey(null);
    }
  }

  const providerRows = useMemo(
    () => (snapshot?.providers ?? []).filter((provider) =>
      provider.kind === "provider" && (provider.section === "customApiProviders" || provider.section === "nugProviders"),
    ),
    [snapshot],
  );
  const gatewayRows = useMemo(() => snapshot?.gateways ?? [], [snapshot]);
  const hookRows = useMemo(() => snapshot?.hooks ?? [], [snapshot]);

  if (loading) {
    return (
      <div className="flex flex-col gap-4" aria-label="正在读取代理设置">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!snapshot) {
    return (
      <Alert>
        <AlertTitle>代理设置加载失败</AlertTitle>
        <AlertDescription>{error ?? "Runtime 未返回代理设置。"}</AlertDescription>
      </Alert>
    );
  }

  const outboundValid = validProxy(outbound);

  return (
    <div data-slot="proxy-settings-panel" className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">代理管理</h2>
        <p className="text-sm text-muted-foreground">
          管理 Runtime 统一出站策略，以及 canonical 标准 API Provider、Gateway 平台和 HTTP Hook 的独立覆盖。
        </p>
      </div>

      {error ? (
        <Alert>
          <AlertTitle>代理设置操作失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>统一出站代理</CardTitle>
          <CardDescription>未设置独立覆盖的 Provider、WebFetch、Gateway 与 Hook 均继承此策略。</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field orientation="responsive" data-disabled={savingKey === "outbound"}>
              <FieldLabel>代理模式</FieldLabel>
              <SimpleSelect
                aria-label="统一代理模式"
                value={outbound.mode}
                onValueChange={(mode) => {
                  setSavedKey(null);
                  setOutbound(
                    mode === "custom"
                      ? { mode: "custom", url: outbound.url ?? "" }
                      : { mode: mode as "system" | "direct" },
                  );
                }}
                options={[...OUTBOUND_MODE_OPTIONS]}
                disabled={savingKey === "outbound"}
              />
            </Field>
            {outbound.mode === "custom" ? (
              <Field data-invalid={!outboundValid} data-disabled={savingKey === "outbound"}>
                <FieldLabel htmlFor="outbound-proxy-url">代理 URL</FieldLabel>
                <Input
                  id="outbound-proxy-url"
                  aria-invalid={!outboundValid}
                  autoComplete="off"
                  value={outbound.url ?? ""}
                  onChange={(event) => {
                    setSavedKey(null);
                    setOutbound({ mode: "custom", url: event.currentTarget.value });
                  }}
                  placeholder="http://127.0.0.1:7890"
                  disabled={savingKey === "outbound"}
                />
                <FieldDescription>支持 http、https、socks4、socks5 和 socks5h。</FieldDescription>
              </Field>
            ) : null}
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end">
          <Button
            type="button"
            onClick={() => void runSave("outbound", () => proxyClient.updateOutbound(outbound))}
            disabled={savingKey === "outbound" || !outboundValid}
          >
            {savedKey === "outbound" ? <Check data-icon="inline-start" /> : <Save data-icon="inline-start" />}
            {savingKey === "outbound" ? "保存中…" : savedKey === "outbound" ? "已保存" : "保存统一策略"}
          </Button>
        </CardFooter>
      </Card>

      <OverrideGroup
        title="AI Provider 覆盖"
        description="显示并覆盖标准 API 连接与 NUG 反代服务；内置账户池、Cline 与派生缓存不会出现。"
        emptyDescription="Runtime 尚未配置标准 API 连接或 NUG 反代服务。"
        empty={providerRows.length === 0}
      >
        {providerRows.map((provider) => {
          const key = overrideKey(provider);
          return (
            <OverrideRow
              key={key}
              name={provider.name}
              badge={provider.kind === "provider" ? provider.badge : "内置"}
              value={drafts[key] ?? { mode: "default" }}
              saving={savingKey === key}
              saved={savedKey === key}
              onChange={(value) => setDraft(key, value)}
              onSave={() => void runSave(key, () => proxyClient.updateProvider(provider, drafts[key] ?? provider.proxy))}
            />
          );
        })}
      </OverrideGroup>

      <OverrideGroup
        title="Gateway 覆盖"
        description="保存后通过 Runtime 真实偏好 API 更新平台配置，并请求重载对应 Gateway。"
        emptyDescription="当前用户尚未配置 Gateway 平台。"
        empty={gatewayRows.length === 0}
      >
        {gatewayRows.map((gateway) => {
          const key = `gateway:${gateway.platform}`;
          return (
            <OverrideRow
              key={key}
              name={PLATFORM_LABELS[gateway.platform] ?? gateway.platform}
              badge="Gateway"
              value={drafts[key] ?? { mode: "default" }}
              saving={savingKey === key}
              saved={savedKey === key}
              onChange={(value) => setDraft(key, value)}
              onSave={() => void runSave(key, () => proxyClient.updateGateway(gateway.platform, drafts[key] ?? gateway.proxy))}
            />
          );
        })}
      </OverrideGroup>

      <OverrideGroup
        title="HTTP Hook 覆盖"
        description="只更新 Hook 的 proxyMode 与 proxyUrl，不回传 headers 等敏感配置。"
        emptyDescription="Runtime 中没有 HTTP Hook。"
        empty={hookRows.length === 0}
      >
        {hookRows.map((hook) => {
          const key = overrideKey(hook);
          return (
            <OverrideRow
              key={key}
              name={hook.name}
              badge={hook.scope === "project" ? "项目" : "全局"}
              value={drafts[key] ?? { mode: "default" }}
              saving={savingKey === key}
              saved={savedKey === key}
              onChange={(value) => setDraft(key, value)}
              onSave={() => void runSave(key, () => proxyClient.updateHook(hook.id, drafts[key] ?? hook.proxy))}
            />
          );
        })}
      </OverrideGroup>
    </div>
  );
}
