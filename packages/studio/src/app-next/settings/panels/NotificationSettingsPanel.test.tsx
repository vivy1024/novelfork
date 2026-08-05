import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clients = vi.hoisted(() => ({
  preferences: {
    get: vi.fn(),
    patch: vi.fn(),
  },
  sounds: {
    upload: vi.fn(),
    delete: vi.fn(),
    testDingtalk: vi.fn(),
    testFeishu: vi.fn(),
  },
}));

const soundEngine = vi.hoisted(() => ({
  playBuiltinSound: vi.fn(),
}));

vi.mock("../../runtime-admin", () => ({
  createUserPreferencesClient: () => clients.preferences,
  createNotificationSoundsClient: () => clients.sounds,
}));

// The Bridge module resolves to the Runtime sound engine at build time. Keep the
// real id list so a drift between Studio and Runtime fails this suite.
vi.mock("@vivy1024/narrafork-runtime-bridge/frontend/notification-sound", () => ({
  BUILTIN_SOUND_NAMES: ["gentle", "chime", "alert", "soft"],
  playBuiltinSound: soundEngine.playBuiltinSound,
}));

import { NotificationSettingsPanel, BUILTIN_SOUND_OPTIONS } from "./NotificationSettingsPanel";

const basePreferences = {
  notifyOnDone: true,
  notifyOnWaiting: true,
  notifyPwaEnabled: false,
  notifySoundEnabled: true,
  notifySoundType: "builtin" as const,
  notifySoundBuiltin: "gentle",
  notifySoundFileId: null,
  notifyDingtalkEnabled: false,
  notifyDingtalkWebhook: "",
  notifyDingtalkSecret: "",
  notifyFeishuEnabled: false,
  notifyFeishuWebhook: "",
  notifyFeishuSecret: "",
  autoLoadOlderMessages: true,
  fastModeDefault: false,
  language: "zh-CN",
  wordWrapMarkdown: true,
  wordWrapCode: true,
  wordWrapDiff: true,
  replyInUserLanguage: true,
  showTokenUsage: true,
  showOutputStats: true,
  terminalTheme: "default",
  terminalFontSize: 14,
  addSubagentToRecentTabs: false,
  enterQueueMode: "turn" as const,
  ctrlEnterQueueMode: "tool" as const,
  commands: [],
};

function setNotificationPermission(
  permission: NotificationPermission | undefined,
  requestPermission?: () => Promise<NotificationPermission>,
) {
  if (permission === undefined) {
    Reflect.deleteProperty(globalThis, "Notification");
    return;
  }
  Object.defineProperty(globalThis, "Notification", {
    configurable: true,
    writable: true,
    value: {
      permission,
      requestPermission: requestPermission ?? vi.fn().mockResolvedValue(permission),
    },
  });
}

