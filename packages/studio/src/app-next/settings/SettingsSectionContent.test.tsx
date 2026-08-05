import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const accountClientMock = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
const preferencesClientMock = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
const settingsClientMock = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), testModel: vi.fn(), generateTls: vi.fn(), checkUpdate: vi.fn(), addRetryRule: vi.fn() }));
const soundsClientMock = vi.hoisted(() => ({ upload: vi.fn(), delete: vi.fn() }));

vi.mock("../runtime-admin", async (importOriginal) => ({
  ...await importOriginal<typeof import("../runtime-admin")>(),
  createAccountProfileClient: () => accountClientMock,
  createUserPreferencesClient: () => preferencesClientMock,
  createSettingsClient: () => settingsClientMock,
  createNotificationSoundsClient: () => soundsClientMock,
}));

vi.mock("@/components/ui/simple-select", () => ({
  SimpleSelect: ({ value, onValueChange, options, placeholder, "aria-label": ariaLabel }: {
    value: string;
    onValueChange: (value: string) => void;
    options: Array<{ value: string; label: string }>;
    placeholder?: string;
    "aria-label"?: string;
  }) => (
    <select aria-label={ariaLabel} value={value} onChange={(event) => onValueChange(event.currentTarget.value)}>
      {placeholder && !options.some((option) => option.value === "") ? <option value="">{placeholder}</option> : null}
      {options.map((option) => <option key={`${ariaLabel}-${option.value}`} value={option.value}>{option.label}</option>)}
    </select>
  ),
}));

import { SettingsSectionContent } from "./SettingsSectionContent";

