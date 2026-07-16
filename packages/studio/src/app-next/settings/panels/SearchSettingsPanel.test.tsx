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

function createClient() {
  const get = vi.fn(async () => runtimeResponse);
  const save = vi.fn(async (search: SearchSettings) => ({ ...runtimeResponse, search }));
  const testChannel = vi.fn(async () => ({
    text: "搜索成功，来源：https://example.com",
    channelId: "custom:tavily",
    channelLabel: "Tavily 搜索",
    attempts: [],
  }));
  return { get, save, testChannel } as unknown as SearchSettingsClient;
}

let client: SearchSettingsClient;

beforeEach(() => {
  client = createClient();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

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
    expect(screen.getAllByText("智谱 Web Search API").length).toBeGreaterThan(0);

    fireEvent.change(screen.getByDisplayValue("新自定义搜索"), { target: { value: "智谱实时搜索" } });
    expect(screen.getByText("自定义：智谱实时搜索")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "保存搜索设置" }));
    await waitFor(() => expect(client.save).toHaveBeenCalledTimes(1));
    const saved = vi.mocked(client.save).mock.calls[0]?.[0];
    const provider = saved.customProviders.find((candidate) => candidate.name === "智谱实时搜索");
    expect(provider).toMatchObject({
      protocol: "zhipu-web-search-v1",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    });
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
});
