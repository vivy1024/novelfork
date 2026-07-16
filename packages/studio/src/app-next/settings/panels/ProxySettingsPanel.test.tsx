import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const proxyClientMock = vi.hoisted(() => ({
  get: vi.fn(),
  updateOutbound: vi.fn(),
  updateProvider: vi.fn(),
  updateGateway: vi.fn(),
  updateHook: vi.fn(),
}));

vi.mock("../../runtime-admin/proxy-overrides", () => ({
  createProxyOverridesClient: () => proxyClientMock,
}));

import { ProxySettingsPanel } from "./ProxySettingsPanel";

const canonicalTarget = {
  kind: "provider" as const,
  section: "customApiProviders" as const,
  id: "provider-1",
  name: "Canonical Responses",
  badge: "Custom API",
  proxy: { mode: "direct" as const },
};

beforeEach(() => {
  proxyClientMock.get.mockResolvedValue({
    outbound: { mode: "system" },
    providers: [
      { kind: "builtin", key: "kiro", name: "Kiro", proxy: { mode: "direct" } },
      canonicalTarget,
      {
        kind: "provider",
        section: "openaiProviders",
        id: "provider-1",
        name: "OpenAI 派生缓存",
        badge: "OpenAI",
        proxy: { mode: "system" },
      },
      {
        kind: "provider",
        section: "nugProviders",
        id: "nug-1",
        name: "NUG 本地",
        badge: "NUG",
        proxy: { mode: "custom", url: "http://127.0.0.1:7890" },
      },
    ],
    gateways: [{ platform: "telegram", proxy: { mode: "system" } }],
    hooks: [{
      id: "hook-1",
      name: "https://example.com/hook",
      scope: "project",
      proxy: { mode: "custom", url: "http://127.0.0.1:7890" },
    }],
  });
  proxyClientMock.updateOutbound.mockResolvedValue({});
  proxyClientMock.updateProvider.mockResolvedValue({});
  proxyClientMock.updateGateway.mockResolvedValue(undefined);
  proxyClientMock.updateHook.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProxySettingsPanel", () => {
  it("provider 覆盖只显示 canonical 标准 API，同时保留 Gateway 与 Hook 覆盖", async () => {
    render(<ProxySettingsPanel />);

    expect(await screen.findByRole("heading", { name: "代理管理" })).toBeTruthy();
    expect(screen.getByText("Canonical Responses")).toBeTruthy();
    expect(screen.queryByText("Kiro")).toBeNull();
    expect(screen.queryByText("OpenAI 派生缓存")).toBeNull();
    expect(screen.queryByText("NUG 本地")).toBeNull();
    expect(screen.getByText("Telegram")).toBeTruthy();
    expect(screen.getByText("https://example.com/hook")).toBeTruthy();
    expect(proxyClientMock.get).toHaveBeenCalledTimes(1);
  });

  it("只通过 Runtime boundary 保存 canonical provider 覆盖", async () => {
    render(<ProxySettingsPanel />);
    await screen.findByText("Canonical Responses");

    fireEvent.click(screen.getAllByRole("button", { name: "保存覆盖" })[0]!);

    await waitFor(() => {
      expect(proxyClientMock.updateProvider).toHaveBeenCalledWith(canonicalTarget, { mode: "direct" });
    });
    expect(proxyClientMock.updateProvider).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: "已保存" })).toBeTruthy();
  });
});
