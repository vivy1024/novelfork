import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sessionRouter from "./session";

describe("sessionRouter", () => {
  let sessionStoreDir: string;

  beforeEach(async () => {
    sessionStoreDir = await mkdtemp(join(tmpdir(), "novelfork-session-route-"));
    process.env.NOVELFORK_SESSION_STORE_DIR = sessionStoreDir;
  });

  afterEach(async () => {
    delete process.env.NOVELFORK_SESSION_STORE_DIR;
    await rm(sessionStoreDir, { recursive: true, force: true });
  });

  it("creates and returns formal narrator session records", async () => {
    const createResponse = await sessionRouter.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Planner 会话",
        agentId: "planner",
        kind: "standalone",
        worktree: "feature/session-core",
        sessionConfig: {
          providerId: "anthropic",
          modelId: "claude-sonnet-4-6",
          permissionMode: "ask",
          reasoningEffort: "high",
        },
      }),
    });

    expect(createResponse.status).toBe(201);
    const created = await createResponse.json();

    expect(created).toMatchObject({
      title: "Planner 会话",
      agentId: "planner",
      kind: "standalone",
      worktree: "feature/session-core",
      status: "active",
      sortOrder: 0,
      sessionConfig: {
        providerId: "anthropic",
        modelId: "claude-sonnet-4-6",
        permissionMode: "ask",
        reasoningEffort: "high",
      },
    });
    expect(typeof created.id).toBe("string");
    expect(typeof created.createdAt).toBe("string");
    expect(typeof created.lastModified).toBe("string");

    const listResponse = await sessionRouter.request("http://localhost/");
    expect(listResponse.status).toBe(200);

    const sessions = await listResponse.json();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: created.id,
      agentId: "planner",
      kind: "standalone",
      sessionConfig: {
        providerId: "anthropic",
        modelId: "claude-sonnet-4-6",
      },
    });
  });
});
