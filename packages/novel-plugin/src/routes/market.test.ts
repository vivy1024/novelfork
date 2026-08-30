import { describe, expect, it } from "vitest";

import { createMarketRouter } from "./market.js";

describe("market router", () => {
  it("lists rank catalogs", async () => {
    const app = createMarketRouter();
    const response = await app.request("/api/market/ranks");
    expect(response.status).toBe(200);
    const body = await response.json() as { qidian: unknown[]; fanqie: unknown[] };
    expect(body.qidian.length).toBe(4);
    expect(body.fanqie.length).toBe(4);
  });
});
