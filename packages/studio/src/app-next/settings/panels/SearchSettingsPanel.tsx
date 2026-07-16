import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Plus,
  Save,
  Search,
  Trash2,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { notify } from "@/lib/notify";
import {
  createSearchSettingsClient,
  DEFAULT_SEARCH_TIMEOUT_MS,
  normalizeSearchProtocol,
  normalizeSearchSettings,
  SEARCH_PROTOCOL_BASE_URLS,
  type CustomSearchProviderConfig,
  type CustomSearchProviderProtocol,
  type SearchChannelConfig,
  type SearchSettings,
  type SearchSettingsClient,
  type SearchSettingsResponse,
} from "../../runtime-admin/search-settings";
import { buildRuntimeModelGroups } from "../runtime-settings-utils";

const defaultSearchSettingsClient = createSearchSettingsClient();
const AUTO_VALUE = "__automatic__";

const PROTOCOL_LABELS: Readonly<Record<CustomSearchProviderProtocol, string>> = {
  "zhipu-web-search-v1": "智谱 Web Search API",
  "tavily-mcp": "Tavily MCP",
};

const PROTOCOL_DESCRIPTIONS: Readonly<Record<CustomSearchProviderProtocol, string>> = {
  "zhipu-web-search-v1": "调用智谱开放平台的 Web Search API；API Key 通过受保护设置保存。",
  "tavily-mcp": "调用 Tavily 的远程 MCP 端点；可在 API Key 或端点查询参数中配置凭据。",
};

const REASONING_OPTIONS = [
  { value: AUTO_VALUE, label: "自动" },
  { value: "none", label: "无" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "xhigh", label: "极高" },
] as const;

export interface SearchSettingsPanelProps {
  readonly client?: SearchSettingsClient;
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function shortId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function channelLabel(channel: SearchChannelConfig, response: SearchSettingsResponse, draft: SearchSettings): string {
  if (channel.kind === "native") return "模型原生搜索";
  if (channel.kind === "kiro-mcp") return "Kiro MCP 搜索";
  if (channel.kind === "subagent") return "搜索子代理";
  if (channel.kind === "nug-mcp") {
    const provider = response.nugProviders?.find((candidate) => candidate.id === channel.providerId);
    return `NUG：${provider?.name || channel.providerId || channel.id}`;
  }
  const provider = draft.customProviders.find((candidate) => candidate.id === channel.providerId);
  return `自定义：${provider?.name || channel.providerId || channel.id}`;
}

function clampNumber(value: string, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.trunc(parsed))) : fallback;
}

