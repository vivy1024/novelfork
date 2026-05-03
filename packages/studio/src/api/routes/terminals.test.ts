import { describe, expect, it, beforeEach } from "vitest";
import { Hono } from "hono";

import { TerminalStore, type TerminalInfo } from "../lib/terminal-store.js";
import { createTerminalsRouter } from "./terminals.js";

function makeApp(store: TerminalStore) {
  const app = new Hono();
  app.route("/api/terminals", createTerminalsRouter(store));
  return app;
}

function makeTerm(overrides: Partial<TerminalInfo> = {}): TerminalInfo {
  return {
    id: "t-1",
    name: "shell",
    status: "running",
    cwd: "/home/user",
    createdAt: "2026-05-03T00:00:00Z",
    ...overrides,
  };
}

describe("createTerminalsRouter", () => {
  let store: TerminalStore;

  beforeEach(() => {
    store = new TerminalStore();
  });

  // --- GET /api/terminals ---

  it("GET 返回空列表", async () => {
    const app = makeApp(store);
    const res = await app.request("/api/terminals");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ running: [], exited: [] });
  });

  it("GET 返回正确分组的终端信息", async () => {
    store.register(makeTerm({ id: "t-1", status: "running", pid: 1234 }));
    store.register(makeTerm({ id: "t-2", status: "exited", name: "build" }));

    const app = makeApp(store);
    const res = await app.request("/api/terminals");
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.running).toHaveLength(1);
    expect(body.exited).toHaveLength(1);
    expect(body.running[0].id).toBe("t-1");
    expect(body.running[0].pid).toBe(1234);
    expect(body.exited[0].id).toBe("t-2");
  });

  it("终端信息包含所有必要字段", async () => {
    store.register(makeTerm({ id: "t-1", pid: 5678 }));

    const app = makeApp(store);
    const res = await app.request("/api/terminals");
    const body = await res.json();
    const term = body.running[0];

    expect(term).toMatchObject({
      id: "t-1",
      name: "shell",
      status: "running",
      cwd: "/home/user",
      createdAt: "2026-05-03T00:00:00Z",
      pid: 5678,
    });
  });

  // --- DELETE /api/terminals/:id ---

  it("DELETE 清理已退出的终端", async () => {
    store.register(makeTerm({ id: "t-1", status: "exited" }));

    const app = makeApp(store);
    const res = await app.request("/api/terminals/t-1", { method: "DELETE" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // 确认已删除
    const listRes = await app.request("/api/terminals");
    const listBody = await listRes.json();
    expect(listBody.running).toHaveLength(0);
    expect(listBody.exited).toHaveLength(0);
  });

  it("DELETE 运行中的终端返回 409", async () => {
    store.register(makeTerm({ id: "t-1", status: "running" }));

    const app = makeApp(store);
    const res = await app.request("/api/terminals/t-1", { method: "DELETE" });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("运行");
  });

  it("DELETE 不存在的终端返回 404", async () => {
    const app = makeApp(store);
    const res = await app.request("/api/terminals/nonexistent", { method: "DELETE" });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });
});
