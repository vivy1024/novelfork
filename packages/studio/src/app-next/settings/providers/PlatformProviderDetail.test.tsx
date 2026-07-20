import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RuntimePlatformProvidersClient, RuntimeSettings } from "../../runtime-admin";
import { PlatformProviderDetail } from "./PlatformProviderDetail";

const settings = {
  agent: { hiddenModels: [], customModels: [], modelContextWindows: {} },
  codex: {
    defaultReasoningEffort: "medium",
    useWebSearch: true,
    useImageGeneration: true,
  },
  codexModels: ["gpt-5-codex"],
  kiroModels: [{ model_id: "claude-sonnet-4.5", model_short_name: "Sonnet" }],
  clineProviders: [{ id: "cline-main", name: "Cline", prefix: "cline", baseUrl: "https://openrouter.ai/api/v1", defaultModel: "anthropic/claude", enabledModels: [] }],
  clineModelsGrouped: [{ providerId: "cline-main", providerName: "Cline", models: [{ id: "anthropic/claude" }] }],
} as RuntimeSettings;

const patchSettings = vi.fn(async () => settings);
const reloadSettings = vi.fn(async () => settings);

afterEach(() => cleanup());

describe("PlatformProviderDetail", () => {
  it("renders a flat Codex status snapshot and saves the reordered tier order", async () => {
    const codexStatus = vi.fn<RuntimePlatformProvidersClient["codexStatus"]>(async () => ({
      total: 2,
      available: 1,
      currentId: "credential-1",
      entries: [
        { id: "credential-1", email: "active@example.test", disabled: false, tier: "pro" },
        { id: "credential-2", email: "disabled@example.test", disabled: true, tier: "plus" },
      ],
      loadBalancingMode: "tier-balanced",
      tierOrder: ["pro", "plus", "free"],
    }));
    const codexSetTierOrder = vi.fn<RuntimePlatformProvidersClient["codexSetTierOrder"]>(async () => ({ ok: true }));

    render(
      <PlatformProviderDetail
        platform="codex"
        settings={settings}
        client={{ codexStatus, codexSetTierOrder }}
        onBack={() => undefined}
        onPatchSettings={patchSettings}
        onReloadSettings={reloadSettings}
      />,
    );

    expect(await screen.findByText("active@example.test")).toBeTruthy();
    expect(screen.getByText("disabled@example.test")).toBeTruthy();
    expect(screen.getByText("账号总数").parentElement?.textContent).toContain("2");
    expect(screen.getByText("可用账号").parentElement?.textContent).toContain("1");

    fireEvent.click(screen.getByRole("button", { name: "下移套餐 pro" }));
    fireEvent.click(screen.getByRole("button", { name: "保存套餐顺序" }));

    await waitFor(() => expect(codexSetTierOrder).toHaveBeenCalledWith(["plus", "pro", "free"]));
    await waitFor(() => expect(reloadSettings).toHaveBeenCalled());
  });

  it("manages Kiro credential metadata, priority, and on-demand usage", async () => {
    const kiroStatus = vi.fn<RuntimePlatformProvidersClient["kiroStatus"]>(async () => ({
      available: true,
      snapshot: {
        total: 1,
        available: 1,
        entries: [{ id: "kiro-1", email: "kiro@example.test", displayName: "旧名称", priority: 1, region: "us-east-1" }],
      },
    }));
    const kiroUpdateCredential = vi.fn<RuntimePlatformProvidersClient["kiroUpdateCredential"]>(async () => ({ ok: true }));
    const kiroSetCredentialPriority = vi.fn<RuntimePlatformProvidersClient["kiroSetCredentialPriority"]>(async () => ({ ok: true }));
    const kiroGetCredentialUsage = vi.fn<RuntimePlatformProvidersClient["kiroGetCredentialUsage"]>(async () => ({ used: 10, limit: 100 }));

    render(
      <PlatformProviderDetail
        platform="kiro"
        settings={settings}
        client={{ kiroStatus, kiroUpdateCredential, kiroSetCredentialPriority, kiroGetCredentialUsage }}
        onBack={() => undefined}
        onPatchSettings={patchSettings}
        onReloadSettings={reloadSettings}
      />,
    );

    const row = (await screen.findByText("旧名称")).closest("tr");
    expect(row).toBeTruthy();
    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "编辑" }));
    const editDialog = screen.getByRole("dialog", { name: "编辑账号凭据" });
    fireEvent.change(within(editDialog).getByLabelText("显示名称"), { target: { value: "新名称" } });
    fireEvent.change(within(editDialog).getByLabelText("优先级"), { target: { value: "5" } });
    fireEvent.click(within(editDialog).getByRole("button", { name: "保存" }));

    await waitFor(() => expect(kiroUpdateCredential).toHaveBeenCalledWith("kiro-1", expect.objectContaining({ displayName: "新名称", email: "kiro@example.test", region: "us-east-1" })));
    await waitFor(() => expect(kiroSetCredentialPriority).toHaveBeenCalledWith("kiro-1", 5));

    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "用量" }));
    await waitFor(() => expect(kiroGetCredentialUsage).toHaveBeenCalledWith("kiro-1"));
    expect(await screen.findByText("已用：")).toBeTruthy();
  });

  it("shows Cline balance and enables a recommended model through its platform route", async () => {
    const clineStatus = vi.fn<RuntimePlatformProvidersClient["clineStatus"]>(async () => ({ authenticated: true, email: "cline@example.test" }));
    const clineBalance = vi.fn<RuntimePlatformProvidersClient["clineBalance"]>(async () => ({ balance: 12.5, currency: "USD" }));
    const clinePoolCount = vi.fn<RuntimePlatformProvidersClient["clinePoolCount"]>(async () => ({ count: 4 }));
    const clineRecommendedModels = vi.fn<RuntimePlatformProvidersClient["clineRecommendedModels"]>(async () => ({ recommended: [], free: [{ id: "openrouter/free", name: "Free Model" }] }));
    const clineSetEnabledModels = vi.fn<RuntimePlatformProvidersClient["clineSetEnabledModels"]>(async () => ({ ok: true, count: 1 }));

    render(
      <PlatformProviderDetail
        platform="cline"
        settings={settings}
        client={{ clineStatus, clineBalance, clinePoolCount, clineRecommendedModels, clineSetEnabledModels }}
        onBack={() => undefined}
        onPatchSettings={patchSettings}
        onReloadSettings={reloadSettings}
      />,
    );

    expect(await screen.findByText("余额：12.50 USD")).toBeTruthy();
    const freeModel = screen.getByText("Free Model").closest("div");
    fireEvent.click(within(freeModel as HTMLElement).getByRole("button", { name: "启用" }));
    await waitFor(() => expect(clineSetEnabledModels).toHaveBeenCalledWith(["openrouter/free"]));
  });
});
