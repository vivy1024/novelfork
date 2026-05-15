import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// import tailwindcss from "@tailwindcss/vite"; // Disabled due to build errors
import { resolve } from "node:path";

export default defineConfig({
  plugins: [
    react(),
    // tailwindcss(), // Disabled - using PostCSS instead
    // PWA disabled — local exe does not need offline caching, and Service Worker
    // causes stale-cache issues when users upgrade the exe binary.
  ],
  resolve: {
    alias: {
      "@vivy1024/novelfork-novel-plugin/pages/writing-workbench": resolve(__dirname, "../novel-plugin/src/pages/writing-workbench/index.ts"),
      "@vivy1024/novelfork-novel-plugin/pages": resolve(__dirname, "../novel-plugin/src/pages/index.ts"),
      "@vivy1024/novelfork-core/registry/command-registry": resolve(__dirname, "../core/src/registry/command-registry.ts"),
      "@vivy1024/novelfork-core/registry/command-executor": resolve(__dirname, "../core/src/registry/command-executor.ts"),
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
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
          if (id.includes("@tiptap") || id.includes("prosemirror-") || id.includes("/novel/")) {
            return "vendor-editor";
          }
          if (id.includes("react-grid-layout") || id.includes("react-draggable") || id.includes("react-resizable")) {
            return "vendor-grid";
          }
          if (id.includes("react-markdown") || id.includes("remark-") || id.includes("rehype-") || id.includes("unified") || id.includes("mdast-") || id.includes("micromark") || id.includes("hast-")) {
            return "vendor-markdown";
          }
          if (id.includes("react-syntax-highlighter") || id.includes("refractor") || id.includes("prismjs")) {
            return "vendor-syntax";
          }
          if (id.includes("lucide-react")) {
            return "vendor-icons";
          }
          if (id.includes("@dnd-kit")) {
            return "vendor-dnd";
          }
          if (id.includes("@modelcontextprotocol") || id.includes("eventsource")) {
            return "vendor-mcp";
          }
          // Match pnpm-hoisted bare react / react-dom / scheduler packages only.
          // Avoid matching scoped packages like @tiptap/react which would cause
          // circular chunks between vendor-react and vendor-editor.
          if (/[\\/]react@\d/.test(id) || /[\\/]react-dom@\d/.test(id) || /[\\/]scheduler@\d/.test(id)) {
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
        target: `http://localhost:${process.env.NOVELFORK_STUDIO_PORT ?? "4569"}`,
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
