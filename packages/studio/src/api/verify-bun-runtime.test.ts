import { describe, expect, it } from "vitest";

import { buildRuntimeVerificationSummary, extractStartupSmokeChecks } from "./lib/verify-bun-runtime";

describe("buildRuntimeVerificationSummary", () => {
  it("collects unique failure categories for bun runtime smoke output", () => {
    const summary = buildRuntimeVerificationSummary([
      { name: "core typecheck", ok: true, category: "runtime" },
      { name: "storage verify", ok: false, category: "storage", detail: "migration failed" },
      { name: "homepage smoke", ok: false, category: "frontend", detail: "HTTP 500" },
      { name: "provider gate", ok: false, category: "provider", detail: "blocked startup" },
      { name: "frontend duplicate failure", ok: false, category: "frontend", detail: "missing title" },
    ]);

    expect(summary).toEqual({
      ok: false,
      runtime: "bun",
      checks: [
        { name: "core typecheck", ok: true, category: "runtime" },
        { name: "storage verify", ok: false, category: "storage", detail: "migration failed" },
        { name: "homepage smoke", ok: false, category: "frontend", detail: "HTTP 500" },
        { name: "provider gate", ok: false, category: "provider", detail: "blocked startup" },
        { name: "frontend duplicate failure", ok: false, category: "frontend", detail: "missing title" },
      ],
      counts: {
        total: 5,
        passed: 1,
        failed: 4,
      },
      failureCategories: ["storage", "frontend", "provider"],
    });
  });
});

describe("extractStartupSmokeChecks", () => {
  it("reads bun startup logs and recovery diagnostics into categorized smoke checks", () => {
    const checks = extractStartupSmokeChecks([
      JSON.stringify({ component: "server.listen", ok: true, runtime: "bun", url: "http://localhost:4571" }),
      JSON.stringify({ component: "storage.sqlite", ok: true, databasePath: ":memory:" }),
      JSON.stringify({ component: "websocket.register", ok: true, route: "/api/admin/resources/ws" }),
      JSON.stringify({ component: "websocket.register", ok: true, route: "/api/sessions/:id/chat" }),
      "Startup recovery report: {\"actions\":[{\"kind\":\"provider-availability\",\"status\":\"skipped\",\"reason\":\"部分启用供应商缺少 API Key\",\"note\":\"configured=none;missing=openai\"},{\"kind\":\"git-worktree-pollution\",\"status\":\"success\",\"reason\":\"未检测到外部项目 worktree\"},{\"kind\":\"unclean-shutdown\",\"status\":\"success\",\"reason\":\"运行标记已写入\"}]}"
    ]);

    expect(checks).toEqual({
      runtimeCheck: { name: "startup runtime", ok: true, category: "runtime", detail: "runtime=bun" },
      storageCheck: { name: "startup storage", ok: true, category: "storage", detail: expect.stringContaining("databasePath") },
      websocketCheck: { name: "startup websocket", ok: true, category: "websocket", detail: "/api/admin/resources/ws, /api/sessions/:id/chat" },
      providerCheck: { name: "startup provider gate", ok: true, category: "provider", detail: "configured=none;missing=openai" },
      environmentCheck: { name: "startup environment diagnostics", ok: true, category: "environment", detail: expect.stringContaining("git-worktree-pollution:success") },
    });
  });
});
