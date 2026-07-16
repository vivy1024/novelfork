import { startRegistration } from "@simplewebauthn/browser";
import {
  createRuntimeAdminRequest,
  encodePathSegment,
  jsonRequest,
  type OkResponse,
  type RuntimeAdminClientOptions,
} from "./client";

export interface SecurityStatus {
  readonly mfaEnabled: boolean;
  readonly totpEnabled: boolean;
  readonly backupCodesRemaining: number;
  readonly passkeyCount: number;
}

export interface TotpSetupResult {
  readonly secret: string;
  readonly uri: string;
  readonly qrDataUrl: string;
}

export interface TotpActivationResult extends OkResponse {
  readonly backupCodes: ReadonlyArray<string>;
}

export interface TotpDisableInput {
  readonly code?: string;
  readonly password?: string;
}

export interface PasskeySummary {
  readonly id: string;
  readonly name: string | null;
  readonly deviceType: string | null;
  readonly backedUp: boolean;
  readonly lastUsedAt: string | null;
  readonly createdAt: string;
}

export interface SsoProvider {
  readonly id: string;
  readonly name: string;
}

export interface SsoIdentity {
  readonly id: string;
  readonly provider: string;
  readonly email: string | null;
  readonly displayName: string | null;
  readonly lastLoginAt: string | null;
  readonly createdAt: string;
}

export interface SecuritySnapshot {
  readonly status: SecurityStatus;
  readonly passkeys: ReadonlyArray<PasskeySummary>;
  readonly providers: ReadonlyArray<SsoProvider>;
  readonly identities: ReadonlyArray<SsoIdentity>;
}

export function isPasskeySupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined" &&
    typeof navigator !== "undefined" &&
    Boolean(navigator.credentials)
  );
}

export function isSafeAuthorizeUrl(value: string, origin?: string): boolean {
  try {
    const base = origin ?? (typeof window === "undefined" ? "http://localhost" : window.location.origin);
    const url = new URL(value, base);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function createSecurityClient(options: RuntimeAdminClientOptions = {}) {
  const request = createRuntimeAdminRequest(options);
  const getStatus = () => request<SecurityStatus>("/api/auth/me/security");
  const listPasskeys = async () =>
    (await request<{ passkeys: PasskeySummary[] }>("/api/auth/me/passkeys")).passkeys;
  const listProviders = async () =>
    (await request<{ providers: SsoProvider[] }>("/api/auth/sso/providers")).providers;
  const listIdentities = async () =>
    (await request<{ identities: SsoIdentity[] }>("/api/auth/me/identities")).identities;

  return {
    getStatus,
    getSnapshot: async (): Promise<SecuritySnapshot> => {
      const [status, passkeys, providers, identities] = await Promise.all([
        getStatus(),
        listPasskeys(),
        listProviders(),
        listIdentities(),
      ]);
      return { status, passkeys, providers, identities };
    },
    setMfaEnabled: (enabled: boolean) =>
      request<{ ok: boolean; mfaEnabled: boolean }>(
        "/api/auth/me/mfa",
        jsonRequest("PATCH", { enabled }),
      ),
    setupTotp: () =>
      request<TotpSetupResult>("/api/auth/me/totp/setup", { method: "POST" }),
    activateTotp: (code: string) =>
      request<TotpActivationResult>(
        "/api/auth/me/totp/activate",
        jsonRequest("POST", { code }),
      ),
    disableTotp: (input: TotpDisableInput) =>
      request<OkResponse>("/api/auth/me/totp", jsonRequest("DELETE", input)),
    listPasskeys,
    registerPasskey: async (name?: string) => {
      const options = await request<Parameters<typeof startRegistration>[0]["optionsJSON"]>(
        "/api/auth/me/passkeys/register/options",
        { method: "POST" },
      );
      const response = await startRegistration({ optionsJSON: options });
      return request<OkResponse>(
        "/api/auth/me/passkeys/register/verify",
        jsonRequest("POST", { response, ...(name?.trim() ? { name: name.trim() } : {}) }),
      );
    },
    renamePasskey: (id: string, name: string) =>
      request<OkResponse>(
        `/api/auth/me/passkeys/${encodePathSegment(id)}`,
        jsonRequest("PATCH", { name }),
      ),
    deletePasskey: (id: string) =>
      request<OkResponse>(`/api/auth/me/passkeys/${encodePathSegment(id)}`, { method: "DELETE" }),
    listProviders,
    listIdentities,
    startIdentityLink: (providerId: string) =>
      request<{ authorizeUrl: string }>(
        `/api/auth/sso/${encodePathSegment(providerId)}/link/start`,
        { method: "POST" },
      ),
    unlinkIdentity: (id: string) =>
      request<OkResponse>(`/api/auth/me/identities/${encodePathSegment(id)}`, { method: "DELETE" }),
  } as const;
}

export type SecurityClient = ReturnType<typeof createSecurityClient>;
