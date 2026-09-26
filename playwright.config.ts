import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

const frontendPort = 4587;
const apiPort = 4589;
const e2eProjectRoot = resolve(__dirname, ".novelfork", `e2e-workspace-flow-${Date.now()}`).replace(/\\/g, "/");
const e2eRuntimeDir = `${e2eProjectRoot}/.runtime/global`;
const e2eSessionStoreDir = `${e2eProjectRoot}/.runtime/sessions`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${frontendPort}`,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "bun run main.ts",
      url: `http://localhost:${apiPort}/api/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        PORT: String(apiPort),
        HOME: e2eProjectRoot,
        USERPROFILE: e2eProjectRoot,
        // NOVELFORK_HOME 优先于上面的 HOME 重定向；不覆盖的话，开发者自己的值会把全局配置、
        // 技能、市场数据导向真实数据。市场目录另有专用变量，也显式覆盖，防止继承。
        NOVELFORK_HOME: e2eProjectRoot,
        NOVELFORK_MARKET_DIR: `${e2eProjectRoot}/market`,
        NOVELFORK_PROJECT_ROOT: e2eProjectRoot,
        NOVELFORK_BOOKS_ROOT: `${e2eProjectRoot}/books`,
        NOVELFORK_RUNTIME_DIR: e2eRuntimeDir,
        NOVELFORK_SESSION_STORE_DIR: e2eSessionStoreDir,
        NOVELFORK_STORAGE_DB_PATH: `${e2eProjectRoot}/novelfork.db`,
        NOVELFORK_NO_BROWSER: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: `pnpm --dir packages/studio exec vite --host 127.0.0.1 --port ${frontendPort}`,
      url: `http://127.0.0.1:${frontendPort}/next/dashboard`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        NOVELFORK_RUNTIME_PORT: String(apiPort),
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
