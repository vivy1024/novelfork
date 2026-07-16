import { describe, expect, it, vi } from "vitest";
import { createSecurityClient, isSafeAuthorizeUrl } from "./security";

function createFetchMock() {
  return vi.fn(async (path: string) => {
    let body: unknown = { ok: true };
    if (path.endsWith("/security")) {
      body = { mfaEnabled: false, totpEnabled: false, backupCodesRemaining: 0, passkeyCount: 1 };
    } else if (path.endsWith("/passkeys")) {
      body = { passkeys: [] };
    } else if (path.endsWith("/providers")) {
      body = { providers: [] };
    } else if (path.endsWith("/identities")) {
      body = { identities: [] };
    } else if (path.endsWith("/totp/setup")) {
      body = { secret: "secret", uri: "otpauth://totp/test", qrDataUrl: "data:image/png;base64,AA==" };
    } else if (path.endsWith("/totp/activate")) {
      body = { ok: true, backupCodes: ["backup-1"] };
    } else if (path.endsWith("/link/start")) {
      body = { authorizeUrl: "https://idp.example/authorize" };
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}

function expectRequest(
  fetchMock: ReturnType<typeof createFetchMock>,
  index: number,
  expected: { path: string; method?: string; body?: unknown },
) {
  const [path, init] = fetchMock.mock.calls[index] as unknown as [string, RequestInit];
  expect(path).toBe(expected.path);
  expect(init.method ?? "GET").toBe(expected.method ?? "GET");
  if ("body" in expected) {
    expect(JSON.parse(String(init.body))).toEqual(expected.body);
  } else {
    expect(init.body).toBeUndefined();
  }
}

describe("security client", () => {
  it("uses the Runtime auth security contract and encodes identity IDs", async () => {
    const fetchMock = createFetchMock();
    const client = createSecurityClient({ fetchImpl: fetchMock as unknown as typeof fetch });

    await client.getSnapshot();
    await client.setMfaEnabled(true);
    await client.setupTotp();
    await client.activateTotp("123456");
    await client.disableTotp({ code: "backup-code" });
    await client.renamePasskey("passkey/a b", "Laptop");
    await client.deletePasskey("passkey/a b");
    await client.startIdentityLink("oidc/a b");
    await client.unlinkIdentity("identity/a b");

    expectRequest(fetchMock, 0, { path: "/api/auth/me/security" });
    expectRequest(fetchMock, 1, { path: "/api/auth/me/passkeys" });
    expectRequest(fetchMock, 2, { path: "/api/auth/sso/providers" });
    expectRequest(fetchMock, 3, { path: "/api/auth/me/identities" });
    expectRequest(fetchMock, 4, { path: "/api/auth/me/mfa", method: "PATCH", body: { enabled: true } });
    expectRequest(fetchMock, 5, { path: "/api/auth/me/totp/setup", method: "POST" });
    expectRequest(fetchMock, 6, { path: "/api/auth/me/totp/activate", method: "POST", body: { code: "123456" } });
    expectRequest(fetchMock, 7, { path: "/api/auth/me/totp", method: "DELETE", body: { code: "backup-code" } });
    expectRequest(fetchMock, 8, { path: "/api/auth/me/passkeys/passkey%2Fa%20b", method: "PATCH", body: { name: "Laptop" } });
    expectRequest(fetchMock, 9, { path: "/api/auth/me/passkeys/passkey%2Fa%20b", method: "DELETE" });
    expectRequest(fetchMock, 10, { path: "/api/auth/sso/oidc%2Fa%20b/link/start", method: "POST" });
    expectRequest(fetchMock, 11, { path: "/api/auth/me/identities/identity%2Fa%20b", method: "DELETE" });
  });

  it("accepts only HTTP(S) SSO authorization URLs", () => {
    expect(isSafeAuthorizeUrl("https://idp.example/authorize", "https://studio.example")).toBe(true);
    expect(isSafeAuthorizeUrl("/api/auth/sso/callback", "http://localhost:4567")).toBe(true);
    expect(isSafeAuthorizeUrl("javascript:alert(1)", "https://studio.example")).toBe(false);
    expect(isSafeAuthorizeUrl("not a url", "not a base")).toBe(false);
  });
});
