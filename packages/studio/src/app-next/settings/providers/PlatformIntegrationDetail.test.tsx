import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlatformIntegrationDetail } from "./PlatformIntegrationDetail";

describe("PlatformIntegrationDetail", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps unsupported platform account actions and Cline JSON import transparent", async () => {
    const listAccounts = vi.fn(() => Promise.resolve({ accounts: [] }));
    const importJsonAccount = vi.fn();

    render(
      <PlatformIntegrationDetail
        integration={{
          id: "cline",
          name: "Cline",
          description: "Cline JSON 导入尚未接入。",
          enabled: false,
          supportedImportMethods: [],
          modelCount: 0,
        }}
        onBack={vi.fn()}
        listAccounts={listAccounts}
        importJsonAccount={importJsonAccount}
        onAccountImported={vi.fn()}
      />,
    );

    await waitFor(() => expect(listAccounts).toHaveBeenCalledWith("cline"));
    expect(screen.getByRole("heading", { name: "Cline JSON 导入未接入" })).toBeTruthy();
    expect(screen.getByText("platform.cline.json-import")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "导入 JSON 账号" })).toBeNull();
    expect(screen.getByRole("heading", { name: "平台账号操作未接入" })).toBeTruthy();
    expect(screen.getByText("platform.account.actions")).toBeTruthy();
    for (const action of ["切换账号（后续接入）", "刷新配额（后续接入）", "删除账号（后续接入）"]) {
      expect(screen.getByRole("button", { name: action }).hasAttribute("disabled")).toBe(true);
    }
  });
});
