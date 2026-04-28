import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { AgentConfigService } from "./agent-config-service";

const tempDirs: string[] = [];

async function createTempStoragePath() {
  const dir = await mkdtemp(join(tmpdir(), "novelfork-agent-config-"));
  tempDirs.push(dir);
  return join(dir, "agent-config.json");
}

function listenOnRandomPort() {
  const server = createServer();
  return new Promise<{ port: number; close: () => Promise<void> }>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to allocate test port"));
        return;
      }
      resolve({
        port: address.port,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("AgentConfigService persistence and real port checks", () => {
  it("persists config updates across service re-instantiation", async () => {
    const storagePath = await createTempStoragePath();
    const service = new AgentConfigService({ storagePath });

    const update = service.updateAgentConfig({ maxActiveWorkspaces: 42, autoSaveOnSleep: false });

    expect(update).toMatchObject({ success: true });
    const reloaded = new AgentConfigService({ storagePath });
    expect(reloaded.getAgentConfig()).toMatchObject({
      maxActiveWorkspaces: 42,
      autoSaveOnSleep: false,
    });
  });

  it("skips ports already occupied by the operating system", async () => {
    const storagePath = await createTempStoragePath();
    const occupied = await listenOnRandomPort();
    const service = new AgentConfigService({ storagePath, portHost: "127.0.0.1" });

    service.updateAgentConfig({
      portRangeStart: occupied.port,
      portRangeEnd: occupied.port + 101,
    });

    const result = await service.allocatePort();

    expect(result).toMatchObject({ port: occupied.port + 1, allocation: "verified-free" });
    await occupied.close();
  });

  it("marks resource usage as unknown when no real runtime source is attached", async () => {
    const service = new AgentConfigService({ storagePath: await createTempStoragePath() });

    expect(service.getResourceUsage()).toMatchObject({
      source: "unknown",
      activeWorkspaces: null,
      activeContainers: null,
      totalWorkspaceSize: null,
    });
  });
});
