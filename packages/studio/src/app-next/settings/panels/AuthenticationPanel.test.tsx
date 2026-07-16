import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAuthenticationClient,
  type AuthenticationConfig,
} from "../../runtime-admin/authentication";
import { AuthenticationPanel } from "./AuthenticationPanel";

const initialConfig: AuthenticationConfig = {
  oidcProviders: [{
    id: "corp-okta",
    name: "Company SSO",
    issuer: "https://idp.example.com",
    clientId: "client-123",
    clientSecret: "********tail",
    scopes: ["openid", "profile", "email"],
    allowSignup: true,
    allowedEmailDomains: ["example.com", "corp.example.com"],
    enabled: true,
  }],
  webauthn: {
    rpID: "narrafork.example.com",
    rpName: "NarraFork",
    origins: ["https://narrafork.example.com"],
  },
};

function createRuntimeClient(config: AuthenticationConfig = initialConfig) {
  const fetchMock = vi.fn(async (_path: string, init: RequestInit = {}) => {
    const response = init.method === "PATCH"
      ? JSON.parse(String(init.body)) as AuthenticationConfig
      : config;
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  return {
    client: createAuthenticationClient({ fetchImpl: fetchMock as unknown as typeof fetch }),
    fetchMock,
  };
}

function patchBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const patchCall = fetchMock.mock.calls.find((call) => (call[1] as RequestInit | undefined)?.method === "PATCH");
  if (!patchCall) throw new Error("Expected a PATCH request");
  return JSON.parse(String((patchCall[1] as RequestInit).body)) as Record<string, unknown>;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AuthenticationPanel", () => {
  it("reads OIDC providers, masked secrets, and WebAuthn RP settings from the real Runtime client", async () => {
    const { client, fetchMock } = createRuntimeClient();
    render(<AuthenticationPanel client={client} />);

    expect(await screen.findByRole("heading", { name: "实例认证" })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/admin/auth-config");
    expect(screen.getByLabelText("提供方 1 ID")).toHaveProperty("value", "corp-okta");
    expect(screen.getByLabelText("提供方 1 ID")).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("提供方 1 Client Secret")).toHaveProperty("value", "********tail");
    expect(screen.getByLabelText("提供方 1 Scopes")).toHaveProperty("value", "openid, profile, email");
    expect(screen.getByLabelText("提供方 1 允许的邮箱域名")).toHaveProperty("value", "example.com, corp.example.com");
    expect(screen.getByLabelText("WebAuthn RP ID")).toHaveProperty("value", "narrafork.example.com");
    expect(screen.getByLabelText("WebAuthn 显示名称")).toHaveProperty("value", "NarraFork");
    expect(screen.getByLabelText("WebAuthn Origins")).toHaveProperty("value", "https://narrafork.example.com");
  });

  it("validates, normalizes, and PATCHes all editable values without resending an unchanged masked secret", async () => {
    const { client, fetchMock } = createRuntimeClient();
    render(<AuthenticationPanel client={client} />);
    await screen.findByDisplayValue("Company SSO");

    fireEvent.change(screen.getByLabelText("提供方 1 名称"), { target: { value: "  Corporate Login  " } });
    fireEvent.change(screen.getByLabelText("提供方 1 Scopes"), { target: { value: "openid, email" } });
    fireEvent.change(screen.getByLabelText("提供方 1 允许的邮箱域名"), { target: { value: "example.com, writers.example.com" } });
    fireEvent.click(screen.getByRole("switch", { name: "允许 Corporate Login 自动注册" }));
    fireEvent.change(screen.getByLabelText("WebAuthn 显示名称"), { target: { value: "  NovelFork  " } });
    fireEvent.change(screen.getByLabelText("WebAuthn Origins"), { target: { value: "https://narrafork.example.com, http://localhost:4567" } });
    fireEvent.click(screen.getByRole("button", { name: "保存认证设置" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(patchBody(fetchMock)).toEqual({
      oidcProviders: [{
        id: "corp-okta",
        name: "Corporate Login",
        issuer: "https://idp.example.com",
        clientId: "client-123",
        scopes: ["openid", "email"],
        allowSignup: false,
        allowedEmailDomains: ["example.com", "writers.example.com"],
        enabled: true,
      }],
      webauthn: {
        rpID: "narrafork.example.com",
        rpName: "NovelFork",
        origins: ["https://narrafork.example.com", "http://localhost:4567"],
      },
    });
  });

  it("requires a real secret for a new provider and sends it after the form is completed", async () => {
    const { client, fetchMock } = createRuntimeClient({ oidcProviders: [], webauthn: null });
    render(<AuthenticationPanel client={client} />);
    await screen.findByText("尚未配置 OIDC 提供方");

    fireEvent.click(screen.getByRole("button", { name: "添加提供方" }));
    fireEvent.change(screen.getByLabelText("提供方 1 ID"), { target: { value: "new-oidc" } });
    fireEvent.change(screen.getByLabelText("提供方 1 名称"), { target: { value: "New Login" } });
    fireEvent.change(screen.getByLabelText("提供方 1 Issuer URL"), { target: { value: "https://login.example.com" } });
    fireEvent.change(screen.getByLabelText("提供方 1 Client ID"), { target: { value: "new-client" } });
    fireEvent.click(screen.getByRole("button", { name: "保存认证设置" }));

    expect((await screen.findAllByText("新 OIDC 提供方 1 必须填写有效的 Client Secret。")).length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("提供方 1 Client Secret"), { target: { value: "new-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "保存认证设置" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect((patchBody(fetchMock).oidcProviders as Array<Record<string, unknown>>)[0]).toEqual(expect.objectContaining({
      id: "new-oidc",
      name: "New Login",
      issuer: "https://login.example.com",
      clientId: "new-client",
      clientSecret: "new-secret",
      scopes: ["openid", "profile", "email"],
    }));
  });

  it("confirms provider removal and PATCHes the resulting provider inventory", async () => {
    const { client, fetchMock } = createRuntimeClient();
    render(<AuthenticationPanel client={client} />);
    await screen.findByDisplayValue("Company SSO");

    fireEvent.click(screen.getByRole("button", { name: "删除 Company SSO" }));
    expect(screen.getByRole("heading", { name: "删除 OIDC 提供方？" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    expect(await screen.findByText("尚未配置 OIDC 提供方")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "保存认证设置" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(patchBody(fetchMock).oidcProviders).toEqual([]);
  });
});
