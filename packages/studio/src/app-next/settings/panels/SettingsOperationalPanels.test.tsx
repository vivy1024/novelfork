import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const clients = vi.hoisted(() => ({
  storage: {
    cached: vi.fn(),
    cleanup: vi.fn(),
    previewDatabase: vi.fn(),
    cleanupDatabase: vi.fn(),
    vacuumDatabase: vi.fn(),
  },
  usage: {
    list: vi.fn(),
    providers: vi.fn(),
    stats: vi.fn(),
    timeseries: vi.fn(),
    detail: vi.fn(),
  },
  settings: {
    get: vi.fn(),
    patch: vi.fn(),
  },
  health: {
    get: vi.fn(),
  },
}));

// Spread the real module so pure helpers (e.g. describeRuntimeEnvironment) stay
// authentic and only the network-facing client factories are stubbed.
vi.mock("@/app-next/runtime-admin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app-next/runtime-admin")>()),
  RUNTIME_STORAGE_SCAN_PATH: "/api/storage/scan",
  createStorageClient: () => clients.storage,
  createUsageHistoryClient: () => clients.usage,
  createSettingsClient: () => clients.settings,
  createRuntimeHealthClient: () => clients.health,
}));

vi.mock("@/app-next/runtime/auth", () => ({ runtimeFetch: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notify: { success: vi.fn(), error: vi.fn() } }));

import { AboutPanel } from "./AboutPanel";
import { DataPanel, redactRuntimeSettingsForExport } from "./DataPanel";
import { StorageDiagnosticsPanel } from "./StorageDiagnosticsPanel";
import { UsagePanel } from "./UsagePanel";

const emptyStats = {
  totalRequests: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalCacheCreationTokens: 0,
  totalCacheReadTokens: 0,
  totalCacheCreation5mTokens: 0,
  totalCacheCreation1hTokens: 0,
  totalReasoningTokens: 0,
  totalTokens: 0,
  totalCost: 0,
  averageDurationMs: 0,
  averageTtftMs: 0,
};