describe("NotificationSettingsPanel", () => {
  beforeEach(() => {
    clients.preferences.get.mockResolvedValue(basePreferences);
    clients.preferences.patch.mockImplementation((patch: Record<string, unknown>) =>
      Promise.resolve({ ...basePreferences, ...patch }),
    );
    setNotificationPermission("granted");
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    setNotificationPermission(undefined);
  });

  it("内置提示音选项来自 Runtime 引擎，不含 Runtime 无法播放的 id", () => {
    const values = BUILTIN_SOUND_OPTIONS.map((option) => option.value);

    expect(values).toEqual(["gentle", "chime", "alert", "soft"]);
    // `bell` / `pop` were hardcoded before and cannot be played by the Runtime.
    expect(values).not.toContain("bell");
    expect(values).not.toContain("pop");
    expect(BUILTIN_SOUND_OPTIONS.every((option) => option.label.length > 0)).toBe(true);
  });

  it("渲染内置提示音选择器并展示当前选中项", async () => {
    render(<NotificationSettingsPanel />);
    await waitFor(() => expect(screen.getByLabelText("声音提醒")).toBeTruthy());

    expect(screen.getByLabelText("内置提示音")).toBeTruthy();
    expect(screen.getByText("柔和")).toBeTruthy();
  });

  it("试听按钮用 Runtime 引擎播放当前选中的提示音", async () => {
    render(<NotificationSettingsPanel />);
    await waitFor(() => expect(screen.getByLabelText("试听提示音")).toBeTruthy());

    fireEvent.click(screen.getByLabelText("试听提示音"));

    expect(soundEngine.playBuiltinSound).toHaveBeenCalledWith("gentle");
  });

  it("面板源码不再硬编码内置提示音枚举", () => {
    // Keep the specifier in a variable: Vite rewrites a literal
    // `new URL("./x", import.meta.url)` into an asset URL, which is not a file path.
    const panelFile = "NotificationSettingsPanel.tsx";
    const source = readFileSync(new URL(panelFile, import.meta.url), "utf8");
    expect(source).toContain("BUILTIN_SOUND_NAMES");
    expect(source).toContain("@vivy1024/narrafork-runtime-bridge/frontend/notification-sound");
    expect(source).not.toMatch(/value: "bell"|value: "pop"/);
  });

  it("未授权时提示无效并可请求浏览器通知权限", async () => {
    const requestPermission = vi.fn().mockResolvedValue("granted" as NotificationPermission);
    setNotificationPermission("default", requestPermission);

    render(<NotificationSettingsPanel />);
    await waitFor(() => expect(screen.getByText("尚未授予通知权限")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /请求通知权限/ }));

    await waitFor(() => expect(requestPermission).toHaveBeenCalledTimes(1));
    // Granting the browser permission is what actually makes delivery work, so
    // the preference is only enabled after the browser said yes.
    await waitFor(() =>
      expect(clients.preferences.patch).toHaveBeenCalledWith({ notifyPwaEnabled: true }),
    );
    await waitFor(() => expect(screen.queryByText("尚未授予通知权限")).toBeNull());
  });

  it("浏览器已拒绝时说明开关不会生效", async () => {
    setNotificationPermission("denied");

    render(<NotificationSettingsPanel />);

    await waitFor(() => expect(screen.getByText("浏览器已拒绝通知权限")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /请求通知权限/ })).toBeNull();
  });

  it("环境不支持 Notification 时禁用开关并解释原因", async () => {
    setNotificationPermission(undefined);

    render(<NotificationSettingsPanel />);

    await waitFor(() => expect(screen.getByText("当前环境不支持系统通知")).toBeTruthy());
    expect((screen.getByLabelText("PWA / 系统通知") as HTMLButtonElement).disabled).toBe(true);
  });

  it("钉钉测试连接调用 Runtime 探测接口并展示成功结果", async () => {
    clients.preferences.get.mockResolvedValue({
      ...basePreferences,
      notifyDingtalkWebhook: "https://oapi.dingtalk.com/robot/send?access_token=t",
      notifyDingtalkSecret: "SEC***",
    });
    clients.sounds.testDingtalk.mockResolvedValue({ ok: true, message: "已发送测试消息" });

    render(<NotificationSettingsPanel />);
    await waitFor(() => expect(screen.getByText("钉钉通知")).toBeTruthy());

    const testButtons = screen.getAllByRole("button", { name: /测试连接/ });
    fireEvent.click(testButtons[0]);

    await waitFor(() =>
      expect(clients.sounds.testDingtalk).toHaveBeenCalledWith(
        "https://oapi.dingtalk.com/robot/send?access_token=t",
        "SEC***",
      ),
    );
    await waitFor(() => expect(screen.getByText("测试成功")).toBeTruthy());
    expect(screen.getByText("已发送测试消息")).toBeTruthy();
  });

  it("飞书测试失败时展示 Runtime 返回的失败原因", async () => {
    clients.preferences.get.mockResolvedValue({
      ...basePreferences,
      notifyFeishuWebhook: "https://open.feishu.cn/open-apis/bot/v2/hook/x",
    });
    clients.sounds.testFeishu.mockResolvedValue({
      ok: false,
      code: "NOTIFICATION_FEISHU_WEBHOOK_FAILED",
      reason: "upstream returned 500",
    });

    render(<NotificationSettingsPanel />);
    await waitFor(() => expect(screen.getByText("飞书通知")).toBeTruthy());

    const testButtons = screen.getAllByRole("button", { name: /测试连接/ });
    fireEvent.click(testButtons[1]);

    await waitFor(() => expect(screen.getByText("测试失败")).toBeTruthy());
    expect(screen.getByText("upstream returned 500")).toBeTruthy();
  });

  it("Webhook 为空时不发请求，直接提示先填地址", async () => {
    render(<NotificationSettingsPanel />);
    await waitFor(() => expect(screen.getByText("钉钉通知")).toBeTruthy());

    fireEvent.click(screen.getAllByRole("button", { name: /测试连接/ })[0]);

    await waitFor(() => expect(screen.getByText(/请先填写 Webhook 地址/)).toBeTruthy());
    expect(clients.sounds.testDingtalk).not.toHaveBeenCalled();
  });
});
