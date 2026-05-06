import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProviderSettingsPage, type ProviderSettingsClient } from "./ProviderSettingsPage";
import type { PlatformAccount, PlatformIntegrationCatalogItem } from "./provider-types";

const platformCatalog: PlatformIntegrationCatalogItem[] = [
  {
    id: "codex",
    name: "Codex",
    description: "导入 Codex / ChatGPT JSON 账号数据后作为平台账号使用。",
    enabled: true,
    supportedImportMethods: ["json-account"],
    modelCount: 4,
  },
  {
    id: "kiro",
    name: "Kiro",
    description: "导入 Kiro JSON 账号数据后作为平台账号使用。",
    enabled: true,
    supportedImportMethods: ["json-account"],
    modelCount: 0,
  },
];

const importedCodexAccount: PlatformAccount = {
  id: "codex-acct-123",
  platformId: "codex",
  displayName: "主力 ChatGPT",
  email: "writer@example.com",
  accountId: "acct_123",
  authMode: "json-account",
  planType: "Plus",
  status: "active",
  current: true,
  priority: 1,
  successCount: 0,
  failureCount: 0,
  credentialSource: "json",
  createdAt: "2026-04-27T00:00:00.000Z",
};

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
    listPlatformIntegrations: vi.fn(async () => ({ integrations: platformCatalog })),
    listPlatformAccounts: vi.fn(async () => ({ accounts: [] })),
    importPlatformAccountJson: vi.fn(async () => ({ account: importedCodexAccount })),
    refreshPlatformAccountQuota: vi.fn(async () => ({ account: { ...importedCodexAccount, quota: { hourlyPercentage: 42 } } })),
    setCurrentPlatformAccount: vi.fn(async () => ({ account: { ...importedCodexAccount, current: true } })),
    updatePlatformAccountStatus: vi.fn(async (_platformId, _accountId, status) => ({ account: { ...importedCodexAccount, status } })),
    deletePlatformAccount: vi.fn(async () => ({ success: true })),
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
  };
}

afterEach(() => cleanup());

