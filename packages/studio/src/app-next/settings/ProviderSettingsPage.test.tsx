import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RuntimeSettings } from "../runtime-admin";
import { ProviderSettingsPage, type ProviderSettingsClient } from "./ProviderSettingsPage";

vi.mock("@/components/ui/simple-select", () => ({
  SimpleSelect: ({ value, onValueChange, options, placeholder, disabled, "aria-label": ariaLabel }: {
    value: string;
    onValueChange: (value: string) => void;
    options: ReadonlyArray<{ value: string; label: string }>;
    placeholder?: string;
    disabled?: boolean;
    "aria-label"?: string;
  }) => (
    <select
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange(event.currentTarget.value)}
    >
      {placeholder && !options.some((option) => option.value === "") ? <option value="">{placeholder}</option> : null}
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
}));

const openaiModels = Array.from({ length: 15 }, (_, index) => ({
  id: `gpt-inventory-${index + 1}`,
  owned_by: "fixture",
}));

function createSettings(): RuntimeSettings {
  return {
    server: { port: 7778, host: "localhost", openBrowser: "browser" },
    agent: {
      defaultModel: "kiro:claude-sonnet-4.5",
      hiddenModels: ["openai:gpt-inventory-2"],
      customModels: [{ value: "openai:writer-custom", label: "Writer Custom", provider: "openai" }],
      modelContextWindows: {
        "openai:gpt-inventory-1": 256000,
        "openai:writer-custom": 128000,
      },
      disabledProviders: [],
    },
    customApiProviders: [
      {
        id: "openai-main",
        name: "Canonical Responses",
        prefix: "openai",
        apiKey: "********1234",
        baseUrl: "https://custom.example/v1",
        defaultModel: "gpt-inventory-1",
        defaultContextWindow: 200000,
        protocol: "responses-compatible",
        proxy: { mode: "custom", url: "http://127.0.0.1:7890" },
        tlsRejectUnauthorized: false,
        defaultReasoningEffort: "high",
        userAgentMode: "custom",
        customUserAgent: "NovelFork-Test/1.0",
        extraHeaders: { "X-Test": "enabled" },
        emulateCodexHeaders: true,
        codexAccountId: "account-1",
        codexWebSocket: true,
        codexWebSearch: false,
        codexImageGeneration: true,
        disabled: false,
      },
      {
        id: "anthropic-main",
        name: "Canonical Anthropic",
        prefix: "anthropic-main",
        apiKey: "********5678",
        baseUrl: "https://anthropic.example/v1",
        defaultModel: "claude-sonnet-4-5",
        protocol: "anthropic-official",
        disabled: false,
      },
    ],
    openaiProviders: [{
      id: "openai-main",
      name: "OpenAI 派生缓存（不应展示）",
      prefix: "openai",
      apiKey: "********1234",
      baseUrl: "https://custom.example/v1",
      defaultModel: "gpt-inventory-1",
      apiMode: "responses",
    }],
    anthropicProviders: [{
      id: "anthropic-main",
      name: "Anthropic 派生缓存（不应展示）",
      prefix: "anthropic-main",
      apiKey: "********5678",
      baseUrl: "https://anthropic.example/v1",
      defaultModel: "claude-sonnet-4-5",
      officialApi: true,
    }],
    nugProviders: [{
      id: "nug-1",
      name: "NUG 本地",
      prefix: "nug",
      apiKey: "********9999",
      baseUrl: "http://127.0.0.1:7790",
      defaultModel: "kiro:sonnet",
    }],
    clineProviders: [{
      id: "cline-1",
      name: "Cline OAuth",
      prefix: "cline",
      accessToken: "********abcd",
      baseUrl: "https://openrouter.ai/api/v1",
      defaultModel: "anthropic/claude",
    }],
    kiro: {},
    codex: { defaultReasoningEffort: "medium" },
    codexAvailable: true,
    kiroModels: [{ id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5" }],
    codexModels: [{ id: "gpt-5-codex", name: "GPT-5 Codex" }],
    openaiModelsGrouped: [{
      providerId: "openai-main",
      providerName: "OpenAI 派生缓存（不应展示）",
      models: openaiModels,
    }],
    anthropicModelsGrouped: [{
      providerId: "anthropic-main",
      providerName: "Anthropic 派生缓存（不应展示）",
      models: [{ id: "claude-sonnet-4-5", display_name: "Claude Sonnet 4.5" }],
    }],
    nugModelsGrouped: [{
      providerId: "nug-1",
      providerName: "NUG 本地",
      models: [{ id: "kiro:sonnet" }],
    }],
    clineModelsGrouped: [{
      providerId: "cline-1",
      providerName: "Cline OAuth",
      models: [{ id: "anthropic/claude" }],
    }],
  };
}

function createClient() {
  let settings = createSettings();
  const client: ProviderSettingsClient = {
    get: vi.fn(async () => settings),
    patch: vi.fn(async (patch) => {
      settings = {
        ...settings,
        ...patch,
        agent: patch.agent ? { ...settings.agent, ...patch.agent } : settings.agent,
      } as RuntimeSettings;
      return settings;
    }),
    testModel: vi.fn(async () => ({ text: "连接正常", requestUrls: [] })),
    refreshProviderModels: vi.fn(async ({ providerId }) => {
      if (providerId === "openai-main") {
        settings = {
          ...settings,
          openaiModelsGrouped: [{
            providerId: "openai-main",
            providerName: "OpenAI 派生缓存（不应展示）",
            models: [...openaiModels, { id: "gpt-after-refresh" }],
          }],
        };
      }
      return { models: [{ id: `${providerId}-refreshed` }], fromCache: false };
    }),
  };
  return { client, getSettings: () => settings };
}

afterEach(() => cleanup());

describe("ProviderSettingsPage", () => {
  it("只展示和计数 canonical 标准 API，隐藏平台账户池及派生数组", async () => {
    const { client } = createClient();
    render(<ProviderSettingsPage client={client} />);

    expect(await screen.findByRole("heading", { name: "AI 供应商" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "标准 API 供应商" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "完整标准 API 模型库存" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "编辑与测试 Canonical Responses" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "编辑与测试 Canonical Anthropic" })).toBeTruthy();
    expect(screen.queryByText("OpenAI 派生缓存（不应展示）")).toBeNull();
    expect(screen.queryByText("Anthropic 派生缓存（不应展示）")).toBeNull();
    expect(screen.queryByText("NUG 本地")).toBeNull();
    expect(screen.queryByText("Cline OAuth")).toBeNull();
    expect(screen.queryByText("kiro:claude-sonnet-4.5")).toBeNull();
    expect(screen.queryByText("codex:gpt-5-codex")).toBeNull();
    expect(screen.getByText("openai:gpt-inventory-15")).toBeTruthy();
    expect(screen.getByText("openai:gpt-inventory-2")).toBeTruthy();

    const providerSummary = screen.getAllByText("标准 API 供应商")
      .find((element) => element.getAttribute("data-slot") === "card-description")
      ?.closest('[data-slot="card"]');
    expect(providerSummary).toBeTruthy();
    expect(within(providerSummary as HTMLElement).getByText("2")).toBeTruthy();
    expect(client.get).toHaveBeenCalledTimes(1);
  });

  it("详情保留完整标准 API 字段，保存时只 PATCH customApiProviders", async () => {
    const { client } = createClient();
    render(<ProviderSettingsPage client={client} />);

    fireEvent.click(await screen.findByRole("button", { name: "编辑与测试 Canonical Responses" }));
    expect((screen.getByLabelText("API Key") as HTMLInputElement).value).toBe("");
    expect(screen.getByText(/Runtime 返回掩码：\*{8}1234/)).toBeTruthy();
    expect((screen.getByLabelText("Base URL") as HTMLInputElement).value).toBe("https://custom.example/v1");
    expect((screen.getByLabelText("默认模型") as HTMLInputElement).value).toBe("gpt-inventory-1");
    expect((screen.getByLabelText("供应商默认上下文窗口") as HTMLInputElement).value).toBe("200000");
    expect((screen.getByLabelText("供应商代理策略") as HTMLSelectElement).value).toBe("custom");
    expect((screen.getByLabelText("供应商代理 URL") as HTMLInputElement).value).toBe("http://127.0.0.1:7890");
    expect(screen.getByLabelText("验证 TLS 证书").getAttribute("aria-checked")).toBe("false");
    expect((screen.getByLabelText("供应商默认推理强度") as HTMLSelectElement).value).toBe("high");
    expect((screen.getByLabelText("User-Agent 指纹") as HTMLSelectElement).value).toBe("custom");
    expect((screen.getByLabelText("自定义 User-Agent") as HTMLInputElement).value).toBe("NovelFork-Test/1.0");
    expect((screen.getByLabelText("额外请求头 JSON") as HTMLTextAreaElement).value).toContain('"X-Test": "enabled"');

    fireEvent.change(screen.getByLabelText("Base URL"), { target: { value: "https://gateway.example/v1" } });
    fireEvent.click(screen.getByRole("button", { name: "保存变更" }));

    await waitFor(() => expect(client.patch).toHaveBeenCalledTimes(1));
    const patch = (client.patch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(Object.keys(patch)).toEqual(["customApiProviders"]);
    expect(patch).toEqual({
      customApiProviders: expect.arrayContaining([expect.objectContaining({
        id: "openai-main",
        baseUrl: "https://gateway.example/v1",
        apiKey: "********1234",
        proxy: { mode: "custom", url: "http://127.0.0.1:7890" },
        tlsRejectUnauthorized: false,
        defaultReasoningEffort: "high",
        userAgentMode: "custom",
        customUserAgent: "NovelFork-Test/1.0",
        extraHeaders: { "X-Test": "enabled" },
        emulateCodexHeaders: true,
      })]),
    });
  });

  it("支持五类 canonical 协议并保留 Codex Native flags", async () => {
    const { client } = createClient();
    render(<ProviderSettingsPage client={client} />);

    fireEvent.click(await screen.findByRole("button", { name: "编辑与测试 Canonical Responses" }));
    const protocol = screen.getByLabelText("API 类型 / 协议");
    expect(within(protocol).getByRole("option", { name: "Anthropic 官方" })).toBeTruthy();
    expect(within(protocol).getByRole("option", { name: "Anthropic 兼容" })).toBeTruthy();
    expect(within(protocol).getByRole("option", { name: "Responses 兼容" })).toBeTruthy();
    expect(within(protocol).getByRole("option", { name: "Chat Completions 兼容" })).toBeTruthy();
    expect(within(protocol).getByRole("option", { name: "Codex Native" })).toBeTruthy();

    fireEvent.change(protocol, { target: { value: "codex-native" } });
    expect((screen.getByLabelText("ChatGPT Account ID") as HTMLInputElement).value).toBe("account-1");
    expect(screen.getByLabelText("使用 Responses WebSocket").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByLabelText("允许 Codex Web Search").getAttribute("aria-checked")).toBe("false");
    expect(screen.getByLabelText("允许 Codex Image Generation").getAttribute("aria-checked")).toBe("true");
  });

  it("创建供应商时只写 canonical 数组", async () => {
    const { client } = createClient();
    render(<ProviderSettingsPage client={client} />);

    fireEvent.click(await screen.findByRole("button", { name: "添加标准 API 供应商" }));
    expect((screen.getByLabelText("自定义模型 ID") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByLabelText("API Key").closest("form")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "Novel Responses" } });
    fireEvent.change(screen.getByLabelText("模型前缀"), { target: { value: "novel-responses" } });
    fireEvent.change(screen.getByLabelText("Base URL"), { target: { value: "https://novel.example/v1" } });
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "sk-new" } });
    fireEvent.change(screen.getByLabelText("默认模型"), { target: { value: "writer-1" } });
    fireEvent.click(screen.getByRole("button", { name: "创建供应商" }));

    await waitFor(() => expect(client.patch).toHaveBeenCalledTimes(1));
    const patch = (client.patch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(Object.keys(patch)).toEqual(["customApiProviders"]);
    expect(patch.customApiProviders).toEqual(expect.arrayContaining([expect.objectContaining({
      id: "novel-responses",
      name: "Novel Responses",
      prefix: "novel-responses",
      protocol: "responses-compatible",
      apiKey: "sk-new",
    })]));
    expect(patch).not.toHaveProperty("openaiProviders");
    expect(patch).not.toHaveProperty("anthropicProviders");
  });

  it("按协议接入真实 provider refresh，并重新读取完整库存", async () => {
    const { client } = createClient();
    render(<ProviderSettingsPage client={client} />);

    fireEvent.click(await screen.findByRole("button", { name: "编辑与测试 Canonical Responses" }));
    fireEvent.click(screen.getByRole("button", { name: "刷新模型库存" }));
    await waitFor(() => expect(client.refreshProviderModels).toHaveBeenCalledWith({
      providerId: "openai-main",
      protocol: "responses-compatible",
    }));
    await waitFor(() => expect(client.get).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("openai:gpt-after-refresh")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "返回供应商列表" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑与测试 Canonical Anthropic" }));
    fireEvent.click(screen.getByRole("button", { name: "刷新模型库存" }));
    await waitFor(() => expect(client.refreshProviderModels).toHaveBeenLastCalledWith({
      providerId: "anthropic-main",
      protocol: "anthropic-official",
    }));
  });

  it("可编辑 hiddenModels、modelContextWindows 与 customModels", async () => {
    const { client } = createClient();
    render(<ProviderSettingsPage client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑与测试 Canonical Responses" }));

    fireEvent.click(screen.getByRole("button", { name: "隐藏模型 openai:gpt-inventory-1" }));
    await waitFor(() => expect(client.patch).toHaveBeenLastCalledWith(expect.objectContaining({
      agent: expect.objectContaining({
        hiddenModels: expect.arrayContaining(["openai:gpt-inventory-1", "openai:gpt-inventory-2"]),
      }),
    })));

    const contextInput = screen.getByLabelText("模型上下文窗口 openai:gpt-inventory-3");
    fireEvent.change(contextInput, { target: { value: "320000" } });
    fireEvent.blur(contextInput);
    await waitFor(() => expect(client.patch).toHaveBeenLastCalledWith(expect.objectContaining({
      agent: expect.objectContaining({
        modelContextWindows: expect.objectContaining({ "openai:gpt-inventory-3": 320000 }),
      }),
    })));

    fireEvent.change(screen.getByLabelText("自定义模型 ID"), { target: { value: "writer-new" } });
    fireEvent.change(screen.getByLabelText("自定义模型名称"), { target: { value: "Writer New" } });
    fireEvent.click(screen.getByRole("button", { name: "添加模型" }));
    await waitFor(() => expect(client.patch).toHaveBeenLastCalledWith(expect.objectContaining({
      agent: expect.objectContaining({
        customModels: expect.arrayContaining([{ value: "openai:writer-new", label: "Writer New", provider: "openai" }]),
      }),
    })));
    expect(await screen.findByText("openai:writer-new")).toBeTruthy();
  });

  it("库存和详情测试都通过 /api/settings/test-model client boundary", async () => {
    const { client } = createClient();
    render(<ProviderSettingsPage client={client} />);

    fireEvent.click(await screen.findByRole("button", { name: "测试模型 openai:gpt-inventory-1" }));
    await waitFor(() => expect(client.testModel).toHaveBeenCalledWith({
      model: "openai:gpt-inventory-1",
      prompt: "请用一句话确认 NovelFork 模型连接正常。",
    }));

    fireEvent.click(screen.getByRole("button", { name: "编辑与测试 Canonical Responses" }));
    fireEvent.click(screen.getByRole("button", { name: "测试默认模型" }));
    await waitFor(() => expect(client.testModel).toHaveBeenLastCalledWith({
      model: "openai:gpt-inventory-1",
      prompt: "请用一句话确认连接正常。",
    }));
    expect(await screen.findByText(/连接正常/)).toBeTruthy();
  });
});
