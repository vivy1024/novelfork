import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("../lib/token-counter.js", () => ({
  countTokens: vi.fn(() => ({ tokens: 85_000 })),
}));

vi.mock("../lib/user-config-service.js", () => ({
  loadUserConfig: vi.fn(async () => ({
    runtimeControls: {
      contextCompressionThresholdPercent: 90,
      contextTruncateTargetPercent: 60,
    },
  })),
}));

import { createContextManagerRouter } from "./context-manager";

describe("createContextManagerRouter", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "novelfork-context-manager-"));
    await mkdir(join(root, "story"), { recursive: true });
    await writeFile(join(root, "story", "chapter_summaries.md"), "章节摘要", "utf-8");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("uses runtime control thresholds for usage and truncation", async () => {
    const app = createContextManagerRouter({
      state: {
        bookDir: () => root,
      },
    } as any);

    const usageResponse = await app.request("http://localhost/api/context/demo/usage");
    expect(usageResponse.status).toBe(200);
    const usagePayload = await usageResponse.json();
    expect(usagePayload.canCompress).toBe(false);
    expect(usagePayload.percentage).toBe(85);
    expect(usagePayload.governance).toEqual({
      source: "runtimeControls.contextCompressionThresholdPercent",
      compressionThresholdPercent: 90,
      truncateTargetPercent: 60,
      compressionReason: "当前上下文未达到 runtimeControls.contextCompressionThresholdPercent=90% 的压缩阈值",
    });

    const truncateResponse = await app.request("http://localhost/api/context/demo/truncate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(truncateResponse.status).toBe(200);
    const truncatePayload = await truncateResponse.json();
    expect(truncatePayload.targetTokens).toBe(60_000);
    expect(truncatePayload.governance).toEqual({
      source: "runtimeControls.contextTruncateTargetPercent",
      compressionThresholdPercent: 90,
      truncateTargetPercent: 60,
      truncateReason: "本次截断目标来自 runtimeControls.contextTruncateTargetPercent=60%",
    });
  });
});
