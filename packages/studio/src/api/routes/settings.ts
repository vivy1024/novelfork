import { Hono } from "hono";
import { loadUserConfig, updateUserConfig, getUserConfigPath } from "../lib/user-config-service.js";
import { collectMetrics } from "../lib/metrics-service.js";
import { buildStudioReleaseSnapshot } from "../lib/release-metadata.js";
import { checkForUpdate } from "../lib/update-checker.js";
import { downloadUpdate, installUpdate, getPendingUpdatePath, cleanupUpdateDir, type DownloadProgress } from "../lib/update-downloader.js";
import { resolveRuntimeStoragePath } from "../lib/runtime-storage-paths.js";
import { getCodexRuntimeCapabilityStatuses } from "../../shared/codex-runtime-status.js";
import { setGlobalProxyUrl, setPerProviderProxy } from "../lib/provider-adapters/index.js";
import type { UserConfigPatch } from "../../types/settings.js";
import type { StudioReleaseSnapshot } from "../../shared/release-manifest.js";

interface SettingsRouterOptions {
  readonly root?: string;
  readonly buildReleaseSnapshot?: (root: string) => Promise<StudioReleaseSnapshot>;
}

// 下载进度状态（内存中，供轮询使用）
let currentDownloadProgress: DownloadProgress | null = null;