function LoadingPanel() {
  return (
    <div className="flex flex-col gap-6" aria-label="正在读取搜索设置">
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

export function SearchSettingsPanel({ client = defaultSearchSettingsClient }: SearchSettingsPanelProps) {
  const [response, setResponse] = useState<SearchSettingsResponse | null>(null);
  const [draft, setDraft] = useState<SearchSettings | null>(null);
  const [saved, setSaved] = useState<SearchSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testQuery, setTestQuery] = useState("最新 AI 新闻");
  const [testPurpose, setTestPurpose] = useState("验证搜索渠道能够返回带来源的最新网页结果。");
  const [testingChannel, setTestingChannel] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    client.get()
      .then((settings) => {
        if (!active) return;
        const normalized = normalizeSearchSettings(settings);
        setResponse(settings);
        setDraft(normalized);
        setSaved(normalized);
      })
      .catch((reason) => {
        if (active) setError(errorMessage(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [client]);

  const dirty = useMemo(
    () => Boolean(draft && saved && JSON.stringify(draft) !== JSON.stringify(saved)),
    [draft, saved],
  );
  const modelGroups = useMemo(
    () => response ? buildRuntimeModelGroups(response) : [],
    [response],
  );

  function updateChannel(id: string, patch: Partial<SearchChannelConfig>) {
    setDraft((current) => current ? {
      ...current,
      channels: current.channels.map((channel) => channel.id === id ? { ...channel, ...patch } : channel),
    } : current);
  }

  function moveChannel(id: string, delta: number) {
    setDraft((current) => {
      if (!current) return current;
      const index = current.channels.findIndex((channel) => channel.id === id);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= current.channels.length) return current;
      const channels = [...current.channels];
      const [channel] = channels.splice(index, 1);
      channels.splice(target, 0, channel);
      return { ...current, channels };
    });
  }

  function addCustomProvider() {
    const id = shortId();
    setDraft((current) => current ? {
      ...current,
      customProviders: [
        ...current.customProviders,
        {
          id,
          name: "新自定义搜索",
          protocol: "zhipu-web-search-v1",
          baseUrl: SEARCH_PROTOCOL_BASE_URLS["zhipu-web-search-v1"],
        },
      ],
      channels: [
        ...current.channels,
        { id: `custom:${id}`, kind: "custom-api", providerId: id, enabled: true },
      ],
    } : current);
  }

  function updateProvider(id: string, patch: Partial<CustomSearchProviderConfig>) {
    setDraft((current) => current ? {
      ...current,
      customProviders: current.customProviders.map((provider) =>
        provider.id === id ? { ...provider, ...patch } : provider,
      ),
    } : current);
  }

  function updateProviderProtocol(id: string, protocol: CustomSearchProviderProtocol) {
    setDraft((current) => current ? {
      ...current,
      customProviders: current.customProviders.map((provider) => {
        if (provider.id !== id) return provider;
        const oldDefault = SEARCH_PROTOCOL_BASE_URLS[normalizeSearchProtocol(provider.protocol)];
        return {
          ...provider,
          protocol,
          baseUrl: !provider.baseUrl || provider.baseUrl === oldDefault
            ? SEARCH_PROTOCOL_BASE_URLS[protocol]
            : provider.baseUrl,
        };
      }),
    } : current);
  }

  function removeProvider(id: string) {
    setDraft((current) => current ? {
      ...current,
      customProviders: current.customProviders.filter((provider) => provider.id !== id),
      channels: current.channels.filter((channel) => channel.providerId !== id),
    } : current);
  }

  async function handleSave() {
    if (!draft || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await client.save(draft);
      const normalized = normalizeSearchSettings(updated);
      setResponse(updated);
      setDraft(normalized);
      setSaved(normalized);
      notify.success("搜索设置已保存", { description: "Runtime 已采用新的搜索渠道顺序与限制。" });
    } catch (reason) {
      const message = errorMessage(reason);
      setError(message);
      notify.error("搜索设置保存失败", { description: message });
    } finally {
      setSaving(false);
    }
  }

  async function handleTestChannel(channel: SearchChannelConfig) {
    setTestingChannel(channel.id);
    setError(null);
    try {
      const result = await client.testChannel({
        channelId: channel.id,
        query: testQuery,
        purpose: testPurpose || undefined,
      });
      notify.success(`${result.channelLabel || channel.id} 测试成功`, {
        description: result.text ? result.text.slice(0, 180) : "Runtime 已返回搜索结果。",
      });
    } catch (reason) {
      const message = errorMessage(reason);
      setError(message);
      notify.error("搜索渠道测试失败", { description: message });
    } finally {
      setTestingChannel(null);
    }
  }

  if (loading) return <LoadingPanel />;
  if (!response || !draft) {
    return (
      <Alert>
        <AlertTitle>搜索设置加载失败</AlertTitle>
        <AlertDescription>{error || "Runtime 未返回搜索设置。"}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div data-slot="search-settings-panel" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">搜索</h2>
          <p className="text-sm text-muted-foreground">
            配置 Runtime 搜索渠道顺序、自定义供应商和全局输出限制，并通过真实渠道测试接口验证可用性。
          </p>
        </div>
        <Button type="button" onClick={() => void handleSave()} disabled={!dirty || saving}>
          <Save data-icon="inline-start" />
          {saving ? "保存中…" : "保存搜索设置"}
        </Button>
      </div>

      {error ? (
        <Alert>
          <AlertTitle>搜索设置操作失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>渠道测试</CardTitle>
          <CardDescription>
            测试按钮会调用 Runtime `POST /api/settings/search/test`，执行真实搜索，不使用前端模拟结果。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup className="grid md:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="search-test-query">测试查询</FieldLabel>
              <Input
                id="search-test-query"
                value={testQuery}
                minLength={2}
                maxLength={1000}
                onChange={(event) => setTestQuery(event.currentTarget.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="search-test-purpose">搜索目的</FieldLabel>
              <Textarea
                id="search-test-purpose"
                value={testPurpose}
                maxLength={1000}
                onChange={(event) => setTestPurpose(event.currentTarget.value)}
              />
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>搜索渠道</CardTitle>
          <CardDescription>Runtime 按当前顺序尝试已启用渠道；模型原生搜索仅在首位时可用。</CardDescription>
          <CardAction>
            <Button type="button" variant="outline" size="sm" onClick={addCustomProvider}>
              <Plus data-icon="inline-start" />
              添加自定义供应商
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {draft.channels.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon"><Search /></EmptyMedia>
                <EmptyTitle>尚未配置搜索渠道</EmptyTitle>
                <EmptyDescription>添加自定义供应商，或在 Runtime 配置中启用内置渠道。</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : draft.channels.map((channel, index) => (
            <Card key={channel.id} size="sm">
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {channelLabel(channel, response, draft)}
                  <Badge variant="outline">{channel.kind}</Badge>
                  {channel.kind === "native" && index > 0 ? (
                    <Badge variant="secondary">仅首位可用</Badge>
                  ) : null}
                </CardTitle>
                <CardDescription>{channel.id}</CardDescription>
                <CardAction>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`上移渠道 ${channel.id}`}
                      disabled={index === 0}
                      onClick={() => moveChannel(channel.id, -1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`下移渠道 ${channel.id}`}
                      disabled={index === draft.channels.length - 1}
                      onClick={() => moveChannel(channel.id, 1)}
                    >
                      <ArrowDown />
                    </Button>
                    <Switch
                      aria-label={`启用渠道 ${channel.id}`}
                      checked={channel.enabled}
                      onCheckedChange={(enabled) => updateChannel(channel.id, { enabled })}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`测试渠道 ${channel.id}`}
                      disabled={channel.kind === "native" || testingChannel !== null || testQuery.trim().length < 2}
                      onClick={() => void handleTestChannel(channel)}
                    >
                      <Search data-icon="inline-start" />
                      {testingChannel === channel.id ? "测试中…" : "测试"}
                    </Button>
                  </div>
                </CardAction>
              </CardHeader>
              <CardContent>
                <FieldGroup className="grid md:grid-cols-3">
                  {channel.kind === "subagent" ? (
                    <>
                      <Field>
                        <FieldLabel htmlFor={`search-model-${channel.id}`}>子代理模型</FieldLabel>
                        <Select
                          value={channel.model || AUTO_VALUE}
                          onValueChange={(value) => updateChannel(channel.id, { model: value === AUTO_VALUE ? undefined : value })}
                        >
                          <SelectTrigger id={`search-model-${channel.id}`} className="w-full">
                            <SelectValue placeholder="自动选择模型" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value={AUTO_VALUE}>自动选择</SelectItem>
                            </SelectGroup>
                            {channel.model && !modelGroups.some((group) => group.models.some((model) => model.value === channel.model)) ? (
                              <SelectGroup>
                                <SelectLabel>当前配置</SelectLabel>
                                <SelectItem value={channel.model}>{channel.model}</SelectItem>
                              </SelectGroup>
                            ) : null}
                            {modelGroups.map((group) => (
                              <SelectGroup key={group.id}>
                                <SelectLabel>{group.label}</SelectLabel>
                                {group.models.map((model) => (
                                  <SelectItem key={model.value} value={model.value}>{model.label}</SelectItem>
                                ))}
                              </SelectGroup>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field>
                        <FieldLabel htmlFor={`search-reasoning-${channel.id}`}>推理强度</FieldLabel>
                        <Select
                          value={channel.reasoningEffort || AUTO_VALUE}
                          onValueChange={(value) => updateChannel(channel.id, {
                            reasoningEffort: value === AUTO_VALUE
                              ? undefined
                              : value as SearchChannelConfig["reasoningEffort"],
                          })}
                        >
                          <SelectTrigger id={`search-reasoning-${channel.id}`} className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {REASONING_OPTIONS.map((option) => (
                                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </Field>
                      <NumberField
                        id={`search-turns-${channel.id}`}
                        label="最大轮次"
                        value={channel.maxTurns ?? 4}
                        min={1}
                        max={10}
                        onChange={(maxTurns) => updateChannel(channel.id, { maxTurns })}
                      />
                    </>
                  ) : null}
                  <OptionalNumberField
                    id={`search-timeout-${channel.id}`}
                    label="渠道超时（毫秒）"
                    description="留空则使用全局默认超时。"
                    value={channel.timeoutMs}
                    min={1000}
                    max={300000}
                    onChange={(timeoutMs) => updateChannel(channel.id, { timeoutMs })}
                  />
                </FieldGroup>
              </CardContent>
            </Card>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>自定义搜索供应商</CardTitle>
          <CardDescription>凭据由 Runtime 设置接口掩码读取和安全保存；浏览器不直接调用第三方搜索服务。</CardDescription>
          <CardAction>
            <Button type="button" variant="outline" size="sm" onClick={addCustomProvider}>
              <Plus data-icon="inline-start" />
              添加供应商
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {draft.customProviders.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon"><Search /></EmptyMedia>
                <EmptyTitle>暂无自定义搜索供应商</EmptyTitle>
                <EmptyDescription>可添加智谱 Web Search API 或 Tavily MCP。</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : draft.customProviders.map((provider) => {
            const protocol = normalizeSearchProtocol(provider.protocol);
            return (
              <Card key={provider.id} size="sm">
                <CardHeader>
                  <CardTitle>{provider.name || provider.id}</CardTitle>
                  <CardDescription>{provider.id}</CardDescription>
                  <CardAction>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`删除搜索供应商 ${provider.name || provider.id}`}
                      onClick={() => removeProvider(provider.id)}
                    >
                      <Trash2 />
                    </Button>
                  </CardAction>
                </CardHeader>
                <CardContent>
                  <FieldGroup className="grid md:grid-cols-2 xl:grid-cols-3">
                    <Field>
                      <FieldLabel htmlFor={`search-provider-name-${provider.id}`}>名称</FieldLabel>
                      <Input
                        id={`search-provider-name-${provider.id}`}
                        value={provider.name}
                        onChange={(event) => updateProvider(provider.id, { name: event.currentTarget.value })}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`search-provider-protocol-${provider.id}`}>协议</FieldLabel>
                      <Select value={protocol} onValueChange={(value) => updateProviderProtocol(provider.id, normalizeSearchProtocol(value))}>
                        <SelectTrigger id={`search-provider-protocol-${provider.id}`} className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {(Object.keys(PROTOCOL_LABELS) as CustomSearchProviderProtocol[]).map((value) => (
                              <SelectItem key={value} value={value}>{PROTOCOL_LABELS[value]}</SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <FieldDescription>{PROTOCOL_DESCRIPTIONS[protocol]}</FieldDescription>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`search-provider-url-${provider.id}`}>Base URL</FieldLabel>
                      <Input
                        id={`search-provider-url-${provider.id}`}
                        type="url"
                        value={provider.baseUrl}
                        onChange={(event) => updateProvider(provider.id, { baseUrl: event.currentTarget.value })}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`search-provider-key-${provider.id}`}>API Key</FieldLabel>
                      <Input
                        id={`search-provider-key-${provider.id}`}
                        type="password"
                        autoComplete="new-password"
                        value={provider.apiKey ?? ""}
                        onChange={(event) => updateProvider(provider.id, { apiKey: event.currentTarget.value || undefined })}
                      />
                      <FieldDescription>掩码值原样保存时，Runtime 会保留已有密钥。</FieldDescription>
                    </Field>
                    <OptionalNumberField
                      id={`search-provider-timeout-${provider.id}`}
                      label="供应商超时（毫秒）"
                      value={provider.timeoutMs}
                      min={1000}
                      max={300000}
                      onChange={(timeoutMs) => updateProvider(provider.id, { timeoutMs })}
                    />
                    <Field orientation="horizontal">
                      <FieldContent>
                        <FieldTitle>禁用供应商</FieldTitle>
                        <FieldDescription>保留配置，但阻止对应渠道调用此供应商。</FieldDescription>
                      </FieldContent>
                      <Switch
                        aria-label={`禁用搜索供应商 ${provider.name || provider.id}`}
                        checked={provider.disabled ?? false}
                        onCheckedChange={(disabled) => updateProvider(provider.id, { disabled })}
                      />
                    </Field>
                  </FieldGroup>
                </CardContent>
              </Card>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>全局限制</CardTitle>
          <CardDescription>在渠道未覆盖超时时使用默认值，并限制返回给 Agent 的搜索文本长度。</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup className="grid md:grid-cols-2">
            <NumberField
              id="search-default-timeout"
              label="默认超时（毫秒）"
              description="允许范围 1,000–300,000 毫秒。"
              value={draft.defaultTimeoutMs}
              min={1000}
              max={300000}
              onChange={(defaultTimeoutMs) => setDraft({ ...draft, defaultTimeoutMs })}
            />
            <NumberField
              id="search-max-output"
              label="最大输出字符数"
              description="允许范围 1,000–100,000 字符。"
              value={draft.maxOutputChars}
              min={1000}
              max={100000}
              onChange={(maxOutputChars) => setDraft({ ...draft, maxOutputChars })}
            />
          </FieldGroup>
        </CardContent>
      </Card>
    </div>
  );
}

function NumberField({ id, label, description, value, min, max, onChange }: {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly onChange: (value: number) => void;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(clampNumber(event.currentTarget.value, min, max, value))}
      />
      {description ? <FieldDescription>{description}</FieldDescription> : null}
    </Field>
  );
}

function OptionalNumberField({ id, label, description, value, min, max, onChange }: {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly value: number | undefined;
  readonly min: number;
  readonly max: number;
  readonly onChange: (value: number | undefined) => void;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        value={value ?? ""}
        onChange={(event) => onChange(
          event.currentTarget.value
            ? clampNumber(event.currentTarget.value, min, max, DEFAULT_SEARCH_TIMEOUT_MS)
            : undefined,
        )}
      />
      {description ? <FieldDescription>{description}</FieldDescription> : null}
    </Field>
  );
}
