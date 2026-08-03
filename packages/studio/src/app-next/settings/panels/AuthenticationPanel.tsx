import { useCallback, useEffect, useRef, useState } from "react";
import { KeyRound, Plus, ShieldCheck, Trash2 } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { notify } from "@/lib/notify";
import {
  AuthenticationConfigValidationError,
  createAuthenticationClient,
  splitAuthenticationList,
  validateAuthenticationConfig,
  type AuthenticationClient,
  type AuthenticationConfig,
  type AuthenticationConfigInput,
  type AuthenticationValidationIssue,
  type OidcProviderConfig,
} from "../../runtime-admin/authentication";

const defaultAuthenticationClient = createAuthenticationClient();
let draftSequence = 0;

interface ProviderDraft {
  readonly key: string;
  readonly existing: boolean;
  readonly id: string;
  readonly name: string;
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly scopes: string;
  readonly allowedEmailDomains: string;
  readonly allowSignup: boolean;
  readonly enabled: boolean;
}

function createDraftKey(): string {
  draftSequence += 1;
  return `oidc-provider-${draftSequence}`;
}

function toDraft(provider: OidcProviderConfig): ProviderDraft {
  return {
    key: createDraftKey(),
    existing: true,
    id: provider.id,
    name: provider.name,
    issuer: provider.issuer,
    clientId: provider.clientId,
    clientSecret: provider.clientSecret ?? "",
    scopes: (provider.scopes ?? []).join(", "),
    allowedEmailDomains: (provider.allowedEmailDomains ?? []).join(", "),
    allowSignup: provider.allowSignup ?? false,
    enabled: provider.enabled ?? true,
  };
}

function newDraft(): ProviderDraft {
  return {
    key: createDraftKey(),
    existing: false,
    id: "",
    name: "",
    issuer: "",
    clientId: "",
    clientSecret: "",
    scopes: "openid, profile, email",
    allowedEmailDomains: "",
    allowSignup: false,
    enabled: true,
  };
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function draftInput(
  providers: readonly ProviderDraft[],
  rpID: string,
  rpName: string,
  origins: string,
): AuthenticationConfigInput {
  return {
    oidcProviders: providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      issuer: provider.issuer,
      clientId: provider.clientId,
      clientSecret: provider.clientSecret,
      scopes: splitAuthenticationList(provider.scopes),
      allowedEmailDomains: splitAuthenticationList(provider.allowedEmailDomains),
      allowSignup: provider.allowSignup,
      enabled: provider.enabled,
    })),
    webauthn: {
      rpID,
      rpName,
      origins: splitAuthenticationList(origins),
    },
  };
}

function issueFor(issues: readonly AuthenticationValidationIssue[], path: string): string | undefined {
  return issues.find((issue) => issue.path === path || issue.path === path.slice(0, path.lastIndexOf(".")))?.message;
}

export interface AuthenticationPanelProps {
  readonly client?: AuthenticationClient;
}

