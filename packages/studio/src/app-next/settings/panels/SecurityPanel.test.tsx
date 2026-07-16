import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SecurityClient, SecuritySnapshot, SecurityStatus } from "../../runtime-admin/security";
import { SecurityPanel } from "./SecurityPanel";

const baseStatus: SecurityStatus = {
  mfaEnabled: false,
  totpEnabled: false,
  backupCodesRemaining: 0,
  passkeyCount: 1,
};

const baseSnapshot: SecuritySnapshot = {
  status: baseStatus,
  passkeys: [{
    id: "pk-1",
    name: "Windows Hello",
    deviceType: "multiDevice",
    backedUp: true,
    lastUsedAt: "2026-05-02T12:00:00.000Z",
    createdAt: "2026-04-01T12:00:00.000Z",
  }],
  providers: [{ id: "company", name: "Company SSO" }],
  identities: [{
    id: "identity-1",
    provider: "company",
    email: "writer@example.com",
    displayName: "Writer",
    lastLoginAt: "2026-05-03T12:00:00.000Z",
    createdAt: "2026-04-03T12:00:00.000Z",
  }],
};

function createClient(snapshot: SecuritySnapshot = baseSnapshot, refreshedStatus: SecurityStatus = snapshot.status) {
  return {
    getStatus: vi.fn().mockResolvedValue(refreshedStatus),
    getSnapshot: vi.fn().mockResolvedValue(snapshot),
    setMfaEnabled: vi.fn().mockImplementation(async (enabled: boolean) => ({ ok: true, mfaEnabled: enabled })),
    setupTotp: vi.fn().mockResolvedValue({
      secret: "JBSWY3DPEHPK3PXP",
      uri: "otpauth://totp/NarraFork:test",
      qrDataUrl: "data:image/png;base64,AA==",
    }),
    activateTotp: vi.fn().mockResolvedValue({ ok: true, backupCodes: ["backup-one", "backup-two"] }),
    disableTotp: vi.fn().mockResolvedValue({ ok: true }),
    listPasskeys: vi.fn().mockResolvedValue(snapshot.passkeys),
    renamePasskey: vi.fn().mockResolvedValue({ ok: true }),
    deletePasskey: vi.fn().mockResolvedValue({ ok: true }),
    listProviders: vi.fn().mockResolvedValue(snapshot.providers),
    listIdentities: vi.fn().mockResolvedValue(snapshot.identities),
    startIdentityLink: vi.fn().mockResolvedValue({ authorizeUrl: "https://idp.example/authorize" }),
    unlinkIdentity: vi.fn().mockResolvedValue({ ok: true }),
  } satisfies SecurityClient;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SecurityPanel", () => {
  it("reads real security, Passkey, provider, and linked identity state", async () => {
    const client = createClient();
    render(<SecurityPanel client={client} />);

    expect(await screen.findByRole("heading", { name: "账户安全" })).toBeTruthy();
    expect(client.getSnapshot).toHaveBeenCalledTimes(1);
    expect(screen.getByText("1 个 Passkey")).toBeTruthy();
    expect(screen.getByText("Windows Hello")).toBeTruthy();
    expect(screen.getByText(/最近使用 2026-05-02/)).toBeTruthy();
    expect(screen.getAllByText("Company SSO").length).toBeGreaterThan(0);
    expect(screen.getByText(/writer@example.com/)).toBeTruthy();
  });

  it("completes TOTP setup, activation, backup-code acknowledgement, and MFA opt-in", async () => {
    const activeStatus = { ...baseStatus, totpEnabled: true, backupCodesRemaining: 2 };
    const client = createClient(baseSnapshot, activeStatus);
    client.getStatus
      .mockResolvedValueOnce(activeStatus)
      .mockResolvedValueOnce({ ...activeStatus, mfaEnabled: true });
    render(<SecurityPanel client={client} />);
    await screen.findByRole("heading", { name: "账户安全" });

    fireEvent.click(screen.getByRole("button", { name: "设置身份验证器" }));
    expect(await screen.findByAltText("TOTP 设置二维码")).toBeTruthy();
    expect(screen.getByText("JBSWY3DPEHPK3PXP")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    fireEvent.change(screen.getByLabelText("TOTP 验证码"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "激活" }));

    expect(await screen.findByText("backup-one")).toBeTruthy();
    expect(client.activateTotp).toHaveBeenCalledWith("123456");
    fireEvent.click(screen.getByRole("button", { name: /我已保存，完成设置/ }));

    await waitFor(() => expect(client.setMfaEnabled).toHaveBeenCalledWith(true));
    expect(client.getStatus).toHaveBeenCalled();
  });

  it("disables TOTP only after providing a verification credential", async () => {
    const enabledStatus = { ...baseStatus, totpEnabled: true, backupCodesRemaining: 8 };
    const disabledStatus = { ...enabledStatus, totpEnabled: false, backupCodesRemaining: 0 };
    const client = createClient({ ...baseSnapshot, status: enabledStatus }, disabledStatus);
    render(<SecurityPanel client={client} />);
    await screen.findByRole("heading", { name: "账户安全" });

    fireEvent.click(screen.getByRole("button", { name: "停用" }));
    const confirmButton = screen.getByRole("button", { name: "确认停用" });
    expect(confirmButton).toHaveProperty("disabled", true);

    fireEvent.change(screen.getByLabelText("停用验证码"), { target: { value: "backup-code" } });
    fireEvent.click(confirmButton);

    await waitFor(() => expect(client.disableTotp).toHaveBeenCalledWith({
      code: "backup-code",
      password: undefined,
    }));
    expect(client.getStatus).toHaveBeenCalled();
  });

  it("renames Passkeys and unlinks SSO identities through Runtime actions", async () => {
    const client = createClient();
    render(<SecurityPanel client={client} />);
    await screen.findByRole("heading", { name: "账户安全" });

    fireEvent.click(screen.getByRole("button", { name: "重命名 Windows Hello" }));
    fireEvent.change(screen.getByLabelText("Passkey 名称"), { target: { value: "笔记本" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(client.renamePasskey).toHaveBeenCalledWith("pk-1", "笔记本"));
    expect(screen.getByText("笔记本")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "解绑" }));
    fireEvent.click(screen.getByRole("button", { name: "确认解绑" }));
    await waitFor(() => expect(client.unlinkIdentity).toHaveBeenCalledWith("identity-1"));
    expect(screen.queryByText(/writer@example.com/)).toBeNull();
  });
});
