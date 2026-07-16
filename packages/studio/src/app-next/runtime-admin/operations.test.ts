import { describe, expect, it, vi } from "vitest";
import {
  createGatewayClient,
  createRuntimeMaintenanceClient,
  createStorageClient,
  createUsageHistoryClient,
} from "./index";

function createFetchMock() {
  return vi.fn(async () =>
    new Response(JSON.stringify({}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function expectRequest(
  fetchMock: ReturnType<typeof createFetchMock>,
  index: number,
  expected: { path: string; method?: string; body?: unknown },
) {
  const [path, init] = fetchMock.mock.calls[index] as unknown as [string, RequestInit];
  expect(path).toBe(expected.path);
  expect(init.method ?? "GET").toBe(expected.method ?? "GET");
  if ("body" in expected) {
    expect(JSON.parse(String(init.body))).toEqual(expected.body);
  } else {
    expect(init.body).toBeUndefined();
  }
}

describe("storage client", () => {
  it("covers cached data and non-SSE cleanup endpoints", async () => {
    const fetchMock = createFetchMock();
    const client = createStorageClient({ fetchImpl: fetchMock as unknown as typeof fetch });

    await client.cached();
    await client.cleanup("worktrees");
    await client.previewDatabase({ target: "staleSessions", olderThanDays: 45, sampleLimit: 5 });
    await client.cleanupDatabase({ target: "apiRequestDumps", olderThanDays: 30 });
    await client.vacuumDatabase();

    expectRequest(fetchMock, 0, { path: "/api/storage/cached" });
    expectRequest(fetchMock, 1, {
      path: "/api/storage/cleanup",
      method: "POST",
      body: { target: "worktrees" },
    });
    expectRequest(fetchMock, 2, {
      path: "/api/storage/database/preview",
      method: "POST",
      body: { target: "staleSessions", olderThanDays: 45, sampleLimit: 5 },
    });
    expectRequest(fetchMock, 3, {
      path: "/api/storage/database/cleanup",
      method: "POST",
      body: { target: "apiRequestDumps", olderThanDays: 30 },
    });
    expectRequest(fetchMock, 4, { path: "/api/storage/database/vacuum", method: "POST" });
  });
});

describe("runtime maintenance client", () => {
  it("uses the real cached, scan, and cleanup endpoints", async () => {
    const fetchMock = createFetchMock();
    const client = createRuntimeMaintenanceClient({ fetchImpl: fetchMock as unknown as typeof fetch });

    await client.cached();
    await client.scan();
    await client.cleanup("terminals");

    expectRequest(fetchMock, 0, { path: "/api/runtime/cached" });
    expectRequest(fetchMock, 1, { path: "/api/runtime/scan" });
    expectRequest(fetchMock, 2, {
      path: "/api/runtime/cleanup",
      method: "POST",
      body: { target: "terminals" },
    });
  });
});

describe("usage history client", () => {
  it("builds URLSearchParams for list, stats, and timeseries and encodes detail IDs", async () => {
    const fetchMock = createFetchMock();
    const client = createUsageHistoryClient({ fetchImpl: fetchMock as unknown as typeof fetch });
    const filters = {
      narratorId: "narrator/a b",
      projectId: "project/中文",
      provider: "custom api",
      startDate: "2026-01-01T00:00:00+08:00",
    };

    await client.list({ ...filters, page: 2, pageSize: 25 });
    await client.providers();
    await client.stats(filters);
    await client.timeseries(filters, "hour");
    await client.detail("usage/a b");

    const baseQuery =
      "narratorId=narrator%2Fa+b&projectId=project%2F%E4%B8%AD%E6%96%87&provider=custom+api&startDate=2026-01-01T00%3A00%3A00%2B08%3A00";
    expectRequest(fetchMock, 0, {
      path: `/api/usage-history?${baseQuery}&page=2&pageSize=25`,
    });
    expectRequest(fetchMock, 1, { path: "/api/usage-history/providers" });
    expectRequest(fetchMock, 2, { path: `/api/usage-history/stats?${baseQuery}` });
    expectRequest(fetchMock, 3, {
      path: `/api/usage-history/timeseries?${baseQuery}&granularity=hour`,
    });
    expectRequest(fetchMock, 4, { path: "/api/usage-history/usage%2Fa%20b" });
  });
});

describe("gateway client", () => {
  it("covers status, reload, sessions, and encoded deletion", async () => {
    const fetchMock = createFetchMock();
    const client = createGatewayClient({ fetchImpl: fetchMock as unknown as typeof fetch });

    await client.status();
    await client.reload(["telegram", "weixin"]);
    await client.sessions();
    await client.deleteSession("session/a b");

    expectRequest(fetchMock, 0, { path: "/api/gateway/status" });
    expectRequest(fetchMock, 1, {
      path: "/api/gateway/reload",
      method: "POST",
      body: { platforms: ["telegram", "weixin"] },
    });
    expectRequest(fetchMock, 2, { path: "/api/gateway/sessions" });
    expectRequest(fetchMock, 3, {
      path: "/api/gateway/sessions/session%2Fa%20b",
      method: "DELETE",
    });
  });
});
