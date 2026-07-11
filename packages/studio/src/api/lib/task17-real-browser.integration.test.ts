import { afterEach, describe, expect, it } from "vitest";

import type { SessionToolExecutionInput } from "../../shared/agent-native-workspace.js";
import { createSessionToolExecutor } from "./session-tool-executor.js";
import { SessionRuntimeResourceRegistry } from "./session-runtime/resource-registry.js";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function browserInput(sessionId: string, input: Record<string, unknown>): SessionToolExecutionInput {
  return {
    sessionId,
    toolName: "Browser",
    input,
    permissionMode: "allow",
  };
}

describe("Task17 real Browser integration", () => {
  const registries: SessionRuntimeResourceRegistry[] = [];

  afterEach(async () => {
    for (const registry of registries) {
      await registry.disposeAll("shutdown");
    }
    registries.length = 0;
  });

  it("launches real system Chrome for two owners and leaves no live sessions after close/dispose", async () => {
    const registry = new SessionRuntimeResourceRegistry();
    registries.push(registry);
    const ownerA = createSessionToolExecutor({ controlOwnerSessionId: "browser-owner-a", executionSessionId: "browser-execution-a", resourceRegistry: registry });
    const ownerB = createSessionToolExecutor({ controlOwnerSessionId: "browser-owner-b", executionSessionId: "browser-execution-b", resourceRegistry: registry });
    const urlA = "data:text/html,<title>NovelFork Owner A</title><main>owner-a</main>";
    const urlB = "data:text/html,<title>NovelFork Owner B</title><main>owner-b</main>";

    const launchA = await ownerA.execute(browserInput("browser-execution-a", { action: "launch", url: urlA }));
    const launchB = await ownerB.execute(browserInput("browser-execution-b", { action: "launch", url: urlB }));
    expect(launchA, JSON.stringify(launchA)).toMatchObject({ ok: true, data: { title: "NovelFork Owner A" } });
    expect(launchB, JSON.stringify(launchB)).toMatchObject({ ok: true, data: { title: "NovelFork Owner B" } });

    const idA = (launchA.data as { session_id: string }).session_id;
    const idB = (launchB.data as { session_id: string }).session_id;
    expect(idA).toMatch(UUID_V4);
    expect(idB).toMatch(UUID_V4);
    expect(idA).not.toBe(idB);

    await expect(ownerA.execute(browserInput("browser-execution-a", { action: "list_sessions" })))
      .resolves.toMatchObject({ ok: true, data: { sessions: [{ id: idA }] } });
    await expect(ownerB.execute(browserInput("browser-execution-b", { action: "list_sessions" })))
      .resolves.toMatchObject({ ok: true, data: { sessions: [{ id: idB }] } });
    await expect(ownerB.execute(browserInput("browser-execution-b", { action: "get_text", session_id: idA })))
      .resolves.toMatchObject({ ok: false, error: "not-found" });
    await expect(ownerA.execute(browserInput("browser-execution-a", { action: "close", session_id: idB })))
      .resolves.toMatchObject({ ok: false, error: "not-found" });

    await expect(ownerA.execute(browserInput("browser-execution-a", { action: "close", session_id: idA })))
      .resolves.toMatchObject({ ok: true, data: { session_id: idA } });
    const disposeB = await registry.disposeSession("browser-owner-b", "session-dispose");
    expect(disposeB).toMatchObject({ ok: true, resources: [{ id: idB, kind: "browser", status: "stopped" }] });

    await expect(ownerA.execute(browserInput("browser-execution-a", { action: "list_sessions" })))
      .resolves.toMatchObject({ ok: true, data: { sessions: [] } });
    await expect(ownerB.execute(browserInput("browser-execution-b", { action: "list_sessions" })))
      .resolves.toMatchObject({ ok: true, data: { sessions: [] } });
    expect(registry.listOwned("browser-owner-a", "browser").every((resource) => resource.status === "stopped")).toBe(true);
    expect(registry.listOwned("browser-owner-b", "browser").every((resource) => resource.status === "stopped")).toBe(true);
  }, 60_000);
});
