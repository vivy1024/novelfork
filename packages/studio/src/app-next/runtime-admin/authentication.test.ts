import { describe, expect, it, vi } from "vitest";
import {
  AuthenticationConfigValidationError,
  createAuthenticationClient,
  isMaskedAuthenticationSecret,
  prepareAuthenticationConfigPatch,
  validateAuthenticationConfig,
  type AuthenticationConfig,
} from "./authentication";

const runtimeConfig: AuthenticationConfig = {
  oidcProviders: [{
    id: "corp-okta",
    name: "Company SSO",
    issuer: "https://idp.example.com",
    clientId: "client-123",
    clientSecret: "********tail",
    scopes: ["openid", "profile", "email"],
    allowSignup: true,
    allowedEmailDomains: ["example.com"],
    enabled: true,
  }],
  webauthn: {
    rpID: "narrafork.example.com",
    rpName: "NarraFork",
    origins: ["https://narrafork.example.com"],
  },
};

function createFetchMock() {
  return vi.fn(async () => new Response(JSON.stringify(runtimeConfig), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }));
}

function requestAt(fetchMock: ReturnType<typeof createFetchMock>, index: number) {
  return fetchMock.mock.calls[index] as unknown as [string, RequestInit];
}

describe("authentication runtime admin client", () => {
  it("reads the complete OIDC and WebAuthn configuration from the Runtime", async () => {
    const fetchMock = createFetchMock();
    const client = createAuthenticationClient({ fetchImpl: fetchMock as unknown as typeof fetch });

    await expect(client.get()).resolves.toEqual(runtimeConfig);

    const [path, init] = requestAt(fetchMock, 0);
    expect(path).toBe("/api/admin/auth-config");
    expect(init.method ?? "GET").toBe("GET");
  });

  it("PATCHes normalized OIDC and WebAuthn values while omitting an unchanged masked secret", async () => {
    const fetchMock = createFetchMock();
    const client = createAuthenticationClient({ fetchImpl: fetchMock as unknown as typeof fetch });

    await client.patch({
      oidcProviders: [{
        ...runtimeConfig.oidcProviders[0],
        name: "  Company Login  ",
        scopes: [" openid ", " email"],
        allowedEmailDomains: [" example.com "],
      }],
      webauthn: {
        rpID: " narrafork.example.com ",
        rpName: " NarraFork Studio ",
        origins: [" https://narrafork.example.com "],
      },
    }, { existingProviderIds: new Set(["corp-okta"]) });

    const [path, init] = requestAt(fetchMock, 0);
    expect(path).toBe("/api/admin/auth-config");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({
      oidcProviders: [{
        id: "corp-okta",
        name: "Company Login",
        issuer: "https://idp.example.com",
        clientId: "client-123",
        scopes: ["openid", "email"],
        allowSignup: true,
        allowedEmailDomains: ["example.com"],
        enabled: true,
      }],
      webauthn: {
        rpID: "narrafork.example.com",
        rpName: "NarraFork Studio",
        origins: ["https://narrafork.example.com"],
      },
    });
  });

  it("sends a newly entered secret but preserves server-compatible masked values without context", () => {
    expect(isMaskedAuthenticationSecret("********tail")).toBe(true);
    expect(isMaskedAuthenticationSecret("real*secret")).toBe(false);

    expect(prepareAuthenticationConfigPatch(runtimeConfig).oidcProviders[0]?.clientSecret).toBe("********tail");
    expect(prepareAuthenticationConfigPatch({
      oidcProviders: [{
        ...runtimeConfig.oidcProviders[0],
        clientSecret: "replacement-secret",
      }],
    }, { existingProviderIds: new Set(["corp-okta"]) }).oidcProviders[0]?.clientSecret).toBe("replacement-secret");
  });
});

describe("authentication configuration validation", () => {
  it("reports required fields, invalid IDs and issuers, duplicate IDs, and missing new secrets", () => {
    const issues = validateAuthenticationConfig({
      oidcProviders: [
        {
          id: "Corp Login",
          name: "",
          issuer: "idp.example.com",
          clientId: "",
          clientSecret: "",
        },
        {
          id: "Corp Login",
          name: "Second",
          issuer: "ftp://idp.example.com",
          clientId: "client",
          clientSecret: "********tail",
        },
      ],
    }, { existingProviderIds: new Set() });

    expect(issues.map((issue) => issue.path)).toEqual(expect.arrayContaining([
      "oidcProviders.0",
      "oidcProviders.0.id",
      "oidcProviders.0.issuer",
      "oidcProviders.0.clientSecret",
      "oidcProviders.1.id",
      "oidcProviders.1.issuer",
      "oidcProviders.1.clientSecret",
    ]));
  });

  it("validates WebAuthn RP IDs and exact HTTP(S) origins", () => {
    const issues = validateAuthenticationConfig({
      oidcProviders: [],
      webauthn: {
        rpID: "https://narrafork.example.com:443/path",
        rpName: "NarraFork",
        origins: ["https://narrafork.example.com/passkeys", "javascript:alert(1)"],
      },
    });

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "webauthn.rpID" }),
      expect.objectContaining({ path: "webauthn.origins" }),
    ]));
  });

  it("rejects invalid configuration before any PATCH is sent", async () => {
    const fetchMock = createFetchMock();
    const client = createAuthenticationClient({ fetchImpl: fetchMock as unknown as typeof fetch });

    await expect(client.patch({
      oidcProviders: [{
        id: "new-provider",
        name: "New Provider",
        issuer: "https://idp.example.com",
        clientId: "client",
      }],
    }, { existingProviderIds: new Set() })).rejects.toBeInstanceOf(AuthenticationConfigValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