export function createSettingsRouter(options: SettingsRouterOptions = {}) {
  const app = new Hono();

  // 根路由别名 — 前端部分调用 /api/settings 而非 /api/settings/user
  app.get("/", async (c) => {
    try {
      const config = await loadUserConfig();
      return c.json(config);
    } catch (error) {
      console.error("Failed to load user config:", error);
      return c.json({ error: "Failed to load user config" }, 500);
    }
  });

  app.put("/", async (c) => {
    try {
      const partial = await c.req.json<UserConfigPatch>();
      const updated = await updateUserConfig(partial);
      if (partial.proxy) {
        setGlobalProxyUrl(updated.proxy?.platforms?.ai || undefined);
        setPerProviderProxy(updated.proxy?.providers ?? {});
      }
      return c.json(updated);
    } catch (error) {
      console.error("Failed to update user config:", error);
      return c.json({ error: "Failed to update user config" }, 500);
    }
  });

  // 获取完整用户配置
  app.get("/user", async (c) => {
    try {
      const config = await loadUserConfig();
      return c.json(config);
    } catch (error) {
      console.error("Failed to load user config:", error);
      return c.json({ error: "Failed to load user config" }, 500);
    }
  });

  // 更新用户配置（部分更新）
  app.put("/user", async (c) => {
    try {
      const partial = await c.req.json<UserConfigPatch>();
      const updated = await updateUserConfig(partial);

      // 如果 proxy 配置变更，同步更新 provider adapter 层的代理设置
      if (partial.proxy) {
        setGlobalProxyUrl(updated.proxy?.platforms?.ai || undefined);
        setPerProviderProxy(updated.proxy?.providers ?? {});
      }

      return c.json(updated);
    } catch (error) {
      console.error("Failed to update user config:", error);
      return c.json({ error: "Failed to update user config" }, 500);
    }
  });

  // 获取主题配置
  app.get("/theme", async (c) => {
    try {
      const config = await loadUserConfig();
      return c.json({ theme: config.preferences.theme });
    } catch (error) {
      console.error("Failed to load theme:", error);
      return c.json({ error: "Failed to load theme" }, 500);
    }
  });

  // 更新主题配置
  app.put("/theme", async (c) => {
    try {
      const { theme } = await c.req.json<{ theme: "light" | "dark" | "auto" }>();
      const updated = await updateUserConfig({
        preferences: { theme },
      });
      return c.json({ theme: updated.preferences.theme });
    } catch (error) {
      console.error("Failed to update theme:", error);
      return c.json({ error: "Failed to update theme" }, 500);
    }
  });

  // 获取编辑器配置
  app.get("/editor", async (c) => {
    try {
      const config = await loadUserConfig();
      return c.json({
        fontSize: config.preferences.fontSize,
        fontFamily: config.preferences.fontFamily,
        lineHeight: config.preferences.editorLineHeight,
        tabSize: config.preferences.editorTabSize,
        autoSave: config.preferences.autoSave,
        autoSaveDelay: config.preferences.autoSaveDelay,
      });
    } catch (error) {
      console.error("Failed to load editor config:", error);
      return c.json({ error: "Failed to load editor config" }, 500);
    }
  });

  // 更新编辑器配置
  app.put("/editor", async (c) => {
    try {
      const editorPrefs = await c.req.json<Partial<{
        fontSize: number;
        fontFamily: string;
        lineHeight: number;
        tabSize: number;
        autoSave: boolean;
        autoSaveDelay: number;
      }>>();

      const updated = await updateUserConfig({
        preferences: {
          fontSize: editorPrefs.fontSize,
          fontFamily: editorPrefs.fontFamily,
          editorLineHeight: editorPrefs.lineHeight,
          editorTabSize: editorPrefs.tabSize,
          autoSave: editorPrefs.autoSave,
          autoSaveDelay: editorPrefs.autoSaveDelay,
        },
      });

      return c.json({
        fontSize: updated.preferences.fontSize,
        fontFamily: updated.preferences.fontFamily,
        lineHeight: updated.preferences.editorLineHeight,
        tabSize: updated.preferences.editorTabSize,
        autoSave: updated.preferences.autoSave,
        autoSaveDelay: updated.preferences.autoSaveDelay,
      });
    } catch (error) {
      console.error("Failed to update editor config:", error);
      return c.json({ error: "Failed to update editor config" }, 500);
    }
  });

  // 获取快捷键配置
  app.get("/shortcuts", async (c) => {
    try {
      const config = await loadUserConfig();
      return c.json({ shortcuts: config.shortcuts });
    } catch (error) {
      console.error("Failed to load shortcuts:", error);
      return c.json({ error: "Failed to load shortcuts" }, 500);
    }
  });

  // 更新快捷键配置
  app.put("/shortcuts", async (c) => {
    try {
      const { shortcuts } = await c.req.json<{ shortcuts: Record<string, string> }>();
      const updated = await updateUserConfig({ shortcuts });
      return c.json({ shortcuts: updated.shortcuts });
    } catch (error) {
      console.error("Failed to update shortcuts:", error);
      return c.json({ error: "Failed to update shortcuts" }, 500);
    }
  });

  // 获取系统指标
  app.get("/metrics", async (c) => {
    try {
      // 从环境变量或默认路径获取项目根目录
      const projectRoot = process.env.NOVELFORK_PROJECT_ROOT || resolveRuntimeStoragePath();
      const metrics = await collectMetrics(projectRoot);
      return c.json(metrics);
    } catch (error) {
      console.error("Failed to collect metrics:", error);
      return c.json({ error: "Failed to collect metrics" }, 500);
    }
  });

  // 获取版本 / 更新 / changelog 信息
  app.get("/release", async (c) => {
    try {
      const projectRoot = options.root ?? process.env.NOVELFORK_PROJECT_ROOT ?? resolveRuntimeStoragePath();
      const snapshotBuilder = options.buildReleaseSnapshot ?? buildStudioReleaseSnapshot;
      const release = await snapshotBuilder(projectRoot);
      return c.json(release);
    } catch (error) {
      console.error("Failed to load release metadata:", error);
      return c.json({ error: "Failed to load release metadata" }, 500);
    }
  });

  // 检查更新：查询自建更新服务器（fallback GitHub API）
  app.get("/check-update", async (c) => {
    try {
      const result = await checkForUpdate();
      return c.json(result);
    } catch (error) {
      console.error("Failed to check for update:", error);
      return c.json({ error: "Failed to check for update" }, 500);
    }
  });

  // 下载更新：触发后台下载，通过 SSE 推送进度
  app.post("/download-update", async (c) => {
    try {
      const { downloadUrl, sha256, downloadSize } = await c.req.json<{
        downloadUrl: string;
        sha256: string | null;
        downloadSize: number;
      }>();

      if (!downloadUrl) {
        return c.json({ error: "downloadUrl is required" }, 400);
      }

      // 同步下载（前端通过轮询 /update-progress 获取进度）
      const destPath = await downloadUpdate(
        downloadUrl,
        sha256,
        downloadSize || 0,
        (progress) => {
          // 存储进度到内存（供轮询使用）
          currentDownloadProgress = progress;
        },
      );

      currentDownloadProgress = {
        phase: "ready",
        bytesDownloaded: downloadSize || 0,
        totalBytes: downloadSize || 0,
        percent: 100,
      };

      return c.json({ success: true, path: destPath });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Download failed";
      currentDownloadProgress = {
        phase: "error",
        bytesDownloaded: 0,
        totalBytes: 0,
        percent: 0,
        error: errMsg,
      };
      console.error("Failed to download update:", error);
      return c.json({ error: errMsg }, 500);
    }
  });

  // 获取下载进度
  app.get("/update-progress", (c) => {
    return c.json(currentDownloadProgress ?? { phase: "idle", bytesDownloaded: 0, totalBytes: 0, percent: 0 });
  });

  // 安装更新：执行替换并重启
  app.post("/install-update", (c) => {
    try {
      const pendingPath = getPendingUpdatePath();
      if (!pendingPath) {
        return c.json({ error: "No pending update found" }, 404);
      }

      // 异步执行安装（会退出进程）
      setTimeout(() => installUpdate(pendingPath), 500);

      return c.json({ success: true, message: "Installing update, application will restart..." });
    } catch (error) {
      console.error("Failed to install update:", error);
      return c.json({ error: "Install failed" }, 500);
    }
  });

  // 跳过版本
  app.post("/skip-version", async (c) => {
    try {
      const { version } = await c.req.json<{ version: string }>();
      await updateUserConfig({ update: { skippedVersion: version } });
      cleanupUpdateDir();
      return c.json({ success: true });
    } catch (error) {
      console.error("Failed to skip version:", error);
      return c.json({ error: "Failed to skip version" }, 500);
    }
  });

  // 获取 runtime 状态：MCP、sandbox、storage 路径
  app.get("/runtime-status", async (c) => {
    try {
      const config = await loadUserConfig();
      const capabilities = getCodexRuntimeCapabilityStatuses();
      return c.json({
        storage: {
          runtimeDir: resolveRuntimeStoragePath(),
          userConfigPath: getUserConfigPath(),
          providerStorePath: resolveRuntimeStoragePath("provider-runtime.json"),
          sessionStorePath: resolveRuntimeStoragePath("sessions"),
          transcriptStorePath: resolveRuntimeStoragePath("transcripts"),
          checkpointStorePath: resolveRuntimeStoragePath("checkpoints"),
        },
        mcp: {
          strategy: config.runtimeControls?.toolAccess?.mcpStrategy ?? "disabled",
          servers: [], // MCP server registry 尚未实现真实连接管理
          status: "planned" as const,
        },
        sandbox: {
          mode: config.runtimeControls?.codexSandboxMode ?? undefined,
          status: capabilities.find((cap) => cap.id === "codex.sandboxMode")?.status ?? "planned",
          note: "Codex OS sandbox 尚未接入真实隔离环境",
        },
        capabilities,
      });
    } catch (error) {
      console.error("Failed to load runtime status:", error);
      return c.json({ error: "Failed to load runtime status" }, 500);
    }
  });

  return app;
}
