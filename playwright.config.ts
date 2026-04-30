import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

const frontendPort = 4587;
const apiPort = 4589;
const e2eProjectRoot = resolve(__dirname, ".novelfork", `e2e-workspace-flow-${Date.now()}`).replace(/\\/g, "/");

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
      command: `bun run main.ts --root="${e2eProjectRoot}" --port=${apiPort}`,
      url: `http://127.0.0.1:${apiPort}/api/books`,
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: `pnpm --dir packages/studio exec vite --host 127.0.0.1 --port ${frontendPort}`,
      url: `http://127.0.0.1:${frontendPort}/next/dashboard`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        NOVELFORK_STUDIO_PORT: String(apiPort),
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