const emptyTimeseries = {
  granularity: "day",
  points: [],
  bucketCount: 0,
  maxBuckets: 400,
  truncated: false,
  requestedStartDate: "2026-01-01T00:00:00.000Z",
  requestedEndDate: "2026-01-02T00:00:00.000Z",
  effectiveStartDate: "2026-01-01T00:00:00.000Z",
  effectiveEndDate: "2026-01-02T00:00:00.000Z",
  generatedAt: "2026-01-02T00:00:00.000Z",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("运维设置面板", () => {
  it("加载存储缓存并预览默认的 Runtime 数据库清理目标", async () => {
    clients.storage.cached.mockResolvedValue({ cached: false });
    clients.storage.previewDatabase.mockResolvedValue({
      target: "staleSessions",
      olderThanDays: 90,
      approxBytes: 0,
      oldestAt: null,
      counts: { sessions: 0, narrators: 0, descendantNarrators: 0, messages: 0, toolCalls: 0, apiRequests: 0, dumpsCleared: 0 },
      blockedCount: 0,
      warningCodes: [],
      samples: [],
      blocked: [],
    });

    render(<StorageDiagnosticsPanel />);

    await waitFor(() => expect(clients.storage.cached).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: /预览清理/ }));

    await waitFor(() => expect(clients.storage.previewDatabase).toHaveBeenCalledWith({
      target: "staleSessions",
      olderThanDays: 90,
      sampleLimit: 10,
    }));
    expect(await screen.findByText("数据库清理预览")).toBeTruthy();
  });

  it("加载 Runtime 使用列表、提供商、统计和按天时间序列", async () => {
    clients.usage.providers.mockResolvedValue({ providers: ["codex"] });
    clients.usage.list.mockResolvedValue({ records: [], total: 0, page: 1, pageSize: 25, totalPages: 0 });
    clients.usage.stats.mockResolvedValue(emptyStats);
    clients.usage.timeseries.mockResolvedValue(emptyTimeseries);

    render(<UsagePanel />);

    await waitFor(() => {
      expect(clients.usage.providers).toHaveBeenCalledTimes(1);
      expect(clients.usage.list).toHaveBeenCalledWith({ page: 1, pageSize: 25 });
      expect(clients.usage.stats).toHaveBeenCalledWith({
        provider: undefined,
        model: undefined,
        kind: undefined,
        startDate: undefined,
        endDate: undefined,
      });
      expect(clients.usage.timeseries).toHaveBeenCalledWith(expect.any(Object), "day");
    });
  });

  it("图表指标可多选切换，且不能清空到无指标", async () => {
    clients.usage.providers.mockResolvedValue({ providers: [] });
    clients.usage.list.mockResolvedValue({ records: [], total: 0, page: 1, pageSize: 25, totalPages: 0 });
    clients.usage.stats.mockResolvedValue(emptyStats);
    clients.usage.timeseries.mockResolvedValue(emptyTimeseries);

    render(<UsagePanel />);

    // Runtime returns cost / TTFT / cache / metered usage per bucket; these were
    // invisible while the chart hardcoded three bars.
    const costButton = await screen.findByRole("button", { name: "指标 费用" });
    expect(costButton.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "指标 平均首字延迟（ms）" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "指标 计量用量" })).toBeTruthy();

    const tokenButton = screen.getByRole("button", { name: "指标 Token 总数" });
    const requestButton = screen.getByRole("button", { name: "指标 请求数" });
    const errorButton = screen.getByRole("button", { name: "指标 错误数" });
    expect(tokenButton.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(costButton);
    expect(costButton.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(tokenButton);
    expect(tokenButton.getAttribute("aria-pressed")).toBe("false");

    // Removing every metric would render an empty chart, so the last one sticks.
    fireEvent.click(requestButton);
    fireEvent.click(errorButton);
    fireEvent.click(costButton);
    expect(costButton.getAttribute("aria-pressed")).toBe("true");
  });

  it("如实显示使用历史所需的 Runtime 管理员 403 错误", async () => {
    const forbidden = Object.assign(new Error("需要管理员权限"), { status: 403 });
    clients.usage.providers.mockResolvedValue({ providers: [] });
    clients.usage.list.mockRejectedValue(forbidden);
    clients.usage.stats.mockResolvedValue(emptyStats);
    clients.usage.timeseries.mockResolvedValue(emptyTimeseries);

    render(<UsagePanel />);

    expect(await screen.findByText(/403：查看使用历史需要 Runtime 管理员权限/)).toBeTruthy();
  });

  it("对疑似密钥设置以及全部 MCP 环境变量和请求头值进行脱敏", () => {
    expect(redactRuntimeSettingsForExport({
      customApiProviders: [{ apiKey: "real-key", baseUrl: "https://example.com" }],
      mcpServers: [{
        env: { API_TOKEN: "secret", LOG_LEVEL: "debug" },
        headers: { Authorization: "Bearer secret", "X-Trace": "trace-value" },
        command: "node",
      }],
      auth: { password: "secret", visible: "keep" },
      alreadyMasked: "********",
    })).toEqual({
      customApiProviders: [{ apiKey: "[已脱敏]", baseUrl: "https://example.com" }],
      mcpServers: [{
        env: { API_TOKEN: "[已脱敏]", LOG_LEVEL: "[已脱敏]" },
        headers: { Authorization: "[已脱敏]", "X-Trace": "[已脱敏]" },
        command: "node",
      }],
      auth: { password: "[已脱敏]", visible: "keep" },
      alreadyMasked: "[已脱敏]",
    });
  });

  it("使用 Runtime 设置客户端导出且不提供导入操作", async () => {
    clients.settings.get.mockResolvedValue({ update: { channel: "stable" } });
    const createObjectURL = vi.fn(() => "blob:settings");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    render(<DataPanel />);
    fireEvent.click(screen.getByRole("button", { name: /导出已脱敏设置/ }));

    await waitFor(() => expect(clients.settings.get).toHaveBeenCalledTimes(1));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /导入/ })).toBeNull();
  });

  it("显示本地软件包元数据且不执行客户端更新检查", () => {
    clients.health.get.mockResolvedValue({ status: "ok" });
    render(<AboutPanel />);
    expect(screen.getByText(/@vivy1024\/novelfork-studio/)).toBeTruthy();
    expect(screen.getByText(/标准桌面二进制/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /检查更新/ })).toBeNull();
  });

  it("展示 Runtime 构建标识以便用户反馈问题时定位版本", async () => {
    // Shape verified against a live /api/health response: runtimeEnvironment is a
    // structured object, so rendering it raw would print "[object Object]".
    clients.health.get.mockResolvedValue({
      status: "ok",
      readiness: "ready",
      version: "0.5.18",
      commit: "a9fec772",
      platform: "windows",
      gitAvailable: true,
      runtimeEnvironment: {
        android: false,
        proot: false,
        termux: false,
        containerSupport: false,
        containerUnsupportedReason: "Container management is only supported on Linux",
      },
    });

    render(<AboutPanel />);

    await waitFor(() => expect(screen.getByText("0.5.18")).toBeTruthy());
    expect(screen.getByText("a9fec772")).toBeTruthy();
    expect(screen.getByText("windows")).toBeTruthy();
    expect(screen.getByText(/标准桌面环境 · 容器不可用 · Git 可用/)).toBeTruthy();
    expect(screen.getByText(/Container management is only supported on Linux/)).toBeTruthy();
    expect(screen.queryByText(/\[object Object\]/)).toBeNull();
    // A live Runtime reports readiness "ready"; that must not read as degraded.
    expect(screen.queryByText(/运行时状态/)).toBeNull();
  });

  it("启动恢复未完成时提示运行时状态未就绪", async () => {
    clients.health.get.mockResolvedValue({
      status: "recovering",
      readiness: "recovering",
      version: "0.5.18",
    });

    render(<AboutPanel />);

    await waitFor(() => expect(screen.getByText(/运行时状态：recovering/)).toBeTruthy());
  });

  it("读取运行时构建标识失败时给出解释而不是空白卡片", async () => {
    clients.health.get.mockRejectedValue(new Error("health unavailable"));

    render(<AboutPanel />);

    await waitFor(() => expect(screen.getByText(/无法读取运行时构建标识：health unavailable/)).toBeTruthy());
  });

  it("包含 Runtime 原生客户端且不包含已退役的面板端点", () => {
    const files = ["StorageDiagnosticsPanel.tsx", "UsagePanel.tsx", "DataPanel.tsx", "AboutPanel.tsx"];
    const source = files.map((file) => readFileSync(new URL(file, import.meta.url), "utf8")).join("\n");

    expect(source).toContain("createStorageClient");
    expect(source).toContain("createUsageHistoryClient");
    expect(source).toContain("createSettingsClient");
    expect(source).toContain("createRuntimeHealthClient");
    expect(source).toContain("RUNTIME_STORAGE_SCAN_PATH");
    expect(source).not.toMatch(/\/api\/storage\/scan|\/storage\/diagnostics|\/storage\/vacuum|\/storage\/cleanup|\/usage\/|\/settings\/user|\/settings\/release|\/settings\/check-update/);
  });
});
