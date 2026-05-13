import { startStudioServer } from "./server.js";
import { resolve, join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createEmbeddedStaticProvider } from "./static-provider.js";
import { openStudioWindow } from "./desktop-window.js";
import { resolveStartupPort, resolveStartupRoot } from "./startup-args.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const root = resolveStartupRoot(process.argv, process.env, () => process.cwd());
const port = resolveStartupPort(process.argv, process.env);

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

const serverUrl = `http://localhost:${port}`;

startStudioServer(root, port, {
  staticDir: hasFrontendAssets ? distDir : undefined,
  staticProvider,
  staticMode: hasFrontendAssets ? "filesystem" : (staticProvider ? "embedded" : "missing"),
})
  .then(() => {
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
