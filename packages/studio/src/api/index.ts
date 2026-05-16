import { startStudioServer } from "./server.js";
import { resolve, join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createEmbeddedStaticProvider } from "./static-provider.js";
import { openStudioWindow } from "./desktop-window.js";
import { resolveStartupPort, resolveStartupRoot, parseNamedArg } from "./startup-args.js";
import { loadUserConfig } from "./lib/user-config-service.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// 编译后的 exe 使用 exe 所在目录作为默认项目根（而非 process.cwd()）
// 这解决了从 Edge 下载临时目录双击运行时 cwd 不正确的问题
const defaultProjectRoot = () => {
  // Bun 编译后 process.execPath 是 exe 路径
  if (process.execPath && process.execPath.endsWith(".exe")) {
    return dirname(process.execPath);
  }
  return process.cwd();
};

// Load user config for server settings (port, host, browser mode, default project dir)
let userServerConfig: { port?: number; host?: string; defaultProjectDir?: string; browserOpenMode?: string } = {};
try {
  const uc = await loadUserConfig();
  userServerConfig = uc.server ?? {};
} catch { /* use defaults if config can't be loaded yet */ }

const cliRoot = resolveStartupRoot(process.argv, process.env, defaultProjectRoot);
// If user configured a default project dir and no CLI/env override was given, use it
const hasExplicitRoot = parseNamedArg(process.argv, "--root") !== undefined
  || process.argv.slice(2).some((arg) => !arg.startsWith("-"))
  || Boolean(process.env.NOVELFORK_PROJECT_ROOT);
const root = hasExplicitRoot ? cliRoot : (userServerConfig.defaultProjectDir || cliRoot);

// Port: CLI/env takes precedence over user config
const cliPort = resolveStartupPort(process.argv, process.env);
const hasExplicitPort = parseNamedArg(process.argv, "--port") !== undefined || Boolean(process.env.NOVELFORK_STUDIO_PORT);
const port = hasExplicitPort ? cliPort : (userServerConfig.port ?? cliPort);

// --- Headless CLI mode ---
if (process.argv.includes("--headless")) {
  const prompt = parseNamedArg(process.argv, "--prompt")
    ?? process.argv[process.argv.indexOf("--prompt") + 1]
    ?? undefined;

  if (!prompt) {
    console.error("Usage: novelfork --headless --prompt \"your prompt here\"");
    console.error("");
    console.error("Options:");
    console.error("  --prompt=<text>     The prompt to send to the agent");
    console.error("  --model=<p:m>       Provider:model override (e.g. openai:gpt-4o)");
    console.error("  --max-steps=<n>     Max tool execution steps (default: 30)");
    console.error("  --format=<fmt>      Output format: text | json (default: text)");
    console.error("  --root=<dir>        Project root directory");
    process.exit(1);
  }

  const model = parseNamedArg(process.argv, "--model");
  const maxStepsStr = parseNamedArg(process.argv, "--max-steps");
  const format = parseNamedArg(process.argv, "--format") as "text" | "json" | undefined;

  const { runHeadlessCLI } = await import("./lib/headless-cli.js");
  const result = await runHeadlessCLI({
    prompt,
    workDir: root,
    model,
    maxSteps: maxStepsStr ? parseInt(maxStepsStr, 10) : undefined,
    outputFormat: format ?? "text",
  });

  if (result.success) {
    console.log(result.output);
    process.exit(0);
  } else {
    console.error(result.error ?? "Unknown error");
    process.exit(1);
  }
}

const studioRoot = resolve(__dirname, "../..");
const distDir = join(studioRoot, "dist");
const hasFrontendAssets = existsSync(join(distDir, "index.html"));

let staticProvider: ReturnType<typeof createEmbeddedStaticProvider> | undefined;

if (!hasFrontendAssets) {
  try {
    const { embeddedIndexHtml, embeddedAssets } = await import("./embedded-assets.generated.js");
    if (embeddedAssets && Object.keys(embeddedAssets).length > 0) {
      const files: Record<string, { content: Uint8Array; contentType: string }> = {};
      for (const [k, v] of Object.entries(embeddedAssets as Record<string, { content: Uint8Array; contentType: string }>)) {
        files[k] = v;
      }
      staticProvider = createEmbeddedStaticProvider({ indexHtml: embeddedIndexHtml, files });
    }
  } catch {
    console.warn("Frontend assets not found. Starting in API-only mode.");
  }
}

const serverHost = hasExplicitPort ? undefined : (userServerConfig.host ?? undefined);
const serverUrl = `http://localhost:${port}`;

startStudioServer(root, port, {
  staticDir: hasFrontendAssets ? distDir : undefined,
  staticProvider,
  staticMode: hasFrontendAssets ? "filesystem" : (staticProvider ? "embedded" : "missing"),
  hostname: serverHost,
})
  .then(() => {
    // Respect user's browserOpenMode setting
    const browserMode = userServerConfig.browserOpenMode ?? "app";
    if (browserMode === "none") {
      console.log("Browser open disabled by user config");
      return;
    }
    // Set env vars that desktop-window.ts reads to control behavior
    if (browserMode === "browser") {
      process.env.NOVELFORK_WINDOW_MODE = "browser";
    }
    const launchPlan = openStudioWindow(serverUrl);
    if (launchPlan.kind === "app") {
      console.log(`NovelFork app window opened via ${launchPlan.command}`);
    } else if (launchPlan.kind === "browser") {
      console.log(`NovelFork opened in default browser via ${launchPlan.command}`);
    }
  })
  .catch(async (e) => {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Failed to start studio:", message);
    console.error("");
    console.error("═══════════════════════════════════════════════════════");
    console.error("  NovelFork 启动失败");
    console.error("═══════════════════════════════════════════════════════");
    console.error("");
    console.error(`  错误: ${message}`);
    console.error("");
    console.error("  常见原因:");
    console.error(`    1. 端口 ${port} 被占用 → 关闭占用程序或用 --port=其他端口`);
    console.error("    2. Windows Defender 拦截 → 允许 novelfork.exe 通过防火墙");
    console.error("    3. 数据库损坏 → 删除 C:\\Users\\<你>\\. novelfork\\ 目录重试");
    console.error("");
    console.error("  按 Enter 退出...");
    console.error("═══════════════════════════════════════════════════════");

    // 等待用户按键再退出（防止窗口一闪而过）
    if (process.stdin.isTTY) {
      await new Promise<void>((resolve) => {
        process.stdin.once("data", () => resolve());
      });
    } else {
      // 非 TTY 环境（如 cmd 双击），等 10 秒让用户看到错误
      await new Promise<void>((resolve) => setTimeout(resolve, 10000));
    }
    process.exit(1);
  });