export function AuthenticationPanel({ client = defaultAuthenticationClient }: AuthenticationPanelProps) {
  const [providers, setProviders] = useState<ProviderDraft[]>([]);
  const [rpID, setRpID] = useState("");
  const [rpName, setRpName] = useState("");
  const [origins, setOrigins] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<readonly AuthenticationValidationIssue[]>([]);
  const [deleteCandidateKey, setDeleteCandidateKey] = useState<string | null>(null);
  const existingProviderIds = useRef<ReadonlySet<string>>(new Set());

  const adoptConfig = useCallback((config: AuthenticationConfig) => {
    existingProviderIds.current = new Set(config.oidcProviders.map((provider) => provider.id));
    setProviders(config.oidcProviders.map(toDraft));
    setRpID(config.webauthn?.rpID ?? "");
    setRpName(config.webauthn?.rpName ?? "");
    setOrigins((config.webauthn?.origins ?? []).join(", "));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      adoptConfig(await client.get());
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }, [adoptConfig, client]);

  useEffect(() => {
    void load();
  }, [load]);

  function patchProvider(key: string, patch: Partial<ProviderDraft>) {
    setProviders((current) => current.map((provider) => (
      provider.key === key ? { ...provider, ...patch } : provider
    )));
    setIssues([]);
  }

  function confirmDeleteProvider() {
    if (!deleteCandidateKey) return;
    setProviders((current) => current.filter((provider) => provider.key !== deleteCandidateKey));
    setDeleteCandidateKey(null);
    setIssues([]);
  }

  async function save() {
    const input = draftInput(providers, rpID, rpName, origins);
    const validationOptions = { existingProviderIds: existingProviderIds.current };
    const nextIssues = validateAuthenticationConfig(input, validationOptions);
    setIssues(nextIssues);
    setError(null);
    if (nextIssues.length > 0) return;

    setSaving(true);
    try {
      const updated = await client.patch(input, validationOptions);
      adoptConfig(updated);
      notify.success("认证设置已保存", {
        description: "OIDC 提供方与 WebAuthn RP 配置已由 Runtime 更新。",
      });
    } catch (reason) {
      const message = reason instanceof AuthenticationConfigValidationError
        ? reason.issues.map((issue) => issue.message).join("；")
        : errorMessage(reason);
      setError(message);
      notify.error("认证设置保存失败", { description: message });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4" aria-label="正在读取实例认证设置">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (error && providers.length === 0 && !rpID && !rpName && !origins) {
    return (
      <Alert>
        <AlertTitle>无法读取实例认证设置</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-3">
          <span>{error}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()}>重试</Button>
        </AlertDescription>
      </Alert>
    );
  }

  const deleteCandidate = providers.find((provider) => provider.key === deleteCandidateKey) ?? null;

  return (
    <div data-slot="authentication-panel" className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">实例认证</h2>
        <p className="text-sm text-muted-foreground">
          配置 Runtime 的 OIDC 登录提供方和 Passkey 所使用的 WebAuthn 依赖方。
        </p>
      </div>

      {error ? (
        <Alert>
          <AlertTitle>认证设置操作失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {issues.length > 0 ? (
        <Alert>
          <AlertTitle>请修正认证配置</AlertTitle>
          <AlertDescription>
            <ul className="flex list-disc flex-col gap-1 pl-4">
              {issues.map((issue) => <li key={`${issue.path}:${issue.message}`}>{issue.message}</li>)}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound />
            OIDC 提供方
          </CardTitle>
          <CardDescription>
            Runtime 在登录页公开已启用提供方的名称；Client Secret 始终以掩码读取，未修改时不会回传覆盖已存密钥。
          </CardDescription>
          <CardAction>
            <Button type="button" variant="outline" size="sm" onClick={() => setProviders((current) => [...current, newDraft()])}>
              <Plus data-icon="inline-start" />
              添加提供方
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {providers.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon"><KeyRound /></EmptyMedia>
                <EmptyTitle>尚未配置 OIDC 提供方</EmptyTitle>
                <EmptyDescription>添加提供方后，用户可以通过实例配置的企业身份系统登录。</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="flex flex-col gap-4">
              {providers.map((provider, index) => {
                const base = `oidcProviders.${index}`;
                return (
                  <Card key={provider.key} size="sm">
                    <CardHeader>
                      <CardTitle>{provider.name.trim() || `OIDC 提供方 ${index + 1}`}</CardTitle>
                      <CardDescription>{provider.id.trim() || "尚未设置提供方 ID"}</CardDescription>
                      <CardAction>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`删除 ${provider.name.trim() || `OIDC 提供方 ${index + 1}`}`}
                          onClick={() => setDeleteCandidateKey(provider.key)}
                        >
                          <Trash2 />
                        </Button>
                      </CardAction>
                    </CardHeader>
                    <CardContent>
                      <FieldGroup>
                        <Field orientation="horizontal">
                          <FieldContent>
                            <FieldTitle>启用提供方</FieldTitle>
                            <FieldDescription>关闭后，登录页不会显示此 OIDC 提供方。</FieldDescription>
                          </FieldContent>
                          <Switch
                            aria-label={`启用 ${provider.name.trim() || `OIDC 提供方 ${index + 1}`}`}
                            checked={provider.enabled}
                            onCheckedChange={(checked) => patchProvider(provider.key, { enabled: checked })}
                          />
                        </Field>

                        <FieldGroup className="grid gap-4 md:grid-cols-2">
                          <Field data-invalid={Boolean(issueFor(issues, `${base}.id`))} data-disabled={provider.existing || undefined}>
                            <FieldLabel htmlFor={`${provider.key}-id`}>提供方 ID</FieldLabel>
                            <Input
                              id={`${provider.key}-id`}
                              aria-label={`提供方 ${index + 1} ID`}
                              aria-invalid={Boolean(issueFor(issues, `${base}.id`))}
                              placeholder="corp-okta"
                              value={provider.id}
                              disabled={provider.existing}
                              onChange={(event) => patchProvider(provider.key, { id: event.currentTarget.value })}
                            />
                            <FieldDescription>稳定的小写标识；已保存后不可修改。</FieldDescription>
                            <FieldError>{issueFor(issues, `${base}.id`)}</FieldError>
                          </Field>
                          <Field data-invalid={Boolean(issueFor(issues, `${base}.name`))}>
                            <FieldLabel htmlFor={`${provider.key}-name`}>显示名称</FieldLabel>
                            <Input
                              id={`${provider.key}-name`}
                              aria-label={`提供方 ${index + 1} 名称`}
                              aria-invalid={Boolean(issueFor(issues, `${base}.name`))}
                              placeholder="Company SSO"
                              value={provider.name}
                              onChange={(event) => patchProvider(provider.key, { name: event.currentTarget.value })}
                            />
                            <FieldError>{issueFor(issues, `${base}.name`)}</FieldError>
                          </Field>
                        </FieldGroup>

                        <Field data-invalid={Boolean(issueFor(issues, `${base}.issuer`))}>
                          <FieldLabel htmlFor={`${provider.key}-issuer`}>Issuer URL</FieldLabel>
                          <Input
                            id={`${provider.key}-issuer`}
                            aria-label={`提供方 ${index + 1} Issuer URL`}
                            aria-invalid={Boolean(issueFor(issues, `${base}.issuer`))}
                            type="url"
                            placeholder="https://idp.example.com"
                            value={provider.issuer}
                            onChange={(event) => patchProvider(provider.key, { issuer: event.currentTarget.value })}
                          />
                          <FieldError>{issueFor(issues, `${base}.issuer`)}</FieldError>
                        </Field>

                        <FieldGroup className="grid gap-4 md:grid-cols-2">
                          <Field data-invalid={Boolean(issueFor(issues, `${base}.clientId`))}>
                            <FieldLabel htmlFor={`${provider.key}-client-id`}>Client ID</FieldLabel>
                            <Input
                              id={`${provider.key}-client-id`}
                              aria-label={`提供方 ${index + 1} Client ID`}
                              aria-invalid={Boolean(issueFor(issues, `${base}.clientId`))}
                              value={provider.clientId}
                              onChange={(event) => patchProvider(provider.key, { clientId: event.currentTarget.value })}
                            />
                            <FieldError>{issueFor(issues, `${base}.clientId`)}</FieldError>
                          </Field>
                          <Field data-invalid={Boolean(issueFor(issues, `${base}.clientSecret`))}>
                            <FieldLabel htmlFor={`${provider.key}-client-secret`}>Client Secret</FieldLabel>
                            <Input
                              id={`${provider.key}-client-secret`}
                              aria-label={`提供方 ${index + 1} Client Secret`}
                              aria-invalid={Boolean(issueFor(issues, `${base}.clientSecret`))}
                              type="password"
                              autoComplete="new-password"
                              placeholder={provider.existing ? "留空或保留掩码以继续使用已存密钥" : ""}
                              value={provider.clientSecret}
                              onChange={(event) => patchProvider(provider.key, { clientSecret: event.currentTarget.value })}
                            />
                            <FieldDescription>{provider.existing ? "只有输入新值时才会替换 Runtime 中的密钥。" : "新提供方必须填写。"}</FieldDescription>
                            <FieldError>{issueFor(issues, `${base}.clientSecret`)}</FieldError>
                          </Field>
                        </FieldGroup>

                        <Field data-invalid={Boolean(issueFor(issues, `${base}.scopes`))}>
                          <FieldLabel htmlFor={`${provider.key}-scopes`}>Scopes</FieldLabel>
                          <Input
                            id={`${provider.key}-scopes`}
                            aria-label={`提供方 ${index + 1} Scopes`}
                            aria-invalid={Boolean(issueFor(issues, `${base}.scopes`))}
                            value={provider.scopes}
                            onChange={(event) => patchProvider(provider.key, { scopes: event.currentTarget.value })}
                          />
                          <FieldDescription>使用逗号分隔，例如 openid, profile, email。</FieldDescription>
                          <FieldError>{issueFor(issues, `${base}.scopes`)}</FieldError>
                        </Field>

                        <Field data-invalid={Boolean(issueFor(issues, `${base}.allowedEmailDomains`))}>
                          <FieldLabel htmlFor={`${provider.key}-domains`}>允许的邮箱域名</FieldLabel>
                          <Input
                            id={`${provider.key}-domains`}
                            aria-label={`提供方 ${index + 1} 允许的邮箱域名`}
                            aria-invalid={Boolean(issueFor(issues, `${base}.allowedEmailDomains`))}
                            placeholder="example.com, corp.example.com"
                            value={provider.allowedEmailDomains}
                            onChange={(event) => patchProvider(provider.key, { allowedEmailDomains: event.currentTarget.value })}
                          />
                          <FieldDescription>留空允许任意邮箱域名；多个域名使用逗号分隔。</FieldDescription>
                          <FieldError>{issueFor(issues, `${base}.allowedEmailDomains`)}</FieldError>
                        </Field>

                        <Field orientation="horizontal">
                          <FieldContent>
                            <FieldTitle>允许自动注册</FieldTitle>
                            <FieldDescription>首次使用此提供方登录时，允许 Runtime 创建新账户。</FieldDescription>
                          </FieldContent>
                          <Switch
                            aria-label={`允许 ${provider.name.trim() || `OIDC 提供方 ${index + 1}`} 自动注册`}
                            checked={provider.allowSignup}
                            onCheckedChange={(checked) => patchProvider(provider.key, { allowSignup: checked })}
                          />
                        </Field>
                      </FieldGroup>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck />
            WebAuthn 依赖方
          </CardTitle>
          <CardDescription>
            可选。留空时 Runtime 按请求推导，适用于 localhost 和局域网；固定反向代理域名才需要显式设置。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <FieldGroup className="grid gap-4 md:grid-cols-2">
              <Field data-invalid={Boolean(issueFor(issues, "webauthn.rpID"))}>
                <FieldLabel htmlFor="authentication-webauthn-rp-id">RP ID</FieldLabel>
                <Input
                  id="authentication-webauthn-rp-id"
                  aria-label="WebAuthn RP ID"
                  aria-invalid={Boolean(issueFor(issues, "webauthn.rpID"))}
                  placeholder="novelfork.example.com"
                  value={rpID}
                  onChange={(event) => { setRpID(event.currentTarget.value); setIssues([]); }}
                />
                <FieldDescription>仅填写域名，不包含协议、路径或端口。</FieldDescription>
                <FieldError>{issueFor(issues, "webauthn.rpID")}</FieldError>
              </Field>
              <Field data-invalid={Boolean(issueFor(issues, "webauthn.rpName"))}>
                <FieldLabel htmlFor="authentication-webauthn-rp-name">显示名称</FieldLabel>
                <Input
                  id="authentication-webauthn-rp-name"
                  aria-label="WebAuthn 显示名称"
                  aria-invalid={Boolean(issueFor(issues, "webauthn.rpName"))}
                  placeholder="NovelFork"
                  value={rpName}
                  onChange={(event) => { setRpName(event.currentTarget.value); setIssues([]); }}
                />
                <FieldError>{issueFor(issues, "webauthn.rpName")}</FieldError>
              </Field>
            </FieldGroup>
            <Field data-invalid={Boolean(issueFor(issues, "webauthn.origins"))}>
              <FieldLabel htmlFor="authentication-webauthn-origins">允许的 Origins</FieldLabel>
              <Input
                id="authentication-webauthn-origins"
                aria-label="WebAuthn Origins"
                aria-invalid={Boolean(issueFor(issues, "webauthn.origins"))}
                placeholder="https://novelfork.example.com"
                value={origins}
                onChange={(event) => { setOrigins(event.currentTarget.value); setIssues([]); }}
              />
              <FieldDescription>逗号分隔的完整 HTTP(S) 来源，不包含路径、查询或片段。</FieldDescription>
              <FieldError>{issueFor(issues, "webauthn.origins")}</FieldError>
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="button" disabled={saving} onClick={() => void save()}>
            {saving ? "保存中…" : "保存认证设置"}
          </Button>
        </CardFooter>
      </Card>

      <Dialog open={deleteCandidate !== null} onOpenChange={(open) => { if (!open) setDeleteCandidateKey(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除 OIDC 提供方？</DialogTitle>
            <DialogDescription>
              {deleteCandidate
                ? `保存后将从 Runtime 移除“${deleteCandidate.name.trim() || deleteCandidate.id || "未命名提供方"}”。`
                : "保存后将从 Runtime 移除所选提供方。"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteCandidateKey(null)}>取消</Button>
            <Button type="button" variant="destructive" onClick={confirmDeleteProvider}>
              <Trash2 data-icon="inline-start" />
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
