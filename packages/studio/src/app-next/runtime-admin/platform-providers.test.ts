import { describe, expect, it, vi } from "vitest";

import { createPlatformProvidersClient } from "./platform-providers";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("platform provider client", () => {
  it("uses the dedicated Runtime Kiro, Codex, and Cline routes", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ ok: true }));
    const client = createPlatformProvidersClient({ fetchImpl: fetchMock });

    await client.kiroStatus();
    await client.kiroImportCredentials([{ refreshToken: "kiro-token" }]);
    await client.kiroSetLoadBalancingMode("balanced");
    await client.codexBrowserAuth();
    await client.codexStartDeviceAuth();
    await client.codexPollDeviceAuth();
    await client.codexImportCredentials([{ refreshToken: "codex-token" }]);
    await client.codexSetLoadBalancingMode("tier-balanced");
    await client.codexSetTierOrder(["pro", "plus", "free"]);
    await client.clineStatus();
    await client.clinePoolSearch("claude sonnet", 50);
    await client.clineSetEnabledModels(["anthropic/claude-sonnet-4"]);

    expect(fetchMock.mock.calls.map(([path, init]) => [path, init?.method, init?.body])).toEqual([
      ["/api/kiro/status", undefined, undefined],
      ["/api/kiro/credentials/import", "POST", JSON.stringify({ credentials: [{ refreshToken: "kiro-token" }] })],
      ["/api/kiro/load-balancing-mode", "POST", JSON.stringify({ mode: "balanced" })],
      ["/api/codex/auth/browser", "POST", undefined],
      ["/api/codex/auth/device/start", "POST", undefined],
      ["/api/codex/auth/device/poll", "POST", undefined],
      ["/api/codex/import", "POST", JSON.stringify({ credentials: [{ refreshToken: "codex-token" }] })],
      ["/api/codex/load-balancing-mode", "POST", JSON.stringify({ mode: "tier-balanced" })],
      ["/api/codex/tier-order", "POST", JSON.stringify({ tierOrder: ["pro", "plus", "free"] })],
      ["/api/cline/status", undefined, undefined],
      ["/api/cline/pool/search?q=claude+sonnet&limit=50", undefined, undefined],
      ["/api/cline/enabled-models", "POST", JSON.stringify({ models: ["anthropic/claude-sonnet-4"] })],
    ]);
  });
});
