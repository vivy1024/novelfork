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
    if (!result.ok) throw new Error("expected contract success");
    expect(result.httpStatus).toBe(200);
    expect(result.data.metrics[0]).toEqual({ name: "unknown", value: null });
    expect(result.data.streamSource).toBe("chunked-buffer");
    expect(result.data.gate).toBeNull();
  });

  it("preserves 4xx error envelope code, error, gate, and capability status", async () => {
    const body = { error: { code: "auth-missing", message: "缺少密钥" }, code: "auth-missing", gate: { reason: "provider" } };
    const client = createContractClient({
      fetch: vi.fn(async () => new Response(JSON.stringify(body), { status: 409, headers: { "content-type": "application/json" } })),
    });

    const result = await client.post("/api/books/b1/hooks/generate", undefined, { capability: { id: "hooks.generate", status: "unsupported" } });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected contract failure");
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
    if (result.ok) throw new Error("expected contract failure");
    expect(result.httpStatus).toBe(502);
    expect(result.error).toEqual(body);
    expect(result.raw).toEqual(body);
  });

  it("keeps request bodies that contain capability fields as payload", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const client = createContractClient({ fetch: fetchMock });

    await client.post("/api/sessions", { title: "带 capability 字段的正文", capability: "payload-value" }, { capability: { id: "sessions.create", status: "current" } });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sessions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ title: "带 capability 字段的正文", capability: "payload-value" }),
      }),
    );
  });

  it("returns invalid-json envelope with raw text", async () => {
    const client = createContractClient({
      fetch: vi.fn(async () => new Response("{not json", { status: 200, headers: { "content-type": "application/json" } })),
    });

    const result = await client.get("/api/books");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected contract failure");
    expect(result.httpStatus).toBe(200);
    expect(result.code).toBe("invalid-json");
    expect(result.rawText).toBe("{not json");
  });

  it("returns network-error envelope without swallowing the original error", async () => {
    const cause = new TypeError("fetch failed");
    const client = createContractClient({ fetch: vi.fn(async () => Promise.reject(cause)) });

    const result = await client.get("/api/books");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected contract failure");
    expect(result.httpStatus).toBeNull();
    expect(result.code).toBe("network-error");
    expect(result.cause).toBe(cause);
  });
});
