import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// import tailwindcss from "@tailwindcss/vite"; // Disabled due to build errors
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { PluginOption } from "vite";

const defaultRuntimeRoot = resolve(__dirname, "../narrafork-runtime-private");

export function resolveRuntimeBuildPaths(
  runtimeRootOverride = process.env.NOVELFORK_PRODUCT_RUNTIME_ROOT,
) {
  const runtimeRoot = runtimeRootOverride ? resolve(runtimeRootOverride) : defaultRuntimeRoot;
  return {
    runtimeRoot,
    frontendRoot: resolve(runtimeRoot, "frontend"),
    sharedRoot: resolve(runtimeRoot, "shared"),
    frontendOutDir: resolve(runtimeRoot, "dist", "frontend"),
  };
}

const runtimePaths = resolveRuntimeBuildPaths();

/**
 * 嵌入的 Runtime 原页（设置、套路、知识库……）跑在 Runtime 自己的路由树上。routeTree.gen.ts 是
 * TanStack Router 插件的生成物，产品构建只构建 Studio、不构建 Runtime 前端，所以由这里生成并按路由拆包；
 * 插件取 Runtime 依赖里的版本，生成物与 Runtime 的路由库对得上。配置与 Runtime 自己的 vite.config 一致。
 */
function runtimeRouteTreePlugin(): PluginOption {
  const requireFromRuntime = createRequire(resolve(runtimePaths.runtimeRoot, "package.json"));
  const { TanStackRouterVite } = requireFromRuntime("@tanstack/router-plugin/vite") as {
    TanStackRouterVite: (options: Record<string, unknown>) => PluginOption;
  };
  return TanStackRouterVite({
    target: "react",
    autoCodeSplitting: true,
    routesDirectory: resolve(runtimePaths.frontendRoot, "routes"),
    generatedRouteTree: resolve(runtimePaths.frontendRoot, "routeTree.gen.ts"),
    // 开发期的路由热替换按 id 去 window.__TSR_ROUTER__ 找旧路由；那是 Studio 自己的路由器，两边都有
    // __root__，Runtime 的根路由会被替换进 Studio 的路由器，整个外壳变成 Runtime 的错误页。
    // 关掉它：改 Runtime 路由文件时整页刷新即可。生产构建本来就不带这段代码。
    codeSplittingOptions: { addHmr: false },
  });
}

const runtimePort = Number(process.env.NOVELFORK_RUNTIME_PORT ?? process.env.PORT ?? "7778");

