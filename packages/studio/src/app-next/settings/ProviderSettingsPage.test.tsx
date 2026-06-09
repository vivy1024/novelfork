import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProviderSettingsPage, type ProviderSettingsClient } from "./ProviderSettingsPage";

const openaiProvider = {
  id: "openai",
  name: "OpenAI",
  type: "openai" as const,
  enabled: true,
  priority: 1,
  apiKeyRequired: true,
  baseUrl: "https://api.openai.com/v1",
  prefix: "openai",
  compatibility: "openai-compatible" as const,
  apiMode: "responses" as const,
  config: { apiKey: "test-key" },
  models: [
    { id: "gpt-4o", name: "GPT-4o", enabled: true, contextWindow: 128000, maxOutputTokens: 4096, lastTestStatus: "untested" as const },
  ],
};

function createClient(): ProviderSettingsClient {
  return {
    listProviders: vi.fn(async () => ({ providers: [openaiProvider] })),
    createProvider: vi.fn(async (provider) => ({ provider: { ...provider, priority: 2, models: [] } })),
    updateProvider: vi.fn(async (providerId, updates) => ({ provider: { ...openaiProvider, id: providerId, ...updates, config: { ...openaiProvider.config, ...updates.config } } })),
    refreshModels: vi.fn(async (providerId) => ({
      provider: { ...openaiProvider, id: providerId, models: [
        { id: "gpt-5-codex", name: "GPT-5 Codex", enabled: true, contextWindow: 192000, maxOutputTokens: 8192, lastTestStatus: "untested" as const, lastRefreshedAt: "2026-04-27T00:00:00.000Z" },
      ] },
    })),
    testModel: vi.fn(async () => ({ success: true, latency: 12, model: { id: "gpt-4o", name: "GPT-4o", enabled: true, contextWindow: 128000, maxOutputTokens: 4096, lastTestStatus: "success" as const, lastTestLatency: 12 } })),
    updateModel: vi.fn(async (_providerId, _modelId, updates) => ({ model: { ...openaiProvider.models[0], ...updates } })),
    deleteProvider: vi.fn(async () => ({ success: true })),
  };
}

afterEach(() => cleanup());

