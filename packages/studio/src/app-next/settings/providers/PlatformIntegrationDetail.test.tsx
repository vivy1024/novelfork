import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlatformIntegrationDetail } from "./PlatformIntegrationDetail";
import type { PlatformAccount } from "../provider-types";

describe("PlatformIntegrationDetail", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders real platform account actions without unimplemented placeholders", async () => {
    const account: PlatformAccount = {
      id: "codex-acct-1",
      platformId: "codex",
      displayName: "主力 ChatGPT",
      email: "writer@example.com",
      accountId: "acct_123",
      authMode: "json-account",
      status: "active",
      current: false,
      priority: 1,
      successCount: 0,
      failureCount: 0,
      credentialSource: "json",
    };
    const listAccounts = vi.fn(() => Promise.resolve({ accounts: [account] }));
    const importJsonAccount = vi.fn();
    const refreshQuota = vi.fn(() => Promise.resolve({ account }));
    const setCurrent = vi.fn(() => Promise.resolve({ account: { ...account, current: true } }));
    const updateAccountStatus = vi.fn(() => Promise.resolve({ account: { ...account, status: "disabled" as const, current: true } }));
    const deleteAccount = vi.fn(() => Promise.resolve({ success: true }));

    render(
      <PlatformIntegrationDetail
        integration={{ id: "codex", name: "Codex", description: "导入 Codex JSON 账号数据。", enabled: true, supportedImportMethods: ["json-account"], modelCount: 2 }}
        onBack={vi.fn()}
        listAccounts={listAccounts}
        importJsonAccount={importJsonAccount}
        refreshAccountQuota={refreshQuota}
        setCurrentAccount={setCurrent}
        updateAccountStatus={updateAccountStatus}
        deleteAccount={deleteAccount}
        onAccountImported={vi.fn()}
      />,
    );

    await waitFor(() => expect(listAccounts).toHaveBeenCalledWith("codex"));
    expect(screen.queryByText(/后续接入|暂未接入|即将推出|UnsupportedCapability/)).toBeNull();
    expect(screen.getByRole("button", { name: "刷新配额" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "设为当前" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "停用" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "删除" })).toBeTruthy();
  });
});
