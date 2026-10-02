import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { AppError } from "@vivy1024/narrafork-runtime-bridge";
import { novelForkProductIntegration } from "../index";
import { initializeNovelRuntimeStorage } from "../adapters/storage";

const owner = { sub: `team-route-owner-${crypto.randomUUID()}`, role: "admin" as const };

function productApp() {
  const app = new Hono<{ Variables: { user: typeof owner } }>();
  const { mountAuthenticatedGuards, mountAuthenticatedRoutes } = novelForkProductIntegration;
  if (!mountAuthenticatedGuards || !mountAuthenticatedRoutes) {
    throw new Error("NovelFork product integration did not provide authenticated HTTP mounts");
  }
  app.use("*", async (c, next) => { c.set("user", owner as never); await next(); });
  mountAuthenticatedGuards(app);
  mountAuthenticatedRoutes(app);
  app.onError((error, c) => error instanceof AppError ? c.json({ code: error.code, error: error.message }, error.statusCode as never) : c.json({ error: String(error) }, 500));
  return app;
}

let bookRoot = "";
let bookId: string | null = null;

afterAll(async () => {
  if (bookId) {
    try {
      await productApp().request(`/api/novelfork/books/${bookId}`, { method: "DELETE" });
    } catch {
      // Best-effort fixture cleanup.
    }
  }
  await rm(bookRoot, { recursive: true, force: true }).catch(() => undefined);
});

async function ensureBook(): Promise<string> {
  if (bookId) return bookId;
  initializeNovelRuntimeStorage();
  bookRoot = await mkdtemp(join(tmpdir(), "novelfork-team-route-book-"));
  const create = await productApp().request("/api/novelfork/books", {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": `team-route-${crypto.randomUUID()}` },
    body: JSON.stringify({ title: "团队路由验收书", projectInit: { source: "new", workspaceRoot: bookRoot } }),
  });
  const operation = await create.json() as { bookId?: string; state?: string; errorMessage?: string | null };
  expect({ status: create.status, operation }).toMatchObject({ status: 201, operation: { state: "ready", errorMessage: null } });
  if (!operation.bookId) throw new Error("fixture book not created");
  bookId = operation.bookId;
  return bookId;
}

type EnsureTeamBody = {
  recipeId: string;
  recipeName: string;
  members: readonly { roleKey: string; title: string; narratorId: string; created: boolean; stepIds: readonly string[] }[];
};

describe("ensure-workflow-team 路由（T5.2 工人建队接口）", () => {
  test("默认方案幂等建队：首调 created，复调 reused", async () => {
    const id = await ensureBook();
    const first = await productApp().request(`/api/books/${id}/narrators/ensure-workflow-team`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(first.status).toBe(200);
    const firstBody = await first.json() as EnsureTeamBody;
    expect(firstBody.recipeId).toBe("fanqie-xuanhuan-serial");
    expect(firstBody.members.length).toBe(2);
    const titles = new Set(firstBody.members.map((m) => m.title));
    expect(titles.has("工作流工人·writer")).toBe(true);
    expect(titles.has("工作流工人·novel-continuity-auditor")).toBe(true);
    expect(firstBody.members.every((m) => m.created)).toBe(true);

    const second = await productApp().request(`/api/books/${id}/narrators/ensure-workflow-team`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recipeId: "fanqie-xuanhuan-serial" }),
    });
    expect(second.status).toBe(200);
    const secondBody = await second.json() as EnsureTeamBody;
    expect(secondBody.members.length).toBe(2);
    expect(secondBody.members.every((m) => !m.created)).toBe(true);
    expect(secondBody.members.map((m) => m.narratorId).sort())
      .toEqual(firstBody.members.map((m) => m.narratorId).sort());
  });

  test("未知 recipeId 返回 404，不乱建队", async () => {
    const id = await ensureBook();
    const res = await productApp().request(`/api/books/${id}/narrators/ensure-workflow-team`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recipeId: "recipe-does-not-exist" }),
    });
    expect(res.status).toBe(404);

    const after = await productApp().request(`/api/books/${id}/narrators/ensure-workflow-team`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = await after.json() as EnsureTeamBody;
    expect(body.members.length).toBe(2);
  });
});