export default defineConfig({
  plugins: [
    runtimeRouteTreePlugin(),
    react(),
    // tailwindcss(), // Disabled - using PostCSS instead
    // PWA disabled — local exe does not need offline caching, and Service Worker
    // causes stale-cache issues when users upgrade the exe binary.
  ],
  resolve: {
    dedupe: [
      "react",
      "react-dom",
      "@tanstack/react-query",
      "@tanstack/react-router",
    ],
    alias: {
      // node 内置浏览器桩：core 的 server 侧模块会经根入口进入前端模块图，
      // 其具名 fs/crypto/module/os/events/zlib 导入若在摇树后幸存，撞上 vite 的
      // __vite-browser-external 空壳会让整个构建硬崩（且是否幸存取决于
      // 摇树运气）。alias 到显式抛错的桩模块，构建稳定、误调用可诊断。
      "node:fs/promises": resolve(__dirname, "src/lib/browser-node-stubs.ts"),
      "node:fs": resolve(__dirname, "src/lib/browser-node-stubs.ts"),
      "node:crypto": resolve(__dirname, "src/lib/browser-node-stubs.ts"),
      "node:module": resolve(__dirname, "src/lib/browser-node-stubs.ts"),
      "node:os": resolve(__dirname, "src/lib/browser-node-stubs.ts"),
      "node:events": resolve(__dirname, "src/lib/browser-node-stubs.ts"),
      "node:zlib": resolve(__dirname, "src/lib/browser-node-stubs.ts"),
      "@vivy1024/narrafork-runtime-bridge/frontend/narrator-panel": resolve(runtimePaths.frontendRoot, "components/narrator/EmbeddedNarratorDockHost.tsx"),
      "@vivy1024/narrafork-runtime-bridge/frontend/query-client": resolve(runtimePaths.frontendRoot, "lib/query-client.ts"),
      "@vivy1024/narrafork-runtime-bridge/frontend/provider-settings": resolve(runtimePaths.frontendRoot, "components/providers/EmbeddedProviderSettingsHost.tsx"),
      "@vivy1024/narrafork-runtime-bridge/frontend/runtime-page": resolve(runtimePaths.frontendRoot, "components/host/EmbeddedRuntimePageHost.tsx"),
      "@vivy1024/narrafork-runtime-bridge/frontend/notification-sound": resolve(runtimePaths.frontendRoot, "lib/notification-sound.ts"),
      "@frontend": runtimePaths.frontendRoot,
      "@shared": runtimePaths.sharedRoot,
      "@vivy1024/novelfork-novel-plugin/pages/writing-workbench/ide": resolve(__dirname, "../novel-plugin/src/pages/writing-workbench/ide/index.ts"),
      "@vivy1024/novelfork-novel-plugin/pages/writing-workbench/writing-progress-event": resolve(__dirname, "../novel-plugin/src/pages/writing-workbench/writing-progress-event.ts"),
      "@vivy1024/novelfork-novel-plugin/pages/writing-workbench": resolve(__dirname, "../novel-plugin/src/pages/writing-workbench/index.ts"),
      "@vivy1024/novelfork-novel-plugin/pages/writing-config": resolve(__dirname, "../novel-plugin/src/pages/writing-config/index.ts"),
      "@vivy1024/novelfork-novel-plugin/pages": resolve(__dirname, "../novel-plugin/src/pages/index.ts"),
      "@vivy1024/novelfork-core/storage": resolve(__dirname, "../core/src/storage/index.ts"),
      "@vivy1024/novelfork-core/utils/length-metrics": resolve(__dirname, "../core/src/utils/length-metrics.ts"),
      "@vivy1024/novelfork-core/registry/command-registry": resolve(__dirname, "../core/src/registry/command-registry.ts"),
      "@vivy1024/novelfork-core/registry/command-executor": resolve(__dirname, "../core/src/registry/command-executor.ts"),
      "@vivy1024/novelfork-core/i18n": resolve(__dirname, "../core/src/i18n/index.ts"),
      "@": resolve(__dirname, "src"),
    },
  },
  // Studio embeds the Runtime frontend and the Novel plugin, which currently use
  // different Tiptap major versions. Let Vite resolve each package from its
  // importing workspace instead of collapsing both versions into one optimized dep.
  optimizeDeps: {
    include: ["tiptap-markdown", "markdown-it-task-lists"],
    exclude: [
      "@tiptap/core",
      "@tiptap/extension-code-block",
      "@tiptap/extension-link",
      "@tiptap/extension-placeholder",
      "@tiptap/markdown",
      "@tiptap/pm",
      "@tiptap/react",
      "@tiptap/starter-kit",
    ],
  },
  build: {
    // Official artifacts are served by the private Runtime's only HTTP/WS process.
    // Keep this outside Studio's dist/ so the legacy Studio API server cannot be
    // mistaken for the production host.
    outDir: runtimePaths.frontendOutDir,
    emptyOutDir: true,
    // Package 6 / 7.1: route-level code splitting lives in src/App.tsx (React.lazy);
    // this config only carves out the heavy third-party vendors so they do not
    // bloat the main entry chunk.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      external: [
        "node:child_process",
        "node:util",
        "node:path",
      ],
      output: {
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;
          const normalizedId = id.replaceAll("\\", "/");

          // Syntax highlighter packages share registries and runtime helpers. Splitting
          // their core and language modules into separate manual chunks creates an ESM
          // initialization cycle (the browser fails before React mounts). Keep the full
          // syntax-highlighting family together; route-level lazy chunks still split the
          // application code that uses it.
          if (
            normalizedId.includes("/highlight.js/") ||
            normalizedId.includes("/lowlight/") ||
            normalizedId.includes("/refractor/") ||
            normalizedId.includes("/prismjs/") ||
            normalizedId.includes("/react-syntax-highlighter/")
          ) {
            return "vendor-syntax";
          }
          if (normalizedId.includes("@tiptap") || normalizedId.includes("prosemirror-") || normalizedId.includes("/novel/")) {
            return "vendor-editor";
          }
          if (normalizedId.includes("react-grid-layout") || normalizedId.includes("react-draggable") || normalizedId.includes("react-resizable")) {
            return "vendor-grid";
          }
          if (normalizedId.includes("react-markdown") || normalizedId.includes("remark-") || normalizedId.includes("rehype-") || normalizedId.includes("unified") || normalizedId.includes("mdast-") || normalizedId.includes("micromark") || normalizedId.includes("hast-")) {
            return "vendor-markdown";
          }
          if (normalizedId.includes("lucide-react")) {
            return "vendor-icons";
          }
          if (normalizedId.includes("@dnd-kit")) {
            return "vendor-dnd";
          }
          if (normalizedId.includes("@modelcontextprotocol") || normalizedId.includes("eventsource")) {
            return "vendor-mcp";
          }
          // F3 首屏瘦身：图表与流程图库体量大且只被懒加载路由消费，
          // 独立成桶避免灌大主入口（recharts 曾把 index 顶到 1.1MB）。
          if (normalizedId.includes("recharts") || normalizedId.includes("d3-") || normalizedId.includes("/d3/") || normalizedId.includes("victory-vendor")) {
            return "vendor-charts";
          }
          if (normalizedId.includes("@xyflow")) {
            return "vendor-flow";
          }
          // Match pnpm-hoisted bare react / react-dom / scheduler packages only.
          // Avoid matching scoped packages like @tiptap/react which would cause
          // circular chunks between vendor-react and vendor-editor.
          if (/[\\/]react@\d/.test(normalizedId) || /[\\/]react-dom@\d/.test(normalizedId) || /[\\/]scheduler@\d/.test(normalizedId)) {
            return "vendor-react";
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port: 4567,
    proxy: {
      "/api": {
        // HMR stays on Vite, while every API/WS request goes to the same private
        // Runtime process used by production. Studio's legacy API server is not
        // started by this workflow.
        target: `http://localhost:${runtimePort}`,
        changeOrigin: true,
        ws: true,
      },
      "/ws": {
        target: `http://localhost:${runtimePort}`,
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
