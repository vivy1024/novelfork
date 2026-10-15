import { describe, expect, it, vi } from "vitest";

import { clampZhuqueRetries, clampZhuqueTimeoutMs, getZhuqueConfigFromKv, scanWithZhuque } from "./client.js";

/** 测试用解析器：把域名解析到一个公网地址，模拟真实环境里 DNS 正常的情况。 */
const resolvePublic = vi.fn(async () => ["203.0.113.10"]);

describe("Zhuque client", () => {
  it("parses successful Zhuque API responses", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ aiProbability: 0.42, requestId: "zq-1" }) });

    await expect(scanWithZhuque("测试文本", { apiKey: "key", endpoint: "https://zhuque.example/scan", fetchImpl, resolveHost: resolvePublic })).resolves.toMatchObject({
      status: "success",
      score: 42,
    });
    expect(fetchImpl).toHaveBeenCalledWith("https://zhuque.example/scan", expect.objectContaining({ method: "POST" }));
  });

  it("returns only the parsed score, never the raw upstream body (T-10)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ score: 12, leaked: "root:x:0:0", requestId: "zq-2" }) });

    const result = await scanWithZhuque("测试文本", { apiKey: "key", endpoint: "https://8.8.8.8/scan", retries: 0, fetchImpl });

    expect(result).toEqual({ status: "success", score: 12 });
    expect(JSON.stringify(result)).not.toContain("root:x");
  });

  it("retries 5xx then returns success", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ score: 35 }) });

    await expect(scanWithZhuque("测试文本", { apiKey: "key", endpoint: "https://zhuque.example/scan", retries: 1, fetchImpl, resolveHost: resolvePublic })).resolves.toMatchObject({ status: "success", score: 35 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("returns failed status when all attempts fail", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("timeout"));

    await expect(scanWithZhuque("测试文本", { apiKey: "key", endpoint: "https://zhuque.example/scan", retries: 1, fetchImpl, resolveHost: resolvePublic })).resolves.toMatchObject({
      status: "failed",
      error: expect.stringContaining("请求失败"),
    });
  });

  it("does not echo internal host or port from a network error (T-10)", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED 203.0.113.9:8443"));

    const result = await scanWithZhuque("测试文本", { apiKey: "key", endpoint: "https://zhuque.example/scan", retries: 0, fetchImpl, resolveHost: resolvePublic });

    expect(result.status).toBe("failed");
    expect(result.error).not.toContain("8443");
    expect(result.error).not.toContain("203.0.113.9");
  });

  it.each([
    "http://127.0.0.1:8080/scan",
    "http://localhost/scan",
    "http://localhost./scan",
    "http://10.0.0.5:8080/scan",
    "http://192.168.1.20/scan",
    "http://172.16.4.2/scan",
    "http://169.254.169.254/latest/meta-data",
    "http://[::7f00:1]/scan",
    "file:///etc/passwd",
    "file:///C:/Windows/win.ini",
    "data:application/json,{}",
  ])("refuses an internal or non-http endpoint without sending a request: %s", async (endpoint) => {
    const fetchImpl = vi.fn();

    const result = await scanWithZhuque("测试文本", { apiKey: "key", endpoint, retries: 0, fetchImpl, resolveHost: resolvePublic });

    expect(result.status).toBe("failed");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a domain that DNS resolves to an internal address, before any request", async () => {
    const fetchImpl = vi.fn();
    const resolveHost = vi.fn(async () => ["127.0.0.1"]);

    const result = await scanWithZhuque("测试文本", { apiKey: "key", endpoint: "https://rebind.example/scan", retries: 0, fetchImpl, resolveHost });

    expect(result.status).toBe("failed");
    expect(resolveHost).toHaveBeenCalledWith("rebind.example");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("treats an unresolvable domain (or a missing resolver) as unusable", async () => {
    const fetchImpl = vi.fn();

    const failed = await scanWithZhuque("测试文本", {
      apiKey: "key",
      endpoint: "https://gone.example/scan",
      retries: 0,
      fetchImpl,
      resolveHost: async () => { throw new Error("ENOTFOUND gone.example"); },
    });
    const noResolver = await scanWithZhuque("测试文本", { apiKey: "key", endpoint: "https://gone.example/scan", retries: 0, fetchImpl });

    expect(failed.status).toBe("failed");
    expect(failed.error).not.toContain("ENOTFOUND");
    expect(noResolver.status).toBe("failed");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never follows redirects: asks fetch for manual redirects and fails a 3xx without retrying", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 302, type: "basic", json: async () => ({ score: 99 }) });

    const result = await scanWithZhuque("测试文本", { apiKey: "key", endpoint: "https://8.8.8.8/scan", retries: 3, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith("https://8.8.8.8/scan", expect.objectContaining({ redirect: "manual" }));
    expect(result.status).toBe("failed");
    expect(result.error).toContain("重定向");
    expect(result.score).toBeUndefined();
  });

  it("treats an opaque redirect response (browser fetch) as a failure too", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 0, type: "opaqueredirect", json: async () => ({}) });

    const result = await scanWithZhuque("测试文本", { apiKey: "key", endpoint: "https://8.8.8.8/scan", retries: 2, fetchImpl });

    expect(result.status).toBe("failed");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("caps retries at 5 even when the stored config asks for more", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("boom"));

    await scanWithZhuque("测试文本", { apiKey: "key", endpoint: "https://8.8.8.8/scan", retries: 100, timeoutMs: 1000, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it("still sends requests to a public endpoint (the guard must not block everything)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ score: 10 }) });

    await expect(scanWithZhuque("测试文本", { apiKey: "key", endpoint: "https://8.8.8.8/scan", retries: 0, fetchImpl })).resolves.toMatchObject({ status: "success", score: 10 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("loads Zhuque config from kv json", async () => {
    const repo = { get: vi.fn().mockResolvedValue(JSON.stringify({ apiKey: "k", endpoint: "https://zhuque.local/scan", timeoutMs: 1000 })) };

    await expect(getZhuqueConfigFromKv(repo)).resolves.toMatchObject({ apiKey: "k", endpoint: "https://zhuque.local/scan", timeoutMs: 1000 });
  });

  it("clamps stored timeout and retries into their allowed ranges", async () => {
    const tooBig = { get: vi.fn().mockResolvedValue(JSON.stringify({ apiKey: "k", endpoint: "https://8.8.8.8/scan", timeoutMs: 9_999_999, retries: 100 })) };
    const tooSmall = { get: vi.fn().mockResolvedValue(JSON.stringify({ apiKey: "k", endpoint: "https://8.8.8.8/scan", timeoutMs: 1, retries: -3 })) };
    const garbage = { get: vi.fn().mockResolvedValue(JSON.stringify({ apiKey: "k", endpoint: "https://8.8.8.8/scan", timeoutMs: "x", retries: null })) };

    await expect(getZhuqueConfigFromKv(tooBig)).resolves.toMatchObject({ timeoutMs: 60_000, retries: 5 });
    await expect(getZhuqueConfigFromKv(tooSmall)).resolves.toMatchObject({ timeoutMs: 1_000, retries: 0 });
    await expect(getZhuqueConfigFromKv(garbage)).resolves.toMatchObject({ timeoutMs: 10_000, retries: 2 });
    expect(clampZhuqueTimeoutMs(Number.NaN)).toBe(10_000);
    expect(clampZhuqueRetries(2.7)).toBe(2);
  });

  it("decrypts a sealed apiKey read from kv when a decryptor is supplied (T-10)", async () => {
    const sealed = { enc: "v1", iv: "AAAAAAAAAAAAAAAA", tag: "AAAAAAAAAAAAAAAAAAAAAA==", ct: "AAAA" };
    const repo = { get: vi.fn().mockResolvedValue(JSON.stringify({ apiKey: sealed, endpoint: "https://zhuque.local/scan" })) };
    const decrypt = vi.fn().mockResolvedValue("k-decrypted");

    await expect(getZhuqueConfigFromKv(repo, decrypt)).resolves.toMatchObject({ apiKey: "k-decrypted", endpoint: "https://zhuque.local/scan" });
    expect(decrypt).toHaveBeenCalledWith(sealed);
  });
});
