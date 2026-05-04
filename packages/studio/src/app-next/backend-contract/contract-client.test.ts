import { afterEach, describe, expect, it, vi } from "vitest";

import { createContractClient } from "./contract-client";

describe("contract client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("preserves 2xx JSON payload fields including null and unknown metric", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          metrics: [{ name: "unknown", value: null }],
          streamSource: "chunked-buffer",
          gate: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const client = createContractClient({ fetch: fetchMock });

    const result = await client.get<{ metrics: Array<{ name: string; value: number | null }>; streamSource: string; gate: null }>(
      "/api/progress",
      { capability: { id: "progress", status: "current" } },
    );

    expect(result.ok).toBe(true);
    expect(result.httpStatus).toBe(200);
    expect(result.data?.metrics[0]).toEqual({ name: "unknown", value: null });
    expect(result.data?.streamSource).toBe("chunked-buffer");
    expect(result.data?.gate).toBeNull();
  });

  it("preserves 4xx error envelope code, error, gate, and capability status", async () => {
    const body = { error: { code: "auth-missing", message: "缺少密钥" }, code: "auth-missing", gate: { reason: "provider" } };
    const client = createContractClient({
      fetch: vi.fn(async () => new Response(JSON.stringify(body), { status: 409, headers: { "content-type": "application/json" } })),
    });

    const result = await client.post("/api/books/b1/hooks/generate", { capability: { id: "hooks.generate", status: "unsupported" } });

    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(409);
    expect(result.error).toEqual(body);
    expect(result.raw).toEqual(body);
    expect(result.capability.status).toBe("unsupported");
  });

  it("preserves 5xx envelopes without throwing", async () => {
    const body = { error: "upstream failed", code: "upstream-error", streamSource: "provider" };
    const client = createContractClient({
      fetch: vi.fn(async () => new Response(JSON.stringify(body), { status: 502, headers: { "content-type": "application/json" } })),
    });

    const result = await client.get("/api/providers/status", { capability: { id: "providers.status", status: "current" } });

    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(502);
    expect(result.error).toEqual(body);
    expect(result.raw).toEqual(body);
  });

  it("returns invalid-json envelope with raw text", async () => {
    const client = createContractClient({
      fetch: vi.fn(async () => new Response("{not json", { status: 200, headers: { "content-type": "application/json" } })),
    });

    const result = await client.get("/api/books");

    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(200);
    expect(result.code).toBe("invalid-json");
    expect(result.rawText).toBe("{not json");
  });

  it("returns network-error envelope without swallowing the original error", async () => {
    const cause = new TypeError("fetch failed");
    const client = createContractClient({ fetch: vi.fn(async () => Promise.reject(cause)) });

    const result = await client.get("/api/books");

    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBeNull();
    expect(result.code).toBe("network-error");
    expect(result.cause).toBe(cause);
  });
});
