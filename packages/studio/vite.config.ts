import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// import tailwindcss from "@tailwindcss/vite"; // Disabled due to build errors
import { VitePWA } from "vite-plugin-pwa";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [
    react(),
    // tailwindcss(), // Disabled - using PostCSS instead
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "robots.txt", "icons/*.png"],
      manifest: {
        name: "NovelFork Studio",
        short_name: "NovelFork",
        description: "Web workbench for novel writing",
        theme_color: "#3b82f6",
        background_color: "#ffffff",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "icons/icon-72x72.png",
            sizes: "72x72",
            type: "image/png",
          },
          {
            src: "icons/icon-96x96.png",
            sizes: "96x96",
            type: "image/png",
          },
          {
            src: "icons/icon-128x128.png",
            sizes: "128x128",
            type: "image/png",
          },
          {
            src: "icons/icon-144x144.png",
            sizes: "144x144",
            type: "image/png",
          },
          {
            src: "icons/icon-152x152.png",
            sizes: "152x152",
            type: "image/png",
          },
          {
            src: "icons/icon-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "icons/icon-384x384.png",
            sizes: "384x384",
            type: "image/png",
          },
          {
            src: "icons/icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-cache",
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /\/api\/.*/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "api-cache",
              networkTimeoutSeconds: 10,
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 5,
              },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  optimizeDeps: {
    include: [
      "@tauri-apps/api/core",
      "@tauri-apps/api/event",
      "@tauri-apps/plugin-updater",
      "@tauri-apps/plugin-process",
    ],
  },
  build: {
    // Package 6 / 7.1: route-level code splitting lives in src/App.tsx (React.lazy);
    // this config only carves out the heavy third-party vendors so they do not
    // bloat the main entry chunk.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      external: [
        "@tauri-apps/api",
        "@tauri-apps/api/core",
        "@tauri-apps/api/event",
        "@tauri-apps/plugin-dialog",
        "@tauri-apps/plugin-fs",
        "@tauri-apps/plugin-updater",
        "@tauri-apps/plugin-process",
        "@tauri-apps/plugin-shell",
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
