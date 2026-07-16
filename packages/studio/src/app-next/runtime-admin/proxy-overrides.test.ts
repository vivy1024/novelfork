import { describe, expect, it, vi } from "vitest";
import { createProxyOverridesClient } from "./proxy-overrides";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function requestBody(fetchMock: ReturnType<typeof vi.fn>, index: number): unknown {
  const [, init] = fetchMock.mock.calls[index] as [string, RequestInit];
  return JSON.parse(String(init.body));
}

describe("proxy overrides client", () => {
  it("loads global, provider, Gateway, and HTTP Hook proxy policies from real Runtime routes", async () => {
    const fetchMock = vi.fn(async (path: string) => {
      if (path === "/api/settings") {
        return jsonResponse({
          proxy: { mode: "custom", url: "http://127.0.0.1:7890" },
          kiro: { proxy: { mode: "direct" } },
          codex: {},
          customApiProviders: [
            { id: "provider-1", name: "Provider One", prefix: "p1", apiKey: "********1234", proxy: { mode: "system" } },
          ],
          nugProviders: [],
          clineProviders: [],
        });
      }
      if (path === "/api/user-preferences") {
        return jsonResponse({
          gatewayConfig: {
            enabled: true,
            platforms: [{ platform: "telegram", enabled: true, token: "********5678", proxy: { mode: "direct" } }],
          },
        });
      }
      if (path === "/api/hooks/all") {
        return jsonResponse([
          { id: "http-hook", type: "http", url: "https://example.com/hook", projectId: null, proxyMode: "custom", proxyUrl: "socks5://127.0.0.1:1080" },
          { id: "command-hook", type: "command", projectId: null },
        ]);
      }
      throw new Error(`unexpected path ${path}`);
    });

    const snapshot = await createProxyOverridesClient({ fetchImpl: fetchMock as unknown as typeof fetch }).get();

    expect(snapshot.outbound).toEqual({ mode: "custom", url: "http://127.0.0.1:7890" });
    expect(snapshot.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "builtin", key: "kiro", proxy: { mode: "direct" } }),
      expect.objectContaining({ kind: "provider", id: "provider-1", badge: "Custom API", proxy: { mode: "system" } }),
    ]));
    expect(snapshot.gateways).toEqual([{ platform: "telegram", proxy: { mode: "direct" } }]);
    expect(snapshot.hooks).toEqual([
      { id: "http-hook", name: "https://example.com/hook", scope: "global", proxy: { mode: "custom", url: "socks5://127.0.0.1:1080" } },
    ]);
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(expect.arrayContaining([
      "/api/settings",
      "/api/user-preferences",
      "/api/hooks/all",
    ]));
  });

  it("refreshes provider state before replacing an array and preserves masked secrets verbatim", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        customApiProviders: [
          { id: "provider-1", name: "Provider One", prefix: "p1", apiKey: "********1234", baseUrl: "https://api.example.com" },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({}));
    const client = createProxyOverridesClient({ fetchImpl: fetchMock as unknown as typeof fetch });

    await client.updateProvider(
      {
        kind: "provider",
        section: "customApiProviders",
        id: "provider-1",
        name: "Provider One",
        badge: "Custom API",
        proxy: { mode: "default" },
      },
      { mode: "custom", url: "  http://127.0.0.1:7890  " },
    );

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/settings");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/settings");
    expect(requestBody(fetchMock, 1)).toEqual({
      customApiProviders: [
        {
          id: "provider-1",
          name: "Provider One",
          prefix: "p1",
          apiKey: "********1234",
          baseUrl: "https://api.example.com",
          proxy: { mode: "custom", url: "http://127.0.0.1:7890" },
        },
      ],
    });
    expect(JSON.stringify(requestBody(fetchMock, 1))).not.toContain("real-secret");
  });

  it("round-trips masked Gateway credentials and reloads only the affected platform", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        gatewayConfig: {
          enabled: true,
          platforms: [
            { platform: "telegram", enabled: true, token: "********5678", proxy: { mode: "direct" } },
          ],
        },
      }))
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = createProxyOverridesClient({ fetchImpl: fetchMock as unknown as typeof fetch });

    await client.updateGateway("telegram", { mode: "system" });

    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/user-preferences");
    expect(requestBody(fetchMock, 1)).toEqual({
      gatewayConfig: {
        enabled: true,
        platforms: [
          { platform: "telegram", enabled: true, token: "********5678", proxy: { mode: "system" } },
        ],
      },
    });
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/gateway/reload");
    expect(requestBody(fetchMock, 2)).toEqual({ platforms: ["telegram"] });
  });

  it("updates Hook proxy fields without resending headers or other Hook secrets", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    const client = createProxyOverridesClient({ fetchImpl: fetchMock as unknown as typeof fetch });

    await client.updateHook("hook / 中文", { mode: "default" });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/hooks/hook%20%2F%20%E4%B8%AD%E6%96%87");
    expect(requestBody(fetchMock, 0)).toEqual({ proxyMode: null, proxyUrl: null });
  });
});
