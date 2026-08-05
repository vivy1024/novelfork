import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  SearchSettings,
  SearchSettingsClient,
  SearchSettingsResponse,
} from "../../runtime-admin/search-settings";

const notifyMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/lib/notify", () => ({ notify: notifyMock }));

import { SearchSettingsPanel } from "./SearchSettingsPanel";

const initialSearch: SearchSettings = {
  channels: [
    { id: "native", kind: "native", enabled: true },
    {
      id: "custom:tavily",
      kind: "custom-api",
      providerId: "tavily",
      enabled: true,
      timeoutMs: 20_000,
    },
    {
      id: "subagent",
      kind: "subagent",
      enabled: true,
      model: "codex:gpt-5",
      reasoningEffort: "high",
      maxTurns: 4,
    },
  ],
  customProviders: [
    {
      id: "tavily",
      name: "Tavily 搜索",
      protocol: "tavily-mcp",
      baseUrl: "https://mcp.tavily.com/mcp/",
      apiKey: "********abcd",
      timeoutMs: 30_000,
    },
  ],
  defaultTimeoutMs: 60_000,
  maxOutputChars: 24_000,
};

const runtimeResponse: SearchSettingsResponse = {
  search: initialSearch,
  codexModels: [{ id: "gpt-5", name: "GPT-5" }],
  nugProviders: [{ id: "nug-1", name: "NUG One", prefix: "nug" }],
};

/** Mirrors the Runtime adapter registry (`GET /api/settings/search/protocols`). */
const protocolRegistry = [
  {
    id: "zhipu-web-search-v1",
    label: { en: "Zhipu Web Search", "zh-CN": "智谱 Web Search" },
    description: { en: "Zhipu official web search API.", "zh-CN": "调用智谱官方网络搜索 API。" },
    defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
  },
  {
    id: "tavily-mcp",
    label: { en: "Tavily MCP", "zh-CN": "Tavily MCP" },
    description: { en: "Tavily MCP server.", "zh-CN": "通过 Tavily 官方 MCP Server 调用。" },
    defaultBaseUrl: "https://mcp.tavily.com/mcp/",
  },
  {
    id: "bocha",
    label: { en: "Bocha AI Search", "zh-CN": "博查 AI 搜索" },
    description: { en: "Bocha AI search API.", "zh-CN": "调用博查 AI 搜索 API。" },
    defaultBaseUrl: "https://api.bochaai.com/v1",
  },
  {
    id: "unifuncs",
    label: { en: "UniFuncs", "zh-CN": "U深搜 (UniFuncs)" },
    description: { en: "UniFuncs web search.", "zh-CN": "调用 U深搜网络搜索 API。" },
    defaultBaseUrl: "https://api.unifuncs.com",
  },
  {
    id: "custom-http",
    label: { en: "Custom HTTP", "zh-CN": "自定义 HTTP" },
    description: { en: "Fully custom HTTP adapter.", "zh-CN": "完全自定义的 HTTP 搜索适配器。" },
    defaultBaseUrl: "https://example.com/search",
  },
];

function createClient() {
  const get = vi.fn(async () => runtimeResponse);
  const save = vi.fn(async (search: SearchSettings) => ({ ...runtimeResponse, search }));
  const listProtocols = vi.fn(async () => protocolRegistry);
  const testChannel = vi.fn(async () => ({
    text: "搜索成功，来源：https://example.com",
    channelId: "custom:tavily",
    channelLabel: "Tavily 搜索",
    attempts: [],
  }));
  return { get, save, listProtocols, testChannel } as unknown as SearchSettingsClient;
}

let client: SearchSettingsClient;

