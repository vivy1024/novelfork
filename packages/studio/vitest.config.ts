import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "react": resolve(__dirname, "node_modules/react"),
      "react-dom": resolve(__dirname, "node_modules/react-dom"),
      "@vivy1024/narrafork-runtime-bridge/frontend/narrator-panel": resolve(__dirname, "../narrafork-runtime-private/frontend/components/narrator/EmbeddedNarratorDockHost.tsx"),
      "@vivy1024/narrafork-runtime-bridge/frontend/query-client": resolve(__dirname, "../narrafork-runtime-private/frontend/lib/query-client.ts"),
      "@frontend": resolve(__dirname, "../narrafork-runtime-private/frontend"),
      "@shared": resolve(__dirname, "../narrafork-runtime-private/shared"),
      "@vivy1024/novelfork-core/registry/command-registry": resolve(__dirname, "../core/src/registry/command-registry.ts"),
      "@vivy1024/novelfork-core/registry/command-executor": resolve(__dirname, "../core/src/registry/command-executor.ts"),
      "@vivy1024/novelfork-core/i18n": resolve(__dirname, "../core/src/i18n/index.ts"),
      // 可选浏览器依赖在测试中用空 stub 替身（运行时仍走真实动态 import + try/catch 降级）
      "playwright-core": resolve(__dirname, "test/stubs/playwright-stub.ts"),
      "playwright": resolve(__dirname, "test/stubs/playwright-stub.ts"),
      "@": resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "jsdom",
    fileParallelism: false,
    minWorkers: 1,
    maxWorkers: 1,
    poolOptions: {
      forks: {
        execArgv: ["--max-old-space-size=8192"],
      },
    },
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: [
      "src/app-next/StudioApp.test.tsx",
    ],
  },
});
