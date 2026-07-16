import { describe, expect, it, vi } from "vitest";
import { createChapterContainerSettingsClient } from "./chapter-containers";
import { createTerminalsAdminClient } from "./terminals";

function fetchMock() {
  return vi.fn(async () => new Response(JSON.stringify({}), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }));
}

function requestAt(mock: ReturnType<typeof fetchMock>, index: number) {
  const [path, init] = mock.mock.calls[index] as unknown as [string, RequestInit];
  return { path, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined };
}

describe("chapter/container settings client", () => {
  it("reads settings and PATCHes only the real chapters and containers sections", async () => {
    const mock = fetchMock();
    const client = createChapterContainerSettingsClient({ fetchImpl: mock as unknown as typeof fetch });
    const patch = {
      chapters: { maxActiveWorktrees: 12, maxActiveContainers: 4, worktreeSizeWarningMb: 800, autoSaveOnDormant: true, dormantAfterMinutes: 30 },
      containers: { portRangeStart: 12000, portRangeEnd: 13000, proxy: { enabled: true, port: 7780 } },
    };

    await client.get();
    await client.patch(patch);

    expect(requestAt(mock, 0)).toEqual({ path: "/api/settings", method: "GET", body: undefined });
    expect(requestAt(mock, 1)).toEqual({ path: "/api/settings", method: "PATCH", body: patch });
  });
});

describe("terminals admin client", () => {
  it("uses the Runtime native terminal management endpoints and encodes IDs", async () => {
    const mock = fetchMock();
    const client = createTerminalsAdminClient({ fetchImpl: mock as unknown as typeof fetch });

    await client.list();
    await client.kill("term/a b");
    await client.batchKill(["term-1", "term-2"]);
    await client.killOrphan("orphan/a");
    await client.reattach("term/a b");
    await client.reattachOrphan("orphan/a");

    expect(requestAt(mock, 0)).toEqual({ path: "/api/admin/terminals", method: "GET", body: undefined });
    expect(requestAt(mock, 1)).toEqual({ path: "/api/admin/terminals/term%2Fa%20b", method: "DELETE", body: undefined });
    expect(requestAt(mock, 2)).toEqual({ path: "/api/admin/terminals/batch-kill", method: "POST", body: { ids: ["term-1", "term-2"] } });
    expect(requestAt(mock, 3)).toEqual({ path: "/api/admin/terminals/kill-orphan", method: "POST", body: { terminalId: "orphan/a" } });
    expect(requestAt(mock, 4)).toEqual({ path: "/api/admin/terminals/term%2Fa%20b/reattach", method: "POST", body: undefined });
    expect(requestAt(mock, 5)).toEqual({ path: "/api/admin/terminals/reattach-orphan", method: "POST", body: { terminalId: "orphan/a" } });
  });
});
