import {
  createRuntimeAdminRequest,
  jsonRequest,
  type RuntimeAdminClientOptions,
} from "./client";

export type MaskedAuthenticationSecret = string;

export interface OidcProviderConfig {
  readonly id: string;
  readonly name: string;
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret?: MaskedAuthenticationSecret;
  readonly scopes?: readonly string[];
  readonly allowSignup?: boolean;
  readonly allowedEmailDomains?: readonly string[];
  readonly enabled?: boolean;
}

export interface WebauthnRelyingPartyConfig {
  readonly rpID?: string;
  readonly rpName?: string;
  readonly origins?: readonly string[];
}

export interface AuthenticationConfig {
  readonly oidcProviders: readonly OidcProviderConfig[];
  readonly webauthn: WebauthnRelyingPartyConfig | null;
}

export interface AuthenticationConfigInput {
  readonly oidcProviders: readonly OidcProviderConfig[];
  readonly webauthn?: WebauthnRelyingPartyConfig | null;
}

export interface AuthenticationValidationOptions {
  /**
   * IDs read from the Runtime before editing. When supplied, providers outside this
   * set are treated as new and must contain an unmasked client secret.
   */
  readonly existingProviderIds?: ReadonlySet<string>;
}

export interface AuthenticationValidationIssue {
  readonly path: string;
  readonly message: string;
}

export class AuthenticationConfigValidationError extends Error {
  readonly issues: readonly AuthenticationValidationIssue[];

  constructor(issues: readonly AuthenticationValidationIssue[]) {
    super(issues[0]?.message ?? "认证配置校验失败");
    this.name = "AuthenticationConfigValidationError";
    this.issues = issues;
  }
}

const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const RP_ID_PATTERN = /^(?=.{1,253}$)(?:localhost|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)$/i;

export function isMaskedAuthenticationSecret(value: string | null | undefined): boolean {
  return Boolean(value?.startsWith("*"));
}

export function splitAuthenticationList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

export function validateAuthenticationConfig(
  input: AuthenticationConfigInput,
  options: AuthenticationValidationOptions = {},
): readonly AuthenticationValidationIssue[] {
  const issues: AuthenticationValidationIssue[] = [];
  const ids = new Set<string>();

  if (input.oidcProviders.length > 20) {
    issues.push({ path: "oidcProviders", message: "OIDC 提供方不能超过 20 个。" });
  }

  input.oidcProviders.forEach((provider, index) => {
    const base = `oidcProviders.${index}`;
    const id = provider.id.trim();
    const name = provider.name.trim();
    const issuer = provider.issuer.trim();
    const clientId = provider.clientId.trim();
    const secret = provider.clientSecret?.trim() ?? "";

    if (!id || !name || !issuer || !clientId) {
      issues.push({
        path: base,
        message: `OIDC 提供方 ${index + 1} 的 ID、名称、Issuer 和 Client ID 均为必填项。`,
      });
    }
    if (id && (!PROVIDER_ID_PATTERN.test(id) || id.length > 40)) {
      issues.push({
        path: `${base}.id`,
        message: `OIDC 提供方 ${index + 1} 的 ID 只能包含小写字母、数字、连字符或下划线，且不能超过 40 个字符。`,
      });
    }
    if (name.length > 80) {
      issues.push({ path: `${base}.name`, message: `OIDC 提供方 ${index + 1} 的名称不能超过 80 个字符。` });
    }
    if (issuer && (!isHttpUrl(issuer) || issuer.length > 512)) {
      issues.push({ path: `${base}.issuer`, message: `OIDC 提供方 ${index + 1} 的 Issuer 必须是合法的 HTTP(S) URL。` });
    }
    if (clientId.length > 256) {
      issues.push({ path: `${base}.clientId`, message: `OIDC 提供方 ${index + 1} 的 Client ID 不能超过 256 个字符。` });
    }
    if (secret.length > 512) {
      issues.push({ path: `${base}.clientSecret`, message: `OIDC 提供方 ${index + 1} 的 Client Secret 不能超过 512 个字符。` });
    }

    const isKnownProvider = options.existingProviderIds?.has(id);
    if (options.existingProviderIds && !isKnownProvider) {
      if (!secret || isMaskedAuthenticationSecret(secret)) {
        issues.push({ path: `${base}.clientSecret`, message: `新 OIDC 提供方 ${index + 1} 必须填写有效的 Client Secret。` });
      }
    }

    if (ids.has(id)) {
      issues.push({ path: `${base}.id`, message: `OIDC 提供方 ID “${id}” 重复。` });
    }
    if (id) ids.add(id);

    const scopes = provider.scopes ?? [];
    if (scopes.length > 20 || scopes.some((scope) => !scope.trim() || scope.trim().length > 64)) {
      issues.push({ path: `${base}.scopes`, message: `OIDC 提供方 ${index + 1} 的 scope 无效（最多 20 个，每个最多 64 个字符）。` });
    }

    const domains = provider.allowedEmailDomains ?? [];
    if (domains.length > 50 || domains.some((domain) => !domain.trim() || domain.trim().length > 253)) {
      issues.push({ path: `${base}.allowedEmailDomains`, message: `OIDC 提供方 ${index + 1} 的允许邮箱域名无效。` });
    }
  });

  const webauthn = input.webauthn;
  if (webauthn) {
    const rpID = webauthn.rpID?.trim() ?? "";
    const rpName = webauthn.rpName?.trim() ?? "";
    const origins = webauthn.origins ?? [];

    if (rpID && !RP_ID_PATTERN.test(rpID)) {
      issues.push({ path: "webauthn.rpID", message: "WebAuthn RP ID 必须是域名，不能包含协议、路径或端口。" });
    }
    if (rpName.length > 80) {
      issues.push({ path: "webauthn.rpName", message: "WebAuthn 显示名称不能超过 80 个字符。" });
    }
    if (origins.length > 20 || origins.some((origin) => origin.length > 512 || !isOrigin(origin.trim()))) {
      issues.push({ path: "webauthn.origins", message: "WebAuthn Origin 必须是完整的 HTTP(S) 来源，且不能包含路径、查询或片段。" });
    }
  }

  return issues;
}