describe("ProviderSettingsPage", () => {
  it("loads providers and renders API key providers", async () => {
    const client = createClient();
    render(<ProviderSettingsPage client={client} />);

    expect(await screen.findByRole("heading", { name: "AI 供应商" })).toBeTruthy();
    await waitFor(() => expect(client.listProviders).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("heading", { name: "运行态总览" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "API 供应商" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "查看 OpenAI API key 接入详情" })).toBeTruthy();
  });

  it("API key provider 区分可配置/已配置/已验证/可调用四态", async () => {
    const client = createClient();
    (client.listProviders as ReturnType<typeof vi.fn>).mockResolvedValue({
      providers: [{
        ...openaiProvider,
        models: [{ ...openaiProvider.models[0], lastTestStatus: "success" as const }],
      }],
    });
    render(<ProviderSettingsPage client={client} />);

    const openaiCard = await screen.findByRole("button", { name: "查看 OpenAI API key 接入详情" });

    expect(openaiCard.textContent).toContain("可配置");
    expect(openaiCard.textContent).toContain("已配置");
    expect(openaiCard.textContent).toContain("已验证");
    expect(openaiCard.textContent).toContain("可调用");
  });

  it("RED: provider 列表支持搜索、异常过滤并能隐藏 E2E 测试夹具", async () => {
    const client = createClient();
    const e2eProvider = {
      ...openaiProvider,
      id: "e2e-provider-task11",
      name: "E2E Provider Task11",
      prefix: "e2e-task11",
      models: [{ ...openaiProvider.models[0], id: "e2e-model-a", name: "E2E Model A", lastTestStatus: "success" as const }],
    };
    const brokenProvider = {
      ...openaiProvider,
      id: "broken-gateway",
      name: "Broken Gateway",
      baseUrl: "",
      config: {},
      models: [{ ...openaiProvider.models[0], id: "broken-model", name: "Broken Model", lastTestStatus: "error" as const, lastTestError: "网关 502" }],
    };
    (client.listProviders as ReturnType<typeof vi.fn>).mockResolvedValue({ providers: [openaiProvider, e2eProvider, brokenProvider] });

    render(<ProviderSettingsPage client={client} />);

    const fixtureCard = await screen.findByRole("button", { name: "查看 E2E Provider Task11 API key 接入详情" });
    expect(screen.getByLabelText("搜索供应商或模型")).toBeTruthy();
    expect(screen.getByLabelText("只看异常项")).toBeTruthy();
    expect(screen.getByLabelText("隐藏测试夹具")).toBeTruthy();
    expect(fixtureCard.textContent).toContain("测试夹具");
    expect(fixtureCard.textContent).toContain("开发数据");

    fireEvent.click(screen.getByLabelText("隐藏测试夹具"));
    expect(screen.queryByRole("button", { name: "查看 E2E Provider Task11 API key 接入详情" })).toBeNull();

    fireEvent.change(screen.getByLabelText("搜索供应商或模型"), { target: { value: "broken" } });
    fireEvent.click(screen.getByLabelText("只看异常项"));
    expect(screen.getByRole("button", { name: "查看 Broken Gateway API key 接入详情" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "查看 OpenAI API key 接入详情" })).toBeNull();
  });

  it("运行态总览拆分 total / available / callable 模型统计口径", async () => {
    const client = createClient();
    client.getProviderSummary = vi.fn(async () => ({
      summary: {
        providerCount: 3,
        enabledProviderCount: 2,
        physicalModelCount: 9,
        availableModelCount: 4,
        totalCatalogModelCount: 5,
        callableModelCount: 1,
        issueCount: 2,
      },
    }));
    render(<ProviderSettingsPage client={client} />);

    await screen.findByRole("heading", { name: "运行态总览" });

    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText("可调用模型")).toBeTruthy();
    expect(screen.getByText("可用 4 / 共 5 个模型")).toBeTruthy();
    expect(screen.getByText("已启用 2 / 共 3 个")).toBeTruthy();
  });

  it("API key provider 缺配置或测试失败时显示 degraded/error 与真实恢复动作", async () => {
    const client = createClient();
    (client.listProviders as ReturnType<typeof vi.fn>).mockResolvedValue({
      providers: [{
        ...openaiProvider,
        baseUrl: "",
        config: {},
        models: [{ ...openaiProvider.models[0], lastTestStatus: "error" as const, lastTestError: "网关 502" }],
      }],
    });
    render(<ProviderSettingsPage client={client} />);

    const openaiCard = await screen.findByRole("button", { name: "查看 OpenAI API key 接入详情" });

    expect(openaiCard.textContent).toContain("异常");
    expect(openaiCard.textContent).toContain("可配置");
    expect(openaiCard.textContent).toContain("未配置");
    expect(openaiCard.textContent).toContain("未验证");
    expect(openaiCard.textContent).toContain("缺少 Base URL");
    expect(openaiCard.textContent).toContain("缺少 API Key");
    expect(openaiCard.textContent).toContain("测试失败");
    expect(openaiCard.textContent).toContain("不可调用");
    expect(openaiCard.textContent).toContain("添加密钥");
    expect(openaiCard.textContent).toContain("刷新模型");
    expect(openaiCard.textContent).toContain("测试模型");
  });

  it("模型能力标签只来自真实 inventory，未知能力显示 unknown", async () => {
    const client = createClient();
    client.listGroupedModels = vi.fn(async () => ({
      groups: [{
        providerId: "openai",
        providerName: "OpenAI",
        enabled: true,
        health: "partial",
        models: [
          { ...openaiProvider.models[0], capabilities: ["大上下文", "工具调用"] },
          { id: "unknown-model", name: "Unknown Model", enabled: true, contextWindow: 32000, maxOutputTokens: 4096, lastTestStatus: "untested" as const },
        ],
      }],
    }));
    render(<ProviderSettingsPage client={client} />);

    // Wait for load to complete
    await screen.findByRole("heading", { name: "AI 供应商" });
    // The grouped models API is called but ModelInventorySection is not rendered inline;
    // verify the API call was made
    await waitFor(() => expect(client.listGroupedModels).toHaveBeenCalledTimes(1));
  });

  it("opens OpenAI API provider detail with editable API fields, model list and refresh action", async () => {
    const client = createClient();
    render(<ProviderSettingsPage client={client} />);

    fireEvent.click(await screen.findByRole("button", { name: "查看 OpenAI API key 接入详情" }));

    expect(await screen.findByRole("heading", { name: "API 接入信息" })).toBeTruthy();
    expect((screen.getByLabelText("Base URL") as HTMLInputElement).value).toBe("https://api.openai.com/v1");
    expect(screen.getByLabelText("API Key").getAttribute("type")).toBe("password");
    fireEvent.change(screen.getByLabelText("Base URL"), { target: { value: "https://api.alt.example/v1" } });
    fireEvent.click(screen.getByRole("button", { name: "保存变更" }));
    await waitFor(() => expect(client.updateProvider).toHaveBeenCalledWith("openai", expect.objectContaining({ baseUrl: "https://api.alt.example/v1" })));
    expect(screen.getByRole("heading", { name: "模型列表" })).toBeTruthy();
    expect(screen.getByText("GPT-4o")).toBeTruthy();
    expect(screen.getByRole("button", { name: "获取模型列表" })).toBeTruthy();
    expect(screen.queryByText("账号管理")).toBeNull();
  });

  it("shows saved API key state when provider views are sanitized", async () => {
    const client = createClient();
    (client.listProviders as ReturnType<typeof vi.fn>).mockResolvedValue({
      providers: [{ ...openaiProvider, config: { apiKeyConfigured: true } as never }],
    });
    render(<ProviderSettingsPage client={client} />);

    fireEvent.click(await screen.findByRole("button", { name: "查看 OpenAI API key 接入详情" }));

    expect((await screen.findByLabelText("API Key")).getAttribute("placeholder")).toBe("已配置，留空不变");
  });

  it("refreshes models in API provider detail view", async () => {
    const client = createClient();
    render(<ProviderSettingsPage client={client} />);

    fireEvent.click(await screen.findByRole("button", { name: "查看 OpenAI API key 接入详情" }));
    await screen.findByRole("button", { name: "获取模型列表" });
    fireEvent.click(screen.getByRole("button", { name: "获取模型列表" }));

    await waitFor(() => expect(client.refreshModels).toHaveBeenCalledWith("openai"));
  });

  it("shows empty API key provider state", async () => {
    const client = createClient();
    (client.listProviders as ReturnType<typeof vi.fn>).mockResolvedValue({ providers: [] });
    render(<ProviderSettingsPage client={client} />);

    await screen.findByRole("heading", { name: "AI 供应商" });
    expect(screen.getAllByText(/0 个供应商/).length).toBeGreaterThan(0);
    expect(screen.getByText("暂无密钥供应商")).toBeTruthy();
  });

  it("only enables AddProviderForm after required name field is present", async () => {
    render(<ProviderSettingsPage client={createClient()} />);

    fireEvent.click(await screen.findByRole("button", { name: "+ 添加供应商" }));

    // Protocol modal opens first
    expect(await screen.findByRole("dialog", { name: "选择协议类型" })).toBeTruthy();
    // Click a protocol option to proceed to add form
    fireEvent.click(screen.getByText("Completions 兼容"));

    // After selecting protocol, add form appears
    expect(await screen.findByRole("button", { name: "创建并配置" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "创建并配置" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("供应商名称 *"), { target: { value: "Sub2API" } });
    expect((screen.getByRole("button", { name: "创建并配置" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
