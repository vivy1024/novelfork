import { describe, expect, it, vi } from "vitest";

import { createRateLimitedWarningSink, startHttpServer } from "./start-http-server";

describe("startHttpServer", () => {
  it("exposes an awaited close adapter for Bun servers", async () => {
    const stop = vi.fn(async () => undefined);
    const previousBun = (globalThis as typeof globalThis & { Bun?: unknown }).Bun;
    (globalThis as typeof globalThis & { Bun?: unknown }).Bun = {
      serve: vi.fn(() => ({ stop })),
    };

    try {
      const server = await startHttpServer({ fetch: async () => new Response("ok"), port: 4567 });
      await server.close();
      expect(stop).toHaveBeenCalledTimes(1);
    } finally {
      if (previousBun === undefined) delete (globalThis as typeof globalThis & { Bun?: unknown }).Bun;
      else (globalThis as typeof globalThis & { Bun?: unknown }).Bun = previousBun;
    }
  });
});

describe("createRateLimitedWarningSink", () => {
  it("rate-limits repeated node-server Response internal state warnings", () => {
    let now = 1000;
    const sink = vi.fn();
    const warn = createRateLimitedWarningSink(sink, () => now);

    warn("Failed to find Response internal state key");
    warn("Failed to find Response internal state key");
    warn("unrelated warning");
    now += 5001;
    warn("Failed to find Response internal state key");

    expect(sink).toHaveBeenCalledTimes(3);
    expect(sink.mock.calls[0][0]).toBe("Failed to find Response internal state key");
    expect(sink.mock.calls[1][0]).toBe("unrelated warning");
    expect(sink.mock.calls[2][0]).toBe("Failed to find Response internal state key");
  });
});
