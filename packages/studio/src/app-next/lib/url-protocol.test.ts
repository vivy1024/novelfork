import { describe, expect, it } from "vitest";

import { normalizeUrlProtocol } from "./url-protocol";

describe("normalizeUrlProtocol", () => {
  it("补全裸主机名的协议，避免 Runtime 的 z.string().url() 直接 400", () => {
    expect(normalizeUrlProtocol("example.com/hook")).toBe("https://example.com/hook");
    expect(normalizeUrlProtocol("example.com")).toBe("https://example.com");
  });

  it("已有协议时原样返回", () => {
    expect(normalizeUrlProtocol("https://example.com/hook")).toBe("https://example.com/hook");
    expect(normalizeUrlProtocol("http://example.com")).toBe("http://example.com");
  });

  it("本地目标补 http 而不是 https", () => {
    expect(normalizeUrlProtocol("localhost:8080/hook")).toBe("http://localhost:8080/hook");
    expect(normalizeUrlProtocol("127.0.0.1:9000")).toBe("http://127.0.0.1:9000");
  });

  it("空值与纯空白返回 undefined", () => {
    expect(normalizeUrlProtocol("")).toBeUndefined();
    expect(normalizeUrlProtocol("   ")).toBeUndefined();
    expect(normalizeUrlProtocol(null)).toBeUndefined();
    expect(normalizeUrlProtocol(undefined)).toBeUndefined();
  });

  it("不把疑似本地路径当作主机名", () => {
    expect(normalizeUrlProtocol("/var/run/hook.sh")).toBe("/var/run/hook.sh");
    expect(normalizeUrlProtocol("./scripts/hook.sh")).toBe("./scripts/hook.sh");
    expect(normalizeUrlProtocol("C:\\scripts\\hook.bat")).toBe("C:\\scripts\\hook.bat");
  });

  it("去掉首尾空白", () => {
    expect(normalizeUrlProtocol("  example.com/hook  ")).toBe("https://example.com/hook");
  });
});
