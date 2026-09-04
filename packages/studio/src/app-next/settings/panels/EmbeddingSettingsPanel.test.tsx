import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EmbeddingSettingsClient, PublicEmbeddingSettings } from "../../runtime-admin/embedding-settings";

const notifyMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/lib/notify", () => ({ notify: notifyMock }));

import { EmbeddingSettingsPanel } from "./EmbeddingSettingsPanel";

const initial: PublicEmbeddingSettings = {
  baseUrl: "https://api.siliconflow.cn/v1",
  model: "BAAI/bge-m3",
  dim: 1024,
  hasApiKey: false,
  apiKeyMasked: "",
  configured: false,
};

function createClient(overrides: Partial<EmbeddingSettingsClient> = {}): EmbeddingSettingsClient {
  return {
    get: vi.fn(async () => initial),
    save: vi.fn(async (patch) => ({
      ...initial,
      ...patch,
      hasApiKey: Boolean(patch.apiKey),
      apiKeyMasked: patch.apiKey ? `********${patch.apiKey.slice(-4)}` : "",
      configured: Boolean(patch.apiKey),
    })),
    test: vi.fn(async () => ({ ok: true, model: "BAAI/bge-m3", dim: 1024 })),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("EmbeddingSettingsPanel", () => {
  let client: EmbeddingSettingsClient;

  beforeEach(() => {
    client = createClient();
  });

  it("loads independent embedding defaults, not chat providers", async () => {
    render(<EmbeddingSettingsPanel client={client} />);
    expect(await screen.findByRole("heading", { name: "Embedding 提供商" })).toBeTruthy();
    expect(client.get).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText("接口地址") as HTMLInputElement).value).toBe("https://api.siliconflow.cn/v1");
    expect((screen.getByLabelText("向量模型") as HTMLInputElement).value).toBe("BAAI/bge-m3");
    expect((screen.getByLabelText("向量维度") as HTMLInputElement).value).toBe("1024");
    expect(screen.getByText(/不占用 AI 供应商里的对话模型/)).toBeTruthy();
  });

  it("saves key and probes connectivity through the product embedding API", async () => {
    render(<EmbeddingSettingsPanel client={client} />);
    await screen.findByRole("heading", { name: "Embedding 提供商" });

    fireEvent.change(screen.getByLabelText("向量模型 API Key"), { target: { value: "sk-embed" } });
    fireEvent.click(screen.getByRole("button", { name: "保存向量模型" }));

    await waitFor(() => expect(client.save).toHaveBeenCalledWith({
      baseUrl: "https://api.siliconflow.cn/v1",
      model: "BAAI/bge-m3",
      dim: 1024,
      apiKey: "sk-embed",
    }));
    expect(notifyMock.success).toHaveBeenCalledWith("向量模型已保存", expect.objectContaining({
      description: expect.stringContaining("立即生效"),
    }));

    fireEvent.click(screen.getByRole("button", { name: "测试连通" }));
    await waitFor(() => expect(client.test).toHaveBeenCalledTimes(1));
    expect(notifyMock.success).toHaveBeenCalledWith("向量模型连通成功", {
      description: "BAAI/bge-m3 · 1024 维",
    });
  });
});
