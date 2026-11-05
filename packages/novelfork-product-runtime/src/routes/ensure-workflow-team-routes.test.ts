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
  teamId: string;
  workerTrait: string;
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

  test("团队 id 固定为本书（修 B）：不同书不共用团队", async () => {
    const id = await ensureBook();
    const res = await productApp().request(`/api/books/${id}/narrators/ensure-workflow-team`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = await res.json() as EnsureTeamBody;
    expect(body.teamId).toBe(`team-${id}`);
    expect(body.teamId).toStartWith("team-");
    expect(body.workerTrait).toBe("novelfork-workflow-worker");
  });

  test("工人叙述者带 WORKFLOW_WORKER_TRAIT（修 A 的身份来源）", async () => {
    const id = await ensureBook();
    const res = await productApp().request(`/api/books/${id}/narrators/ensure-workflow-team`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = await res.json() as EnsureTeamBody;
    const traits = await workerTraits(body.members.map((m) => m.narratorId));
    for (const member of body.members) {
      expect(traits.get(member.narratorId) ?? []).toContain("novelfork-workflow-worker");
    }
  });

  test("已在的老工人（无标记）复调时补标记", async () => {
    const id = await ensureBook();
    const created = await productApp().request(`/api/books/${id}/narrators/ensure-workflow-team`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const createdBody = await created.json() as EnsureTeamBody;
    const ids = createdBody.members.map((m) => m.narratorId);
    await stripTrait(ids, "novelfork-workflow-worker");

    const again = await productApp().request(`/api/books/${id}/narrators/ensure-workflow-team`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const againBody = await again.json() as EnsureTeamBody;
    expect(againBody.members.every((m) => !m.created)).toBe(true);
    const traits = await workerTraits(ids);
    for (const narratorId of ids) {
      expect(traits.get(narratorId) ?? []).toContain("novelfork-workflow-worker");
    }
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

async function workerTraits(narratorIds: readonly string[]): Promise<Map<string, string[]>> {
  const { db, narrators } = await import("@vivy1024/narrafork-runtime-bridge");
  const { inArray } = await import("@vivy1024/narrafork-runtime-bridge/runtime-db");
  const rows = await db.select().from(narrators).where(inArray(narrators.id, [...narratorIds]));
  return new Map(rows.map((row: { id: string; traits?: string[] | null }) => [row.id, row.traits ?? []]));
}

async function stripTrait(narratorIds: readonly string[], trait: string): Promise<void> {
  const { db, narrators } = await import("@vivy1024/narrafork-runtime-bridge");
  const { eq, inArray } = await import("@vivy1024/narrafork-runtime-bridge/runtime-db");
  const rows = await db.select().from(narrators).where(inArray(narrators.id, [...narratorIds]));
  for (const row of rows) {
    await db
      .update(narrators)
      .set({ traits: (row.traits ?? []).filter((item: string) => item !== trait) })
      .where(eq(narrators.id, row.id));
  }
}

/**
 * 端到端闭环：真正的工人叙述者（路由建出来的）+ 真正进行中的运行 + 真正走 Runtime
 * 工具执行入口，确认写类被拒、读类放行、领导者不受工人闸门影响。
 */
describe("工人闸门端到端（执行入口）", () => {
  test("运行中工人调 chapter_write 被拒绝，说明指向 team_report；读类照常；领导者走工序闸门", async () => {
    const id = await ensureBook();
    const teamRes = await productApp().request(`/api/books/${id}/narrators/ensure-workflow-team`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const team = await teamRes.json() as EnsureTeamBody;
    const worker = team.members.find((m) => m.title === "工作流工人·writer");
    expect(worker).toBeTruthy();

    const listRes = await productApp().request(`/api/books/${id}/narrators`, { method: "GET" });
    const list = await listRes.json() as { narrators: { id: string; title: string }[] };
    const leader = list.narrators.find((n) => !n.title.startsWith("工作流工人·"));
    expect(leader).toBeTruthy();

    const { getStorageDatabase } = await import("@vivy1024/novelfork-core");
    const { startWorkflowRun } = await import("@vivy1024/novelfork-novel-plugin/engine");
    const run = await startWorkflowRun({
      storage: getStorageDatabase(),
      bookId: id,
      bookRoot,
      recipeId: team.recipeId,
      chapterNumber: 1,
      narratorId: leader!.id,
    });
    expect(run.ok).toBe(true);

    const { NovelRuntimeAdapter } = await import("../adapters/runtime-adapter");
    const context = Object.freeze({
      runtimeProjectId: `project-${id}`,
      projectRoot: bookRoot,
      projectType: "novel" as const,
      enabledPluginIds: Object.freeze(["novelfork-novel"]),
      resourceBindings: Object.freeze({
        "novel.book": Object.freeze({ kind: "novel.book", bookId: id, root: bookRoot }),
      }),
    });
    const adapter = new NovelRuntimeAdapter({
      async resolveForNarrator() {
        return context as never;
      },
    });

    const blocked = await adapter.execute("chapter_write", { chapterNumber: 1, content: "工人偷写" }, worker!.narratorId);
    expect(blocked.isError).toBe(true);
    const blockedBody = JSON.parse(blocked.output) as { error: string; summary: string };
    expect(blockedBody.error).toBe("workflow-worker-disallowed");
    expect(blockedBody.summary).toContain("工作流工人");
    expect(blockedBody.summary).toContain("team_report");

    // 读类不受工人闸门影响
    const read = await adapter.execute("chapter_list", {}, worker!.narratorId);
    expect((JSON.parse(read.output) as { error?: string }).error).not.toBe("workflow-worker-disallowed");

    // 领导者不是工人：拦它的仍是工序闸门，不是工人闸门
    const leaderWrite = await adapter.execute("chapter_write", { chapterNumber: 1, content: "领导者偷写" }, leader!.id);
    expect((JSON.parse(leaderWrite.output) as { error?: string }).error).not.toBe("workflow-worker-disallowed");

    // Runtime 子代理（task 派出）：继承领导者 contextProjectId、type=subagent、没有工人标记，也必须被收口
    const { db: runtimeDb, narrators } = await import("@vivy1024/narrafork-runtime-bridge");
    const { eq } = await import("@vivy1024/narrafork-runtime-bridge/runtime-db");
    const leaderRow = await runtimeDb.query.narrators.findFirst({ where: eq(narrators.id, leader!.id) });
    expect(leaderRow).toBeTruthy();
    const subagentId = `subagent-${crypto.randomUUID()}`;
    await runtimeDb.insert(narrators).values({
      ...leaderRow,
      id: subagentId,
      type: "subagent",
      variant: "subagent",
      title: "通用子代理",
      traits: [],
      parentNarratorId: leader!.id,
    });
    try {
      const subWrite = await adapter.execute("chapter_write", { chapterNumber: 1, content: "子代理偷写" }, subagentId);
      expect((JSON.parse(subWrite.output) as { error?: string }).error).toBe("workflow-worker-disallowed");
      const subRead = await adapter.execute("chapter_list", {}, subagentId);
      expect((JSON.parse(subRead.output) as { error?: string }).error).not.toBe("workflow-worker-disallowed");
    } finally {
      await runtimeDb.delete(narrators).where(eq(narrators.id, subagentId));
    }
  });
});
