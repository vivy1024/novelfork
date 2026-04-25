import { describe, expect, it, vi } from "vitest";

import { getZhuqueConfigFromKv, scanWithZhuque } from "../index.js";

describe("Zhuque client", () => {
  it("parses successful Zhuque API responses", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ aiProbability: 0.42, requestId: "zq-1" }) });

    await expect(scanWithZhuque("测试文本", { apiKey: "key", endpoint: "https://zhuque.local/scan", fetchImpl })).resolves.toMatchObject({
      status: "success",
      score: 42,
      raw: { requestId: "zq-1" },
    });
    expect(fetchImpl).toHaveBeenCalledWith("https://zhuque.local/scan", expect.objectContaining({ method: "POST" }));
  });

  it("retries 5xx then returns success", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ score: 35 }) });

    await expect(scanWithZhuque("测试文本", { apiKey: "key", endpoint: "https://zhuque.local/scan", retries: 1, fetchImpl })).resolves.toMatchObject({ status: "success", score: 35 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("returns failed status when all attempts fail", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("timeout"));

    await expect(scanWithZhuque("测试文本", { apiKey: "key", endpoint: "https://zhuque.local/scan", retries: 1, fetchImpl })).resolves.toMatchObject({
      status: "failed",
      error: expect.stringContaining("timeout"),
    });
  });

  it("loads Zhuque config from kv json", async () => {
    const repo = { get: vi.fn().mockResolvedValue(JSON.stringify({ apiKey: "k", endpoint: "https://zhuque.local/scan", timeoutMs: 1000 })) };

    await expect(getZhuqueConfigFromKv(repo)).resolves.toMatchObject({ apiKey: "k", endpoint: "https://zhuque.local/scan", timeoutMs: 1000 });
  });
});
