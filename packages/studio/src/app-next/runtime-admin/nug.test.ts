import { describe, expect, it, vi } from "vitest";

import { createNugProviderClient } from "./nug";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("NUG provider client", () => {
  it("uses the Runtime NUG account and status routes", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ ok: true }));
    const client = createNugProviderClient({ fetchImpl: fetchMock });

    await client.nugLogin("nug/main", "writer", "secret");
    await client.nugOAuthStart("nug/main");
    await client.nugGetQuota("nug/main");
    await client.nugGetChannelsHealth("nug/main");

    expect(fetchMock.mock.calls.map(([path, init]) => [path, init?.method, init?.body])).toEqual([
      ["/api/nug/providers/nug%2Fmain/login", "POST", JSON.stringify({ username: "writer", password: "secret" })],
      ["/api/nug/providers/nug%2Fmain/oauth/start", undefined, undefined],
      ["/api/nug/providers/nug%2Fmain/quota", undefined, undefined],
      ["/api/nug/providers/nug%2Fmain/channels/health", undefined, undefined],
    ]);
  });
});
