import { startAuthentication } from "@simplewebauthn/browser";

export const RUNTIME_TOKEN_STORAGE_KEY = "narrafork_token";
export const RUNTIME_AUTH_INVALIDATED_EVENT = "novelfork:runtime-auth-invalidated";

type FetchPreconnect = (
  url: string | URL,
  options?: { dns?: boolean; tcp?: boolean; http?: boolean; https?: boolean },
) => void;

/** Runtime authentication endpoints are owned by the Runtime contract layer. */
export const RUNTIME_AUTH_API_PATHS = {
  status: "/api/auth/status",
  register: "/api/auth/register",
  login: "/api/auth/login",
  verifyMfa: "/api/auth/mfa/verify",
  passkeyLoginOptions: "/api/auth/passkey/login/options",
  passkeyLoginVerify: "/api/auth/passkey/login/verify",
  passkeyMfaOptions: "/api/auth/mfa/passkey/options",
  passkeyMfaVerify: "/api/auth/mfa/passkey/verify",
  ssoProviders: "/api/auth/sso/providers",
  ssoExchange: "/api/auth/sso/exchange",
  currentUser: "/api/auth/me",
} as const;

export class RuntimeHttpError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "RuntimeHttpError";
    this.status = status;
    this.code = code;
  }
}

function isUsableStorage(value: unknown): value is Storage {
  return value !== null
    && typeof value === "object"
    && typeof (value as Partial<Storage>).getItem === "function"
    && typeof (value as Partial<Storage>).setItem === "function"
    && typeof (value as Partial<Storage>).removeItem === "function";
}

function storage(): Storage | null {
  try {
    const candidate = globalThis.localStorage;
    return isUsableStorage(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

function sessionStorageOrNull(): Storage | null {
  try {
    const candidate = globalThis.sessionStorage;
    return isUsableStorage(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

export function getRuntimeToken(): string | null {
  const token = storage()?.getItem(RUNTIME_TOKEN_STORAGE_KEY)?.trim();
  return token || null;
}

export function setRuntimeToken(token: string): void {
  const normalized = token.trim();
  if (!normalized) throw new Error("Runtime token must not be empty");
  storage()?.setItem(RUNTIME_TOKEN_STORAGE_KEY, normalized);
}

/**
 * Runtime caches are deliberately namespaced.  Do not clear generic NovelFork
 * author preferences on an expired Runtime session.
 */
export function clearRuntimeCachedState(): void {
  for (const candidate of [storage(), sessionStorageOrNull()]) {
    if (!candidate) continue;
    const keys: string[] = [];
    for (let index = 0; index < candidate.length; index += 1) {
      const key = candidate.key(index);
      if (key?.startsWith("novelfork:runtime:")) keys.push(key);
    }
    for (const key of keys) candidate.removeItem(key);
  }
}

export function clearRuntimeAuthentication(reason: "unauthorized" | "logout" = "logout"): void {
  storage()?.removeItem(RUNTIME_TOKEN_STORAGE_KEY);
  clearRuntimeCachedState();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(RUNTIME_AUTH_INVALIDATED_EVENT, { detail: { reason } }));
  }
}

export function subscribeRuntimeAuthInvalidation(listener: (reason: "unauthorized" | "logout") => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = (event: Event) => {
    const reason = (event as CustomEvent<{ reason?: "unauthorized" | "logout" }>).detail?.reason ?? "logout";
    listener(reason);
  };
  window.addEventListener(RUNTIME_AUTH_INVALIDATED_EVENT, handler);
  return () => window.removeEventListener(RUNTIME_AUTH_INVALIDATED_EVENT, handler);
}

export interface RuntimeFetchOptions {
  /** Login/MFA failures do not invalidate an already-unrelated page state. */
  readonly invalidateOn401?: boolean;
  readonly token?: string | null;
  readonly fetchImpl?: typeof fetch;
}

export interface RuntimeAuthStatus {
  readonly hasUsers: boolean;
  readonly registrationOpen: boolean;
}

export interface RuntimeSsoProvider {
  readonly id: string;
  readonly name: string;
}

export function isPasskeySupported(): boolean {
  return typeof window !== "undefined"
    && typeof window.PublicKeyCredential !== "undefined"
    && typeof navigator !== "undefined"
    && Boolean(navigator.credentials);
}

export function isUserCancelledWebAuthn(reason: unknown): boolean {
  const name = (reason as { name?: string } | null | undefined)?.name;
  return name === "NotAllowedError" || name === "AbortError";
}

export async function runtimePasskeyLogin(): Promise<RuntimeSessionResponse> {
  const options = await runtimeJson<Parameters<typeof startAuthentication>[0]["optionsJSON"]>(
    RUNTIME_AUTH_API_PATHS.passkeyLoginOptions,
    { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
    { invalidateOn401: false },
  );
  const response = await startAuthentication({ optionsJSON: options });
  return runtimeJson<RuntimeSessionResponse>(RUNTIME_AUTH_API_PATHS.passkeyLoginVerify, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ response }),
  }, { invalidateOn401: false });
}

export async function runtimePasskeyMfaVerify(mfaToken: string): Promise<RuntimeSessionResponse> {
  const options = await runtimeJson<Parameters<typeof startAuthentication>[0]["optionsJSON"]>(
    RUNTIME_AUTH_API_PATHS.passkeyMfaOptions,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mfaToken }) },
    { invalidateOn401: false },
  );
  const response = await startAuthentication({ optionsJSON: options });
  return runtimeJson<RuntimeSessionResponse>(RUNTIME_AUTH_API_PATHS.passkeyMfaVerify, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mfaToken, response }),
  }, { invalidateOn401: false });
}

