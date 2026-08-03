import React from "react";
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
    <select aria-label={ariaLabel} value={value} disabled={disabled} onChange={(event) => onValueChange(event.currentTarget.value)}>
      {placeholder && !options.some((option) => option.value === "") ? <option value="">{placeholder}</option> : null}
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
}));

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: ({ className }: { className?: string }) => <div data-testid="skeleton" className={className} />,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: React.ComponentProps<"button">) => <button {...props}>{children}</button>,
}));

const openaiModels = Array.from({ length: 4 }, (_, index) => ({ id: `gpt-inventory-${index + 1}`, owned_by: "fixture" }));

function createSettings(): RuntimeSettings {
  return {
    server: { port: 7778, host: "localhost", openBrowser: "browser" },
    agent: {
      defaultModel: "openai:gpt-inventory-1",
      hiddenModels: ["openai:gpt-inventory-2"],
      customModels: [{ value: "openai:writer-custom", label: "Writer Custom", provider: "openai" }],
      modelContextWindows: { "openai:gpt-inventory-1": 256000, "openai:writer-custom": 128000 },
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
    openaiProviders: [{ id: "openai-main", name: "派生 OpenAI", prefix: "openai", apiKey: "********1234", baseUrl: "https://custom.example/v1", defaultModel: "gpt-inventory-1", apiMode: "responses" }],
    anthropicProviders: [{ id: "anthropic-main", name: "派生 Anthropic", prefix: "anthropic-main", apiKey: "********5678", baseUrl: "https://anthropic.example/v1", defaultModel: "claude-sonnet-4-5", officialApi: true }],
    nugProviders: [{ id: "nug-main", name: "我的 NUG", prefix: "nug", apiKey: "********9999", baseUrl: "http://127.0.0.1:7800", defaultModel: "anthropic:claude-sonnet", disabled: false }],
    clineProviders: [{ id: "cline-1", name: "Cline OAuth", prefix: "cline", accessToken: "********abcd", baseUrl: "https://openrouter.ai/api/v1", defaultModel: "anthropic/claude" }],
    kiro: {},
    codex: { defaultReasoningEffort: "medium" },
    codexAvailable: true,
    kiroModels: [{ id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5" }],
    codexModels: [{ id: "gpt-5-codex", name: "GPT-5 Codex" }],
    openaiModelsGrouped: [{ providerId: "openai-main", providerName: "派生 OpenAI", models: openaiModels }],
    anthropicModelsGrouped: [{ providerId: "anthropic-main", providerName: "派生 Anthropic", models: [{ id: "claude-sonnet-4-5", display_name: "Claude Sonnet 4.5" }] }],
    nugModelsGrouped: [{ providerId: "nug-main", providerName: "我的 NUG", models: [{ id: "anthropic:claude-sonnet", name: "Claude Sonnet" }] }],
    clineModelsGrouped: [{ providerId: "cline-1", providerName: "Cline OAuth", models: [{ id: "anthropic/claude" }] }],
  };
}

function createClient() {
  let settings = createSettings();
  const client: ProviderSettingsClient = {
    get: vi.fn(async () => settings),
    patch: vi.fn(async (patch) => {
      settings = { ...settings, ...patch, agent: patch.agent ? { ...settings.agent, ...patch.agent } : settings.agent } as RuntimeSettings;
      return settings;
    }),
    testModel: vi.fn(async () => ({ text: "连接正常", requestUrls: [] })),
    refreshProviderModels: vi.fn(async ({ providerId }) => {
      settings = { ...settings, openaiModelsGrouped: [{ providerId, models: [...openaiModels, { id: "gpt-after-refresh" }] }] };
      return { models: [{ id: "gpt-after-refresh" }], fromCache: false };
    }),
    refreshNugProviderModels: vi.fn(async ({ providerId }) => {
      settings = { ...settings, nugModelsGrouped: [{ providerId, models: [{ id: "nug-after-refresh" }] }] };
      return { models: [{ id: "nug-after-refresh" }], fromCache: false, modelContextWindows: {} };
    }),
    kiroStatus: vi.fn(async () => ({
      available: true,
      snapshot: { total: 2, available: 1, entries: [{ id: "kiro-1" }, { id: "kiro-2", disabled: true }] },
    })),
    codexStatus: vi.fn(async () => ({
      total: 3,
      available: 2,
      useWebSocket: false,
      entries: [{ id: "codex-1" }, { id: "codex-2" }, { id: "codex-3", disabled: true }],
    })),
    clineStatus: vi.fn(async () => ({ authenticated: true, email: "cline@example.test", totalModels: 12 })),
  };
  return { client, getSettings: () => settings };
}

afterEach(() => cleanup());

describe("ProviderSettingsPage", () => {
  it("概览将平台供应商与可编辑 API/NUG 连接分开展示", async () => {
    const { client } = createClient();
    render(<ProviderSettingsPage client={client} />);

    expect(await screen.findByRole("heading", { name: "AI 供应商" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Runtime 平台供应商" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "标准 API 连接" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "NUG 反代服务" })).toBeTruthy();
    expect(screen.getByText("Kiro")).toBeTruthy();
    expect(screen.getByText("内建 Codex")).toBeTruthy();
    expect(screen.getByText("Cline")).toBeTruthy();
    expect(await screen.findByText("账号池：1/2 可用 · 1 个模型")).toBeTruthy();
    expect(screen.getByText("账号池：2/3 可用 · WebSocket 已关闭")).toBeTruthy();
    expect(screen.getByText("已连接：cline@example.test · 12 个模型")).toBeTruthy();
    expect(screen.getByRole("button", { name: "编辑与模型 Canonical Responses" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "编辑与模型 我的 NUG" })).toBeTruthy();
    expect(screen.queryByText("派生 OpenAI")).toBeNull();
    expect(screen.queryByText("派生 Anthropic")).toBeNull();
    expect(screen.queryByText("kiro:claude-sonnet-4.5")).toBeNull();
  });

  it("添加先选择协议，选择协议只创建本地草稿", async () => {
    const { client } = createClient();
    render(<ProviderSettingsPage client={client} />);

    fireEvent.click(await screen.findByRole("button", { name: "添加供应商" }));
    expect(screen.getByRole("dialog", { name: "选择供应商类型" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Codex Native/ }));
    expect(screen.getByRole("heading", { name: "新建标准 API 连接" })).toBeTruthy();
    expect(client.patch).not.toHaveBeenCalled();
    expect((screen.getByLabelText("API 类型 / 协议") as HTMLSelectElement).value).toBe("codex-native");
  });

  it("创建草稿时本地状态更新，保存时只 PATCH customApiProviders", async () => {
    const { client } = createClient();
    render(<ProviderSettingsPage client={client} />);

    fireEvent.click(await screen.findByRole("button", { name: "添加供应商" }));
    fireEvent.click(screen.getByRole("button", { name: /Responses 兼容/ }));
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "Novel Responses" } });
    fireEvent.change(screen.getByLabelText("模型前缀"), { target: { value: "novel-responses" } });
    fireEvent.change(screen.getByLabelText("Base URL"), { target: { value: "https://novel.example/v1" } });
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "sk-new" } });
    fireEvent.change(screen.getByLabelText("默认模型"), { target: { value: "writer-1" } });
    fireEvent.click(screen.getByRole("button", { name: "创建供应商" }));

    // 点击创建供应商立即 patch 保存到 Runtime
    await waitFor(() => expect(client.patch).toHaveBeenCalledTimes(1));
    const patch = (client.patch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(patch.customApiProviders).toEqual(expect.arrayContaining([expect.objectContaining({ id: "novel-responses", name: "Novel Responses", prefix: "novel-responses", protocol: "responses-compatible", apiKey: "sk-new" })]));
    expect(patch).not.toHaveProperty("openaiProviders");
    expect(patch).not.toHaveProperty("anthropicProviders");
  });

  it("保留六种协议（含 Gemini）和 Codex 专属配置", async () => {
    const { client } = createClient();
    render(<ProviderSettingsPage client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑与模型 Canonical Responses" }));
    const protocol = screen.getByLabelText("API 类型 / 协议");
    for (const label of ["Anthropic 官方", "Anthropic 兼容", "Gemini 兼容", "Responses 兼容", "Chat Completions 兼容", "Codex Native"]) {
      expect(within(protocol).getByRole("option", { name: label })).toBeTruthy();
    }
    fireEvent.change(protocol, { target: { value: "codex-native" } });
    expect((screen.getByLabelText("ChatGPT Account ID") as HTMLInputElement).value).toBe("account-1");
    expect(screen.getByLabelText("使用 Responses WebSocket").getAttribute("aria-checked")).toBe("true");
  });

  it("标准 API 和 NUG 都使用各自的真实模型刷新入口", async () => {
    const { client } = createClient();
    render(<ProviderSettingsPage client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑与模型 Canonical Responses" }));
    fireEvent.click(screen.getByRole("button", { name: "刷新模型库存" }));
    await waitFor(() => expect(client.refreshProviderModels).toHaveBeenCalledWith({ providerId: "openai-main", protocol: "responses-compatible" }));

    fireEvent.click(screen.getByRole("button", { name: "返回供应商列表" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑与模型 我的 NUG" }));
    fireEvent.click(screen.getByRole("button", { name: "刷新模型" }));
    await waitFor(() => expect(client.refreshNugProviderModels).toHaveBeenCalledWith("nug-main"));
  });

  it("详情仍可编辑隐藏模型、上下文窗口、自定义模型并测试模型", async () => {
    const { client } = createClient();
    render(<ProviderSettingsPage client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑与模型 Canonical Responses" }));

    fireEvent.click(screen.getByRole("button", { name: "隐藏模型 openai:gpt-inventory-1" }));

    const contextInput = screen.getByLabelText("模型上下文窗口 openai:gpt-inventory-3");
    fireEvent.change(contextInput, { target: { value: "320000" } });
    fireEvent.blur(contextInput);

    fireEvent.change(screen.getByLabelText("自定义模型 ID"), { target: { value: "writer-new" } });
    fireEvent.change(screen.getByLabelText("自定义模型名称"), { target: { value: "Writer New" } });
    fireEvent.click(screen.getByRole("button", { name: "添加模型" }));

    // 本地编辑期间不触发 patch
    expect(client.patch).not.toHaveBeenCalled();

    // 返回概览，保存变更
    fireEvent.click(screen.getByRole("button", { name: "返回供应商列表" }));
    await waitFor(() => expect(screen.getByText("有未保存的更改")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "保存变更" }));

    await waitFor(() => expect(client.patch).toHaveBeenCalledTimes(1));
    const patch = (client.patch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(patch.agent).toEqual(expect.objectContaining({
      hiddenModels: expect.arrayContaining(["openai:gpt-inventory-1", "openai:gpt-inventory-2"]),
      modelContextWindows: expect.objectContaining({ "openai:gpt-inventory-3": 320000 }),
      customModels: expect.arrayContaining([{ value: "openai:writer-new", label: "Writer New", provider: "openai" }]),
    }));

    // 测试模型仍是即时操作
    fireEvent.click(await screen.findByRole("button", { name: "编辑与模型 Canonical Responses" }));
    fireEvent.click(screen.getByRole("button", { name: "测试模型 openai:gpt-inventory-1" }));
    fireEvent.click(await screen.findByRole("button", { name: "开始测试连接" }));
    await waitFor(() => expect(client.testModel).toHaveBeenCalledWith({ model: "openai:gpt-inventory-1", prompt: "Please introduce yourself in one sentence. / 请用一句话介绍你自己。" }));
  });
});