export function prepareAuthenticationConfigPatch(
  input: AuthenticationConfigInput,
  options: AuthenticationValidationOptions = {},
): AuthenticationConfigInput {
  const issues = validateAuthenticationConfig(input, options);
  if (issues.length > 0) throw new AuthenticationConfigValidationError(issues);

  return {
    oidcProviders: input.oidcProviders.map((provider) => {
      const id = provider.id.trim();
      const secret = provider.clientSecret?.trim() ?? "";
      const preserveStoredSecret = options.existingProviderIds?.has(id)
        && (!secret || isMaskedAuthenticationSecret(secret));
      return {
        id,
        name: provider.name.trim(),
        issuer: provider.issuer.trim(),
        clientId: provider.clientId.trim(),
        ...(!preserveStoredSecret && secret ? { clientSecret: secret } : {}),
        scopes: (provider.scopes ?? []).map((scope) => scope.trim()),
        allowSignup: provider.allowSignup ?? false,
        allowedEmailDomains: (provider.allowedEmailDomains ?? []).map((domain) => domain.trim()),
        enabled: provider.enabled ?? true,
      };
    }),
    webauthn: input.webauthn
      ? {
          ...(input.webauthn.rpID?.trim() ? { rpID: input.webauthn.rpID.trim() } : {}),
          ...(input.webauthn.rpName?.trim() ? { rpName: input.webauthn.rpName.trim() } : {}),
          origins: (input.webauthn.origins ?? []).map((origin) => origin.trim()),
        }
      : undefined,
  };
}

export function createAuthenticationClient(options: RuntimeAdminClientOptions = {}) {
  const request = createRuntimeAdminRequest(options);
  return {
    get: () => request<AuthenticationConfig>("/api/admin/auth-config"),
    patch: async (
      input: AuthenticationConfigInput,
      validationOptions: AuthenticationValidationOptions = {},
    ) => request<AuthenticationConfig>(
      "/api/admin/auth-config",
      jsonRequest("PATCH", prepareAuthenticationConfigPatch(input, validationOptions)),
    ),
  } as const;
}

export type AuthenticationClient = ReturnType<typeof createAuthenticationClient>;