export function runtimeSsoStartUrl(providerId: string): string {
  return `/api/auth/sso/${encodeURIComponent(providerId)}/start`;
}

export async function runtimeSsoExchange(code: string): Promise<RuntimeSessionResponse> {
  return runtimeJson<RuntimeSessionResponse>(RUNTIME_AUTH_API_PATHS.ssoExchange, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  }, { invalidateOn401: false });
}

export interface RuntimeSessionResponse {
  readonly token?: string;
  readonly user?: { readonly id: string; readonly username: string; readonly role?: "admin" | "user" };
  readonly mfaRequired?: boolean;
  readonly mfaToken?: string;
  readonly methods?: readonly ("totp" | "backup_code" | "passkey")[];
}

let authenticatedFetchInstalled = false;

function isSameOriginApiRequest(input: RequestInfo | URL): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = typeof Request !== "undefined" && input instanceof Request ? input.url : String(input);
    const url = new URL(raw, window.location.href);
    return url.origin === window.location.origin && (url.pathname === "/api" || url.pathname.startsWith("/api/"));
  } catch {
    return false;
  }
}

function shouldInvalidateGlobalUnauthorized(input: RequestInfo | URL): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = typeof Request !== "undefined" && input instanceof Request ? input.url : String(input);
    const url = new URL(raw, window.location.href);
    if (url.origin !== window.location.origin) return false;
    // Public login/register/MFA/SSO failures are expected 401 responses and
    // must remain visible on the auth surface. Only an expired authenticated
    // session or a product API 401 should tear down Runtime UI state.
    const publicAuthPaths = new Set<string>([
      RUNTIME_AUTH_API_PATHS.status,
      RUNTIME_AUTH_API_PATHS.register,
      RUNTIME_AUTH_API_PATHS.login,
      RUNTIME_AUTH_API_PATHS.verifyMfa,
      RUNTIME_AUTH_API_PATHS.passkeyLoginOptions,
      RUNTIME_AUTH_API_PATHS.passkeyLoginVerify,
      RUNTIME_AUTH_API_PATHS.passkeyMfaOptions,
      RUNTIME_AUTH_API_PATHS.passkeyMfaVerify,
      RUNTIME_AUTH_API_PATHS.ssoProviders,
      RUNTIME_AUTH_API_PATHS.ssoExchange,
    ]);
    return !publicAuthPaths.has(url.pathname);
  } catch {
    return false;
  }
}

/**
 * The retained novel-plugin UI still contains direct same-origin fetch calls.
 * Install one browser-level transport shim so those calls use the same Runtime
 * bearer token and invalidation semantics as the typed product clients. External
 * requests are never modified.
 */
export function installRuntimeAuthenticatedFetch(): void {
  if (authenticatedFetchInstalled || typeof window === "undefined") return;
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const wrappedFetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!isSameOriginApiRequest(input)) return nativeFetch(input, init);

      const headers = new Headers(
        typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
      );
      new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
      const token = getRuntimeToken();
      if (token && !headers.has("authorization")) headers.set("authorization", `Bearer ${token}`);

      const response = await nativeFetch(input, { ...init, headers });
      if (response.status === 401 && shouldInvalidateGlobalUnauthorized(input)) {
        clearRuntimeAuthentication("unauthorized");
      }
      return response;
    },
    {
      preconnect:
        (globalThis.fetch as typeof globalThis.fetch & { preconnect?: FetchPreconnect }).preconnect ?? (() => undefined),
    },
  );
  globalThis.fetch = wrappedFetch;
  authenticatedFetchInstalled = true;
}

/**
 * The only product transport. Every authenticated product request gets the
 * existing NarraFork token and an expired token tears down Runtime UI state.
 */
export async function runtimeFetch(input: RequestInfo | URL, init: RequestInit = {}, options: RuntimeFetchOptions = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = options.token === undefined ? getRuntimeToken() : options.token;
  if (token && !headers.has("authorization")) headers.set("authorization", `Bearer ${token}`);

  const response = await (options.fetchImpl ?? fetch)(input, { ...init, headers });
  if (response.status === 401 && options.invalidateOn401 !== false) {
    clearRuntimeAuthentication("unauthorized");
  }
  return response;
}

function errorFromPayload(payload: unknown, fallback: string): { message: string; code?: string } {
  if (!payload || typeof payload !== "object") return { message: fallback };
  const record = payload as Record<string, unknown>;
  if (typeof record.message === "string") return { message: record.message, code: typeof record.code === "string" ? record.code : undefined };
  if (record.error && typeof record.error === "object") {
    const error = record.error as Record<string, unknown>;
    if (typeof error.message === "string") return { message: error.message, code: typeof error.code === "string" ? error.code : undefined };
  }
  if (typeof record.error === "string") return { message: record.error, code: typeof record.code === "string" ? record.code : undefined };
  return { message: fallback, code: typeof record.code === "string" ? record.code : undefined };
}

export async function runtimeJson<T>(path: string, init: RequestInit = {}, options: RuntimeFetchOptions = {}): Promise<T> {
  const response = await runtimeFetch(path, init, options);
  const text = await response.text();
  let payload: unknown = undefined;
  if (text.trim()) {
    try {
      payload = JSON.parse(text);
    } catch {
      if (!response.ok) throw new RuntimeHttpError(text, response.status);
      throw new RuntimeHttpError("Runtime returned invalid JSON", response.status, "INVALID_JSON");
    }
  }
  if (!response.ok) {
    const error = errorFromPayload(payload, `${response.status} ${response.statusText}`.trim());
    throw new RuntimeHttpError(error.message, response.status, error.code);
  }
  return payload as T;
}
