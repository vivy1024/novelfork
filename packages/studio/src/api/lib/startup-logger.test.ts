import { describe, expect, it, vi } from "vitest";

import { logStartupEvent, summarizeStartupEvents } from "./startup-logger";

describe("startup-logger", () => {
  it("writes startup events as single-line JSON", () => {
    const sink = vi.fn();

    logStartupEvent({
      level: "info",
      component: "static.provider",
      msg: "Static provider ready",
      ok: true,
      extra: { source: "embedded", assetCount: 12 },
    }, sink);

    expect(sink).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(sink.mock.calls[0][0]);
    expect(parsed).toMatchObject({
      level: "info",
      component: "static.provider",
      msg: "Static provider ready",
      ok: true,
      source: "embedded",
      assetCount: 12,
    });
    expect(parsed.timestamp).toEqual(expect.any(String));
  });

  it("summarizes startup event outcomes", () => {
    expect(summarizeStartupEvents([
      { level: "info", component: "config.load", msg: "ok", ok: true },
      { level: "warn", component: "mcp.init", msg: "skipped", skipped: true },
      { level: "error", component: "compile-smoke", msg: "failed", ok: false },
    ])).toEqual({ ok: 1, skipped: 1, failed: 1 });
  });
});
