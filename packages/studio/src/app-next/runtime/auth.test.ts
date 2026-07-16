import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  RUNTIME_AUTH_API_PATHS,
  RUNTIME_TOKEN_STORAGE_KEY,
  clearRuntimeAuthentication,
  isUserCancelledWebAuthn,
  runtimeFetch,
  runtimeSsoStartUrl,
  setRuntimeToken,
  subscribeRuntimeAuthInvalidation,
} from "./auth";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: new MemoryStorage() });
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: new MemoryStorage() });
});

describe("Runtime authentication transport", () => {
  it("exports the Runtime-owned authentication endpoint constants", () => {
    expect(RUNTIME_AUTH_API_PATHS).toEqual({
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
    });
  });

  it("encodes SSO provider ids without allowing path traversal", () => {
    expect(runtimeSsoStartUrl("company/sso")).toBe("/api/auth/sso/company%2Fsso/start");
  });

  it("injects the shared Runtime bearer token on product requests", async () => {
    setRuntimeToken("runtime-token");
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));

    await runtimeFetch("/api/novelfork/bootstrap", {}, { fetchImpl });

    const [, init] = fetchImpl.mock.calls[0] ?? [];
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer runtime-token");
  });

  it("clears only Runtime auth/cache state and broadcasts on a 401", async () => {
    setRuntimeToken("expired-token");
    localStorage.setItem("novelfork:runtime:bootstrap", "cached");
    sessionStorage.setItem("novelfork:runtime:cursor", "cached");
    localStorage.setItem("novelfork:author-preference", "keep");
    const invalidated = vi.fn();
    const unsubscribe = subscribeRuntimeAuthInvalidation(invalidated);

    await runtimeFetch("/api/novelfork/bootstrap", {}, {
      fetchImpl: async () => new Response(JSON.stringify({ error: "expired" }), { status: 401 }),
    });

    expect(localStorage.getItem(RUNTIME_TOKEN_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem("novelfork:runtime:bootstrap")).toBeNull();
    expect(sessionStorage.getItem("novelfork:runtime:cursor")).toBeNull();
    expect(localStorage.getItem("novelfork:author-preference")).toBe("keep");
    expect(invalidated).toHaveBeenCalledWith("unauthorized");
    unsubscribe();
  });

  it("clears Runtime state on explicit logout while preserving author preferences", () => {
    setRuntimeToken("session-token");
    localStorage.setItem("novelfork:runtime:recent", "drop");
    localStorage.setItem("novelfork:author-preference", "keep");
    clearRuntimeAuthentication("logout");
    expect(localStorage.getItem(RUNTIME_TOKEN_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem("novelfork:runtime:recent")).toBeNull();
    expect(localStorage.getItem("novelfork:author-preference")).toBe("keep");
  });

  it("recognizes browser cancellation and timeout without treating it as a credential failure", () => {
    expect(isUserCancelledWebAuthn({ name: "NotAllowedError" })).toBe(true);
    expect(isUserCancelledWebAuthn({ name: "AbortError" })).toBe(true);
    expect(isUserCancelledWebAuthn({ name: "InvalidStateError" })).toBe(false);
  });
});
