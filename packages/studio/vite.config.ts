import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
    rollupOptions: {
      external: [
        "@tauri-apps/api",
        "@tauri-apps/api/core",
        "@tauri-apps/api/event",
        "@tauri-apps/plugin-dialog",
        "@tauri-apps/plugin-fs",
        "@tauri-apps/plugin-updater",
        "@tauri-apps/plugin-process",
      ],
    },
  },
  server: {
    port: 4567,
    proxy: {
      "/api": {
        target: `http://localhost:${process.env.INKOS_STUDIO_PORT ?? "4569"}`,
        changeOrigin: true,
      },
    },
  },
});
