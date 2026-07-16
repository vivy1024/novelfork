import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// import tailwindcss from "@tailwindcss/vite"; // Disabled due to build errors
import { resolve } from "node:path";

const runtimeFrontendOutDir = resolve(__dirname, "../narrafork-runtime-private/dist/frontend");
const runtimePort = Number(process.env.NOVELFORK_RUNTIME_PORT ?? process.env.PORT ?? "7778");

export default defineConfig({
  plugins: [
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
      "@frontend": resolve(__dirname, "../narrafork-runtime-private/frontend"),
      "@shared": resolve(__dirname, "../narrafork-runtime-private/shared"),
      "@vivy1024/novelfork-novel-plugin/pages/writing-workbench/ide": resolve(__dirname, "../novel-plugin/src/pages/writing-workbench/ide/index.ts"),
      "@vivy1024/novelfork-novel-plugin/pages/writing-workbench": resolve(__dirname, "../novel-plugin/src/pages/writing-workbench/index.ts"),
      "@vivy1024/novelfork-novel-plugin/pages/writing-config": resolve(__dirname, "../novel-plugin/src/pages/writing-config/index.ts"),
      "@vivy1024/novelfork-novel-plugin/pages": resolve(__dirname, "../novel-plugin/src/pages/index.ts"),
      "@vivy1024/novelfork-core/registry/command-registry": resolve(__dirname, "../core/src/registry/command-registry.ts"),
      "@vivy1024/novelfork-core/registry/command-executor": resolve(__dirname, "../core/src/registry/command-executor.ts"),
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
    // Official artifacts are served by the private Runtime's only HTTP/WS process.
    // Keep this outside Studio's dist/ so the legacy Studio API server cannot be
    // mistaken for the production host.
    outDir: runtimeFrontendOutDir,
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
