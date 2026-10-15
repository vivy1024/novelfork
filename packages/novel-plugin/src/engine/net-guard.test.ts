import { describe, expect, it, vi } from "vitest";

import {
  checkPublicHttpEndpoint,
  explainEndpointRejection,
  isHttpEndpoint,
  isInternalAddress,
  isInternalEndpoint,
} from "./net-guard.js";

describe("isInternalEndpoint (T-10)", () => {
  it.each([
    "http://127.0.0.1/x",
    "http://10.0.0.5/x",
    "http://172.16.0.1/x",
    "http://192.168.1.1/x",
    "http://169.254.169.254/latest",
    "http://100.100.100.200/x",
    "http://localhost/x",
    "http://[::1]/x",
    "http://[::]/x",
    "http://[::ffff:127.0.0.1]/x",
    "http://[::ffff:10.0.0.5]/x",
    "http://[fc00::1]/x",
    "http://[fe80::1]/x",
    "http://[64:ff9b::a00:5]/x",
    "http://2130706433/x",
    "http://127.1/x",
    // 尾点写法：localhost. 与 localhost 解析结果相同，不能靠字符串比较放过。
    "http://localhost./x",
    "http://api.localhost./x",
    "http://127.0.0.1./x",
    // IPv4 兼容写法 ::a.b.c.d（URL 规范化为 ::7f00:1）、IPv4 转换写法 ::ffff:0:a.b.c.d。
    "http://[::127.0.0.1]/x",
    "http://[::7f00:1]/x",
    "http://[::ffff:0:7f00:1]/x",
    // 站点本地 fec0::/10、IPv6 组播 ff00::/8、6to4 内嵌内网地址。
    "http://[fec0::1]/x",
    "http://[feff::1]/x",
    "http://[ff02::1]/x",
    "http://[2002:7f00:1::]/x",
    // IPv4 组播 224.0.0.0/4 与保留段 240.0.0.0/4（含广播地址）。
    "http://224.0.0.1/x",
    "http://239.255.255.250/x",
    "http://240.0.0.1/x",
    "http://255.255.255.255/x",
  ])("treats %s as internal", (url) => {
    expect(isInternalEndpoint(url)).toBe(true);
  });

  it.each([
    "https://api.siliconflow.cn/v1",
    "https://8.8.8.8/x",
    "https://172.15.0.1/x",
    "https://172.32.0.1/x",
    "https://192.167.1.1/x",
    "https://[2606:4700:4700::1111]/x",
    // 本机代理的 fake-ip 网段：开着代理时公网域名都解析到这里，不能当内网拒绝。
    "https://198.18.0.5/x",
    "https://198.19.255.1/x",
    "https://223.255.255.255/x",
  ])("treats public %s as reachable", (url) => {
    expect(isInternalEndpoint(url)).toBe(false);
  });

  it.each([
    "file:///etc/passwd",
    "file:///C:/Users/someone/.novelfork/.secret-key",
    "data:text/plain,hello",
    "ftp://example.com/x",
    "blob:https://example.com/uuid",
    "not-a-url",
  ])("treats non-http(s) %s as unusable, never as a public endpoint (T-10)", (url) => {
    expect(isInternalEndpoint(url)).toBe(true);
    expect(isHttpEndpoint(url)).toBe(false);
  });
});

describe("isHttpEndpoint", () => {
  it("accepts http and https, including loopback (protocol whitelist only)", () => {
    expect(isHttpEndpoint("https://api.siliconflow.cn/v1")).toBe(true);
    expect(isHttpEndpoint("http://localhost:11434/v1")).toBe(true);
    expect(isHttpEndpoint("http://127.0.0.1:1234/v1")).toBe(true);
  });
});

describe("isInternalAddress (DNS 解析结果)", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "192.168.0.1",
    "169.254.169.254",
    "::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.5",
    "fe80::1%12",
    "fd00::1",
    "224.0.0.251",
    "",
    "not-an-ip",
  ])("rejects %s", (address) => {
    expect(isInternalAddress(address)).toBe(true);
  });

  it.each(["8.8.8.8", "198.18.0.7", "2606:4700:4700::1111"])("accepts public %s", (address) => {
    expect(isInternalAddress(address)).toBe(false);
  });
});

describe("checkPublicHttpEndpoint (发起请求前的完整校验)", () => {
  it("rejects a file: endpoint without resolving anything", async () => {
    const resolveHost = vi.fn();
    await expect(checkPublicHttpEndpoint("file:///etc/passwd", resolveHost)).resolves.toEqual({ ok: false, reason: "protocol" });
    expect(resolveHost).not.toHaveBeenCalled();
  });

  it("rejects a literal internal address without resolving anything", async () => {
    const resolveHost = vi.fn();
    await expect(checkPublicHttpEndpoint("http://10.0.0.5/scan", resolveHost)).resolves.toEqual({ ok: false, reason: "internal" });
    expect(resolveHost).not.toHaveBeenCalled();
  });

  it("accepts a public IP literal without DNS", async () => {
    const resolveHost = vi.fn();
    await expect(checkPublicHttpEndpoint("https://8.8.8.8/scan", resolveHost)).resolves.toEqual({ ok: true });
    expect(resolveHost).not.toHaveBeenCalled();
  });

  it("rejects a domain whose DNS answer contains an internal address (DNS 指向内网)", async () => {
    const resolveHost = vi.fn().mockResolvedValue(["8.8.8.8", "127.0.0.1"]);
    await expect(checkPublicHttpEndpoint("https://evil.example/scan", resolveHost)).resolves.toEqual({ ok: false, reason: "resolves-internal" });
    expect(resolveHost).toHaveBeenCalledWith("evil.example");
  });

  it("treats a DNS failure or an empty answer as unusable", async () => {
    await expect(checkPublicHttpEndpoint("https://gone.example/scan", vi.fn().mockRejectedValue(new Error("ENOTFOUND"))))
      .resolves.toEqual({ ok: false, reason: "unresolvable" });
    await expect(checkPublicHttpEndpoint("https://empty.example/scan", vi.fn().mockResolvedValue([])))
      .resolves.toEqual({ ok: false, reason: "unresolvable" });
  });

  it("fails closed for a domain when no resolver is available", async () => {
    await expect(checkPublicHttpEndpoint("https://api.zhuque.example/scan")).resolves.toEqual({ ok: false, reason: "unresolvable" });
  });

  it("accepts a domain that resolves only to public (or fake-ip proxy) addresses", async () => {
    const resolveHost = vi.fn().mockResolvedValue(["198.18.0.42", "2606:4700:4700::1111"]);
    await expect(checkPublicHttpEndpoint("https://api.zhuque.example/scan", resolveHost)).resolves.toEqual({ ok: true });
  });

  it("explains every rejection reason in three parts", () => {
    for (const reason of ["invalid-url", "protocol", "internal", "unresolvable", "resolves-internal"] as const) {
      const explanation = explainEndpointRejection(reason, "朱雀检测服务");
      expect(explanation.whatHappened).toBeTruthy();
      expect(explanation.whyItMatters).toBeTruthy();
      expect(explanation.suggestedAction).toBeTruthy();
    }
  });
});
