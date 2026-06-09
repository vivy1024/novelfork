import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@vivy1024/novelfork-core/registry/command-registry": resolve(__dirname, "../core/src/registry/command-registry.ts"),
      "@vivy1024/novelfork-core/registry/command-executor": resolve(__dirname, "../core/src/registry/command-executor.ts"),
      // 可选浏览器依赖在测试中用空 stub 替身（运行时仍走真实动态 import + try/catch 降级）
      "playwright-core": resolve(__dirname, "test/stubs/playwright-stub.ts"),
      "playwright": resolve(__dirname, "test/stubs/playwright-stub.ts"),
      "@": resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: [
      "src/app-next/StudioApp.test.tsx",
    ],
  },
});