describe("ProviderSettingsPage", () => {
  it("loads platform catalog from the platform API and renders API key providers separately", async () => {
    const client = createClient();
    render(<ProviderSettingsPage client={client} />);

    expect(await screen.findByRole("heading", { name: "AI 供应商" })).toBeTruthy();
    await waitFor(() => expect(client.listPlatformIntegrations).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("heading", { name: "运行态总览" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "平台集成" })).toBeTruthy();
    expect(screen.getByText(/平台账号通过 JSON 账号数据导入后使用/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "密钥接入" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "模型库存" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: `${"虚拟"}模型` })).toBeNull();
    expect(screen.queryByRole("heading", { name: "写作任务模型" })).toBeNull();
    expect(screen.queryByText(/配额路由|失败回退|fallback|quota-aware/)).toBeNull();
    expect(screen.getByRole("heading", { name: "运行策略" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "查看 Codex 平台集成详情" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "查看 Kiro 平台集成详情" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "查看 OpenAI API key 接入详情" })).toBeTruthy();
  });

  it("RED: 平台集成无账号时只能显示可导入/未配置账号/不可调用", async () => {
    const client = createClient();
    render(<ProviderSettingsPage client={client} />);

    const codexCard = await screen.findByRole("button", { name: "查看 Codex 平台集成详情" });

    expect(codexCard.textContent).toContain("可导入");
    expect(codexCard.textContent).toContain("未配置账号");
    expect(codexCard.textContent).toContain("不可调用");
    expect(codexCard.textContent).not.toContain("可用");
  });

  it("opens Codex platform detail with JSON account import and real empty account state", async () => {
    const client = createClient();
    render(<ProviderSettingsPage client={client} />);

    fireEvent.click(await screen.findByRole("button", { name: "查看 Codex 平台集成详情" }));

    expect(await screen.findByRole("heading", { name: "JSON 账号导入" })).toBeTruthy();
    expect(screen.queryByText("本地 API 服务")).toBeNull();
    expect(screen.getByText("导入 JSON 账号数据后会在这里显示真实账号。")).toBeTruthy();
    expect((screen.getByRole("button", { name: "导入 JSON 账号" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("暂无平台账号")).toBeTruthy();
    expect(screen.queryByText(/后续接入|暂未接入|即将推出|UnsupportedCapability/)).toBeNull();
    await waitFor(() => expect(client.listPlatformAccounts).toHaveBeenCalledWith("codex"));
  });

  it("imports Codex JSON account data and shows it in the platform account table", async () => {
    const client = createClient();
    render(<ProviderSettingsPage client={client} />);

    fireEvent.click(await screen.findByRole("button", { name: "查看 Codex 平台集成详情" }));
    fireEvent.change(await screen.findByLabelText("账号显示名（可选）"), { target: { value: "主力 ChatGPT" } });
    fireEvent.change(screen.getByLabelText("JSON 账号数据"), { target: { value: '{"account_id":"acct_123","email":"writer@example.com"}' } });
    fireEvent.click(screen.getByRole("button", { name: "导入 JSON 账号" }));

    await waitFor(() => expect(client.importPlatformAccountJson).toHaveBeenCalledWith("codex", {
      accountJson: '{"account_id":"acct_123","email":"writer@example.com"}',
      displayName: "主力 ChatGPT",
    }));
    expect(await screen.findByText("主力 ChatGPT")).toBeTruthy();
    expect(screen.getByText("writer@example.com")).toBeTruthy();
    expect(screen.getByText("JSON 账号")).toBeTruthy();
  });

  it("does not render platform cards without real JSON account support", async () => {
    const client = createClient();
    render(<ProviderSettingsPage client={client} />);

    await screen.findByRole("heading", { name: "AI 供应商" });
    expect(screen.queryByRole("button", { name: "查看 Cline 平台集成详情" })).toBeNull();
  });

  it("opens OpenAI API provider detail with editable API fields, model list and refresh action", async () => {
    const client = createClient();
    render(<ProviderSettingsPage client={client} />);

    fireEvent.click(await screen.findByRole("button", { name: "查看 OpenAI API key 接入详情" }));

    expect(await screen.findByRole("heading", { name: "API 接入信息" })).toBeTruthy();
    expect((screen.getByLabelText("Base URL") as HTMLInputElement).value).toBe("https://api.openai.com/v1");
    expect(screen.getByLabelText("API Key").getAttribute("type")).toBe("password");
    expect((screen.getByLabelText("兼容格式") as HTMLSelectElement).value).toBe("openai-compatible");
    expect((screen.getByLabelText("API 模式") as HTMLSelectElement).value).toBe("responses");
    fireEvent.change(screen.getByLabelText("Base URL"), { target: { value: "https://api.alt.example/v1" } });
    fireEvent.click(screen.getByRole("button", { name: "保存接入信息" }));
    await waitFor(() => expect(client.updateProvider).toHaveBeenCalledWith("openai", expect.objectContaining({ baseUrl: "https://api.alt.example/v1" })));
    expect(screen.getByRole("heading", { name: "模型列表" })).toBeTruthy();
    expect(screen.getByText("GPT-4o")).toBeTruthy();
    expect(screen.getByRole("button", { name: "刷新模型" })).toBeTruthy();
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
    await screen.findByRole("button", { name: "刷新模型" });
    fireEvent.click(screen.getByRole("button", { name: "刷新模型" }));

    await waitFor(() => expect(client.refreshModels).toHaveBeenCalledWith("openai"));
  });

  it("shows empty API key provider state while keeping platform catalog from API", async () => {
    const client = createClient();
    (client.listProviders as ReturnType<typeof vi.fn>).mockResolvedValue({ providers: [] });
    render(<ProviderSettingsPage client={client} />);

    await screen.findByRole("heading", { name: "AI 供应商" });
    expect(screen.getByText(/0 API key 供应商/)).toBeTruthy();
    expect(screen.getByText("暂无密钥供应商")).toBeTruthy();
    expect(screen.getByRole("button", { name: "查看 Codex 平台集成详情" })).toBeTruthy();
  });

  it("only enables AddProviderForm after required API key fields are present", async () => {
    render(<ProviderSettingsPage client={createClient()} />);

    fireEvent.click(await screen.findByRole("button", { name: "+ 添加供应商" }));

    expect((screen.getByRole("button", { name: "保存供应商" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("供应商名称"), { target: { value: "Sub2API" } });
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "sk-sub" } });
    expect((screen.getByRole("button", { name: "保存供应商" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Base URL"), { target: { value: "https://gateway.example/v1" } });
    expect((screen.getByRole("button", { name: "保存供应商" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