const account = {
  id: "user-1",
  username: "writer",
  role: "admin",
  avatarColor: null,
  avatarImageId: null,
  gitUsername: "Old Name",
  gitEmail: "old@example.com",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const initialPreferences = {
  autoLoadOlderMessages: true,
  fastModeDefault: false,
  language: "zh-CN",
  wordWrapMarkdown: true,
  wordWrapCode: false,
  wordWrapDiff: true,
  replyInUserLanguage: true,
  showTokenUsage: true,
  showOutputStats: false,
  terminalTheme: "dark",
  terminalFontSize: 14,
  notifyOnDone: true,
  notifyOnWaiting: true,
  notifyPwaEnabled: false,
  notifySoundEnabled: true,
  notifySoundType: "builtin",
  notifySoundBuiltin: "gentle",
  notifySoundFileId: null,
  notifyDingtalkEnabled: false,
  notifyDingtalkWebhook: "********1234",
  notifyDingtalkSecret: "********5678",
  notifyFeishuEnabled: false,
  notifyFeishuWebhook: "********abcd",
  notifyFeishuSecret: "********efgh",
};

const runtimeSettings = {
  server: {
    port: 7778,
    host: "localhost",
    openBrowser: "browser",
    tls: { enabled: false, certFile: "", keyFile: "", passphrase: "********" },
  },
      paths: { defaultProjectDir: "D:/projects" },
      update: {
        serverUrl: "https://updates.example.com",

    product: "narrafork",
    channel: "stable",
    checkIntervalMinutes: 60,
    autoDownload: false,
  },
  proxy: { mode: "system" },
  agent: {
    defaultModel: "kiro:sonnet",
    summaryModel: "kiro:haiku",
    defaultPermissionMode: "acceptEdits",
    defaultStartInPlanMode: false,
    maxTurns: 100,
    subagentModels: { explore: "", plan: "", search: "" },
    subagentAllowedModels: { explore: ["kiro:sonnet"], plan: [], general: ["kiro:haiku"], search: [] },
    modelAggregations: [{ id: "fast", name: "Fast", models: ["kiro:sonnet", "kiro:haiku"], routingMode: "priority" }],
    legacyEncoding: false,
    freshShellEnv: false,
    translateReasoning: false,
    requestDumpEnabled: false,
    requestDumpErrorsOnly: false,
    defaultRelaxedPlan: false,
    planModeAllowInlinePlan: true,
    planReflectionAutoApprove: false,
    dangerReflectionLevel: "standard",
    dangerReflectionEnabled: true,
    dangerSkipReadOnlyConfirmations: false,
    maxTransientRetries: 10,
    retryBackoffCeilMs: 20000,
    firstTokenTimeoutMs: 300000,
    whitelistDirs: [{ path: "D:/books", accessLevel: "write", enabled: true }],
    blacklistDirs: [{ path: "D:/secrets", denyLevel: "all", enabled: true }],
    commandWhitelist: [{ pattern: "git status", enabled: true }],
    commandBlacklist: [{ pattern: "rm -rf", denyPrompt: "destructive", enabled: true }],
    customRetryRules: [],
  },
  codex: { defaultReasoningEffort: "medium" },
  kiroModels: [{ id: "sonnet", name: "Sonnet" }, { id: "haiku", name: "Haiku" }],
};

beforeEach(() => {
  let preferences = { ...initialPreferences };
  accountClientMock.get.mockResolvedValue(account);
  accountClientMock.patch.mockResolvedValue({ ok: true });
  preferencesClientMock.get.mockImplementation(async () => preferences);
  preferencesClientMock.patch.mockImplementation(async (patch) => {
    preferences = { ...preferences, ...patch };
    return preferences;
  });
  settingsClientMock.get.mockResolvedValue(runtimeSettings);
  settingsClientMock.patch.mockImplementation(async (patch) => ({ ...runtimeSettings, ...patch }));
  settingsClientMock.testModel.mockResolvedValue({ text: "ok", requestUrls: [] });
  settingsClientMock.generateTls.mockResolvedValue({ certPath: "C:/tls/cert.pem", keyPath: "C:/tls/key.pem", expiresAt: "2027-01-01", newUrl: "https://localhost:7778", serverRestarting: true });
  settingsClientMock.checkUpdate.mockResolvedValue({ updateAvailable: true, currentVersion: "0.5.4", latestVersion: "0.6.0" });
  settingsClientMock.addRetryRule.mockResolvedValue({ id: "rule-1", domain: "api.example.com", enabled: true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SettingsSectionContent Runtime-native settings", () => {
  it("reads /api/auth/me and PATCHes only changed Git identity fields", async () => {
    render(<SettingsSectionContent sectionId="profile" />);

    expect(await screen.findByDisplayValue("writer")).toHaveProperty("readOnly", true);
    expect(screen.getByDisplayValue("管理员")).toHaveProperty("readOnly", true);
    expect(screen.queryByText("笔名")).toBeNull();
    expect(screen.queryByText("个人简介")).toBeNull();

    fireEvent.change(screen.getByLabelText("Git 用户名"), { target: { value: "New Name" } });
    fireEvent.click(screen.getByRole("button", { name: "保存 Git 身份" }));

    await waitFor(() => expect(accountClientMock.patch).toHaveBeenCalledWith({ gitUsername: "New Name" }));
  });

  it("keeps theme browser-local and PATCHes Runtime appearance fields individually", async () => {
    render(<SettingsSectionContent sectionId="appearance" />);
    await screen.findByRole("heading", { name: "外观与界面" });

    fireEvent.click(screen.getByRole("button", { name: "深色" }));
    expect(preferencesClientMock.patch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("Markdown 自动换行"));
    await waitFor(() => expect(preferencesClientMock.patch).toHaveBeenCalledWith({ wordWrapMarkdown: false }));
    expect(screen.getByText(/浏览器本地设置/)).toBeTruthy();
  });

  it("PATCHes notification toggles without masked secrets and only sends changed webhook credentials", async () => {
    render(<SettingsSectionContent sectionId="notifications" />);
    await screen.findByRole("heading", { name: "通知" });

    fireEvent.click(screen.getByLabelText("任务完成"));
    await waitFor(() => expect(preferencesClientMock.patch).toHaveBeenCalledWith({ notifyOnDone: false }));
    expect(preferencesClientMock.patch.mock.calls[0][0]).not.toHaveProperty("notifyDingtalkSecret");

    fireEvent.change(screen.getByLabelText("钉钉通知 Webhook"), { target: { value: "https://oapi.dingtalk.com/robot/send?access_token=new" } });
    const dingtalkCard = screen.getByText("钉钉通知", { selector: "[data-slot='card-title']" }).closest("[data-slot='card']");
    if (!dingtalkCard) throw new Error("missing DingTalk card");
    fireEvent.click(within(dingtalkCard).getByRole("button", { name: "保存凭据" }));

    await waitFor(() => expect(preferencesClientMock.patch).toHaveBeenLastCalledWith({
      notifyDingtalkWebhook: "https://oapi.dingtalk.com/robot/send?access_token=new",
    }));
  });

  it("reads and PATCHes exact server/tls/update sections and generates TLS through Runtime", async () => {
    render(<SettingsSectionContent sectionId="server" />);
    await screen.findByRole("heading", { name: "服务器与系统" });

    fireEvent.change(screen.getByLabelText("服务器端口"), { target: { value: "7788" } });
    fireEvent.click(screen.getByRole("button", { name: "保存服务器设置" }));

    await waitFor(() => expect(settingsClientMock.patch).toHaveBeenCalledTimes(1));
    expect(settingsClientMock.patch).toHaveBeenCalledWith({
      server: {
        port: 7788,
        host: "localhost",
        openBrowser: "browser",
        tls: { enabled: false, certFile: "", keyFile: "", passphrase: "********" },
      },
  paths: { defaultProjectDir: "D:/projects" },
  update: {

        serverUrl: "https://updates.example.com",
        product: "narrafork",
        channel: "stable",
        checkIntervalMinutes: 60,
        autoDownload: false,
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "生成自签名证书" }));
    await waitFor(() => expect(settingsClientMock.generateTls).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/https:\/\/localhost:7778/)).toBeTruthy();
  });

  it("preserves subagent model allowlists and model aggregations", async () => {
    render(<SettingsSectionContent sectionId="models" />);
    await screen.findByRole("heading", { name: "模型设置" });

    expect(screen.getByLabelText("explore 允许模型")).toHaveProperty("value", "");
    expect(screen.getByLabelText("general 允许模型")).toHaveProperty("value", "");
    expect(screen.getAllByText("kiro:sonnet（历史配置）").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("kiro:haiku（历史配置）").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByLabelText("聚合名称 1")).toHaveProperty("value", "Fast");

    fireEvent.change(screen.getByLabelText("聚合名称 1"), { target: { value: "Fast Updated" } });
    fireEvent.click(screen.getByRole("button", { name: "保存模型设置" }));
    await waitFor(() => expect(settingsClientMock.patch).toHaveBeenCalledWith(expect.objectContaining({
      agent: expect.objectContaining({
        // The fixture predates the review subagent, so the panel normalizes the
        // missing key to an empty allowlist (no extra restriction) rather than
        // dropping it from the payload.
        subagentAllowedModels: { ...runtimeSettings.agent.subagentAllowedModels, review: [] },
        modelAggregations: [{ ...runtimeSettings.agent.modelAggregations[0], name: "Fast Updated" }],
      }),
    })));
  });

  it("uses exact Runtime permission values, creates retry rules, and hides unsupported legacy controls", async () => {
    render(<SettingsSectionContent sectionId="agents" />);
    await screen.findByRole("heading", { name: "AI 代理" });

    expect(screen.getByLabelText("默认权限模式").textContent).toContain("bypassPermissions");
    expect(screen.queryByText("YOLO 模式")).toBeNull();
    expect(screen.queryByText("循环检测灵敏度")).toBeNull();
    expect(screen.queryByText("Token 消耗警告阈值")).toBeNull();
    expect(screen.queryByText("最大连续失败次数")).toBeNull();
    expect(screen.getByDisplayValue("D:/books")).toBeTruthy();
    expect(screen.getByDisplayValue("D:/secrets")).toBeTruthy();
    expect(screen.getByDisplayValue("git status")).toBeTruthy();
    expect(screen.getByDisplayValue("rm -rf")).toBeTruthy();
    expect(screen.getByLabelText("显示 Token 用量")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("显示 Token 用量"));
    await waitFor(() => expect(preferencesClientMock.patch).toHaveBeenCalledWith({ showTokenUsage: false }));

    fireEvent.change(screen.getByLabelText("Agent 最大轮次"), { target: { value: "101" } });
    fireEvent.click(screen.getByRole("button", { name: "保存 Agent 设置" }));
    await waitFor(() => expect(settingsClientMock.patch).toHaveBeenCalledWith(expect.objectContaining({
      agent: expect.objectContaining({
        whitelistDirs: [{ path: "D:/books", accessLevel: "readWrite", enabled: true }],
        blacklistDirs: [{ path: "D:/secrets", denyLevel: "denyAll", enabled: true }],
        commandWhitelist: [{ pattern: "git status", enabled: true }],
        commandBlacklist: [{ pattern: "rm -rf", denyPrompt: "destructive", enabled: true }],
      }),
    })));

    fireEvent.change(screen.getByLabelText("重试规则域名"), { target: { value: "api.example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "创建重试规则" }));
    await waitFor(() => expect(settingsClientMock.addRetryRule).toHaveBeenCalledWith({ domain: "api.example.com" }));
  });

  it("keeps the old hardening route as an honest no-request notice", () => {
    render(<SettingsSectionContent sectionId="agent-hardening" />);
    expect(screen.getByText("旧加固字段已停用")).toBeTruthy();
    expect(settingsClientMock.get).not.toHaveBeenCalled();
  });
});
