import { describe, expect, it, vi } from "vitest";
import {
  createSearchSettingsClient,
  normalizeSearchProtocol,
  normalizeSearchSettings,
  protocolDefaultBaseUrl,
  SEARCH_PROTOCOL_BASE_URLS,
} from "./search-settings";

function createFetchMock(response: unknown = {}) {
  return vi.fn(async () =>
    new Response(JSON.stringify(response), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
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

describe("search settings client", () => {
  it("uses the migrated Runtime settings and real channel-test routes", async () => {
    const fetchMock = createFetchMock({});
    const client = createSearchSettingsClient({ fetchImpl: fetchMock as unknown as typeof fetch });
    const search = {
      channels: [
        { id: "native", kind: "native" as const, enabled: true },
        { id: "custom:tavily", kind: "custom-api" as const, providerId: "tavily", enabled: true },
      ],
      customProviders: [
        {
          id: "tavily",
          name: "Tavily",
          protocol: "tavily-mcp" as const,
          baseUrl: "https://mcp.tavily.com/mcp/",
          apiKey: "secret",
        },
      ],
      defaultTimeoutMs: 45_000,
      maxOutputChars: 32_000,
    };

    await client.get();
    await client.save(search);
    await client.testChannel({
      channelId: "custom:tavily",
      query: "最新 AI 新闻",
      purpose: "验证来源",
    });

    expectRequest(fetchMock, 0, { path: "/api/settings" });
    expectRequest(fetchMock, 1, {
      path: "/api/settings",
      method: "PATCH",
      body: { search },
    });
    expectRequest(fetchMock, 2, {
      path: "/api/settings/search/test",
      method: "POST",
      body: {
        channelId: "custom:tavily",
        query: "最新 AI 新闻",
        purpose: "验证来源",
      },
    });
  });

  it("normalizes missing defaults and protocol base URLs from Runtime responses", () => {
    expect(normalizeSearchSettings({
      search: {
        channels: [],
        customProviders: [
          {
            id: "zhipu",
            name: "智谱搜索",
            protocol: "zhipu-web-search-v1",
            baseUrl: "",
          },
        ],
      },
    })).toEqual({
      channels: [],
      customProviders: [
        {
          id: "zhipu",
          name: "智谱搜索",
          protocol: "zhipu-web-search-v1",
          baseUrl: SEARCH_PROTOCOL_BASE_URLS["zhipu-web-search-v1"],
          headers: undefined,
          options: undefined,
        },
      ],
      defaultTimeoutMs: 60_000,
      maxOutputChars: 24_000,
    });
  });

  it("保留 Runtime 新增协议，不在注册表未加载时改写为默认协议", () => {
    // A provider configured against a newer Runtime must survive a save round-trip
    // even before the protocol registry response arrives.
    expect(normalizeSearchProtocol("bocha")).toBe("bocha");
    expect(normalizeSearchProtocol("custom-http")).toBe("custom-http");
    expect(normalizeSearchProtocol("")).toBe("zhipu-web-search-v1");
    expect(normalizeSearchProtocol(undefined)).toBe("zhipu-web-search-v1");
  });

  it("已知协议集给定时才把未知协议回落到默认协议", () => {
    const known = ["zhipu-web-search-v1", "tavily-mcp", "bocha"];
    expect(normalizeSearchProtocol("bocha", known)).toBe("bocha");
    expect(normalizeSearchProtocol("retired-protocol", known)).toBe("zhipu-web-search-v1");
    // An empty registry means "not loaded yet", not "nothing is valid".
    expect(normalizeSearchProtocol("retired-protocol", [])).toBe("retired-protocol");
  });

  it("默认 Base URL 优先取注册表，其次取内置回退表", () => {
    const registry = [
      {
        id: "bocha",
        label: { en: "Bocha", "zh-CN": "博查" },
        description: { en: "", "zh-CN": "" },
        defaultBaseUrl: "https://api.bochaai.com/v1",
      },
    ];
    expect(protocolDefaultBaseUrl("bocha", registry)).toBe("https://api.bochaai.com/v1");
    expect(protocolDefaultBaseUrl("zhipu-web-search-v1", registry)).toBe(
      SEARCH_PROTOCOL_BASE_URLS["zhipu-web-search-v1"],
    );
    expect(protocolDefaultBaseUrl("unknown-protocol", registry)).toBe("");
  });

  it("协议注册表通过 Runtime 端点获取", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([]), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const client = createSearchSettingsClient({ fetchImpl: fetchImpl as unknown as typeof fetch });

    await client.listProtocols();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("/api/settings/search/protocols");
  });
});