beforeEach(() => {
  client = createClient();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Build a client whose settings payload is overridden for a single test. */
function createClientWithSearch(search: SearchSettings): SearchSettingsClient {
  const response = { ...runtimeResponse, search };
  return {
    get: vi.fn(async () => response),
    save: vi.fn(async (next: SearchSettings) => ({ ...response, search: next })),
    listProtocols: vi.fn(async () => protocolRegistry),
    testChannel: vi.fn(async () => ({
      text: "ok",
      channelId: "custom:x",
      channelLabel: "x",
      attempts: [],
    })),
  } as unknown as SearchSettingsClient;
}

describe("SearchSettingsPanel", () => {
  it("loads Runtime search channels, custom providers and global defaults", async () => {
    render(<SearchSettingsPanel client={client} />);

    expect(await screen.findByRole("heading", { name: "搜索" })).toBeTruthy();
    expect(client.get).toHaveBeenCalledTimes(1);
    expect(screen.getByText("模型原生搜索")).toBeTruthy();
    expect(screen.getByText("自定义：Tavily 搜索")).toBeTruthy();
    expect(screen.getByText("搜索子代理")).toBeTruthy();
    expect((screen.getByLabelText("默认超时（毫秒）") as HTMLInputElement).value).toBe("60000");
    expect((screen.getByLabelText("最大输出字符数") as HTMLInputElement).value).toBe("24000");
    expect((screen.getByLabelText("API Key") as HTMLInputElement).value).toBe("********abcd");
    expect((screen.getByRole("button", { name: "测试渠道 native" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("edits channels and limits, then saves only the Runtime search section", async () => {
    render(<SearchSettingsPanel client={client} />);
    await screen.findByText("自定义：Tavily 搜索");

    fireEvent.click(screen.getByLabelText("启用渠道 custom:tavily"));
    fireEvent.click(screen.getByLabelText("上移渠道 custom:tavily"));
    fireEvent.change(screen.getByLabelText("默认超时（毫秒）"), { target: { value: "45000" } });
    fireEvent.change(screen.getByLabelText("最大输出字符数"), { target: { value: "32000" } });
    fireEvent.click(screen.getByRole("button", { name: "保存搜索设置" }));

    await waitFor(() => expect(client.save).toHaveBeenCalledTimes(1));
    const saved = vi.mocked(client.save).mock.calls[0]?.[0];
    expect(saved.defaultTimeoutMs).toBe(45_000);
    expect(saved.maxOutputChars).toBe(32_000);
    expect(saved.channels[0]?.id).toBe("custom:tavily");
    expect(saved.channels[0]?.enabled).toBe(false);
    expect(notifyMock.success).toHaveBeenCalledWith("搜索设置已保存", {
      description: "Runtime 已采用新的搜索渠道顺序与限制。",
    });
  });

  it("adds and edits a custom search provider together with its channel", async () => {
    render(<SearchSettingsPanel client={client} />);
    await screen.findByText("Tavily 搜索");

    fireEvent.click(screen.getAllByRole("button", { name: "添加自定义供应商" })[0]);
    expect(screen.getByDisplayValue("新自定义搜索")).toBeTruthy();
    // The protocol label now comes from the Runtime registry, not product copy.
    expect(screen.getAllByText("智谱 Web Search").length).toBeGreaterThan(0);

    fireEvent.change(screen.getByDisplayValue("新自定义搜索"), { target: { value: "智谱实时搜索" } });
    expect(screen.getByText("自定义：智谱实时搜索")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "保存搜索设置" }));
    await waitFor(() => expect(client.save).toHaveBeenCalledTimes(1));
    const saved = vi.mocked(client.save).mock.calls[0]?.[0];
    const provider = saved.customProviders.find((candidate) => candidate.name === "智谱实时搜索");
    expect(provider).toMatchObject({
      protocol: "zhipu-web-search-v1",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",    });
    expect(saved.channels).toContainEqual(expect.objectContaining({
      kind: "custom-api",
      providerId: provider?.id,
      enabled: true,
    }));
  });

  it("calls the real Runtime channel-test client with the configured query and purpose", async () => {
    render(<SearchSettingsPanel client={client} />);
    await screen.findByText("自定义：Tavily 搜索");

    fireEvent.change(screen.getByLabelText("测试查询"), { target: { value: "今日 AI 搜索新闻" } });
    fireEvent.change(screen.getByLabelText("搜索目的"), { target: { value: "核对最新来源" } });
    fireEvent.click(screen.getByRole("button", { name: "测试渠道 custom:tavily" }));

    await waitFor(() => expect(client.testChannel).toHaveBeenCalledWith({
      channelId: "custom:tavily",
      query: "今日 AI 搜索新闻",
      purpose: "核对最新来源",
    }));
    expect(notifyMock.success).toHaveBeenCalledWith("Tavily 搜索 测试成功", {
      description: "搜索成功，来源：https://example.com",
    });
  });

  it("协议列表来自 Runtime 注册表，空状态列出全部五种协议", async () => {
    const client = createClientWithSearch({ ...initialSearch, channels: [], customProviders: [] });
    render(<SearchSettingsPanel client={client} />);

    await waitFor(() => expect(client.listProtocols).toHaveBeenCalledTimes(1));

    // bocha / unifuncs / custom-http were unreachable while the list was hardcoded.
    const description = await screen.findByText(/可添加 Runtime 支持的任一搜索协议/);
    expect(description.textContent).toContain("智谱 Web Search");
    expect(description.textContent).toContain("Tavily MCP");
    expect(description.textContent).toContain("博查 AI 搜索");
    expect(description.textContent).toContain("U深搜 (UniFuncs)");
    expect(description.textContent).toContain("自定义 HTTP");
  });

  it("custom-http 供应商展示请求与响应映射配置并写入 options", async () => {
    const client = createClientWithSearch({
      ...initialSearch,
      customProviders: [
        {
          id: "selfhosted",
          name: "自建搜索",
          protocol: "custom-http",
          baseUrl: "https://search.internal/api",
          options: { method: "POST" },
        },
      ],
      channels: [{ id: "custom:selfhosted", kind: "custom-api", providerId: "selfhosted", enabled: true }],
    });

    render(<SearchSettingsPanel client={client} />);
    expect(await screen.findByText("自定义 HTTP 请求")).toBeTruthy();
    expect(screen.getByText("响应字段映射")).toBeTruthy();
    // Registry copy replaces the previously hardcoded product description.
    expect(screen.getByText(/完全自定义的 HTTP 搜索适配器/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("结果数组路径"), { target: { value: "data.webPages" } });
    fireEvent.change(screen.getByLabelText("摘要字段"), { target: { value: "summary" } });
    fireEvent.change(screen.getByLabelText("请求体模板（JSON）"), {
      target: { value: '{"q":"{{query}}"}' },
    });

    fireEvent.click(screen.getByRole("button", { name: "保存搜索设置" }));
    await waitFor(() => expect(client.save).toHaveBeenCalledTimes(1));

    const saved = vi.mocked(client.save).mock.calls[0]?.[0];
    const provider = saved.customProviders.find((candidate) => candidate.id === "selfhosted");
    expect(provider?.options).toMatchObject({
      method: "POST",
      bodyTemplate: '{"q":"{{query}}"}',
      responseMapping: { resultsPath: "data.webPages", snippetField: "summary" },
    });
  });

  it("authStyle 为 query 时才要求填写 API Key 查询参数名", async () => {
    const client = createClientWithSearch({
      ...initialSearch,
      customProviders: [
        {
          id: "selfhosted",
          name: "自建搜索",
          protocol: "custom-http",
          baseUrl: "https://search.internal/api",
          options: { authStyle: "query", authQueryParam: "apikey" },
        },
      ],
      channels: [],
    });

    render(<SearchSettingsPanel client={client} />);
    await screen.findByText("自定义 HTTP 请求");

    expect((screen.getByLabelText("API Key 查询参数名") as HTMLInputElement).value).toBe("apikey");
  });

  it("非 custom-http 协议不展示自定义 HTTP 配置块", async () => {
    render(<SearchSettingsPanel client={client} />);
    await screen.findByText("Tavily 搜索");
    await waitFor(() => expect(client.listProtocols).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getAllByRole("button", { name: "添加自定义供应商" })[0]);

    expect(screen.queryByText("自定义 HTTP 请求")).toBeNull();
    expect(screen.queryByText("响应字段映射")).toBeNull();
  });

  it("查询参数以 JSON 编辑并写入 options.queryParams", async () => {
    const client = createClientWithSearch({
      ...initialSearch,
      customProviders: [
        {
          id: "selfhosted",
          name: "自建搜索",
          protocol: "custom-http",
          baseUrl: "https://search.internal/api",
          options: { method: "GET" },
        },
      ],
      channels: [],
    });

    render(<SearchSettingsPanel client={client} />);
    await screen.findByText("自定义 HTTP 请求");

    fireEvent.change(screen.getByLabelText("查询参数（JSON）"), {
      target: { value: '{"q":"{{query}}","limit":"{{count}}"}' },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存搜索设置" }));

    await waitFor(() => expect(client.save).toHaveBeenCalledTimes(1));
    const saved = vi.mocked(client.save).mock.calls[0]?.[0];
    expect(saved.customProviders[0]?.options).toMatchObject({
      method: "GET",
      queryParams: { q: "{{query}}", limit: "{{count}}" },
    });
  });

  it("查询参数 JSON 非法时提示且不写入配置", async () => {
    const client = createClientWithSearch({
      ...initialSearch,
      customProviders: [
        {
          id: "selfhosted",
          name: "自建搜索",
          protocol: "custom-http",
          baseUrl: "https://search.internal/api",
          options: { method: "GET" },
        },
      ],
      channels: [],
    });

    render(<SearchSettingsPanel client={client} />);
    await screen.findByText("自定义 HTTP 请求");

    fireEvent.change(screen.getByLabelText("查询参数（JSON）"), {
      target: { value: '{"q": ' },
    });
    expect(await screen.findByText(/JSON 解析失败/)).toBeTruthy();

    // A non-string value is also rejected: the Runtime interpolates strings only.
    fireEvent.change(screen.getByLabelText("查询参数（JSON）"), {
      target: { value: '{"limit": 10}' },
    });
    expect(await screen.findByText(/必须是字符串/)).toBeTruthy();

    // Nothing reached the draft, so there is no dirty state to save.
    const saveButton = screen.getByRole("button", { name: "保存搜索设置" }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
    expect(client.save).not.toHaveBeenCalled();
  });
});
