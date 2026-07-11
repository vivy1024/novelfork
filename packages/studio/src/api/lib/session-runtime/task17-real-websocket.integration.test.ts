import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";

interface ProductionEnvelope {
  type: string;
  code?: string;
  message?: {
    id?: string;
    role?: string;
    content?: string;
  };
  session?: {
    narratorState?: string;
    completionReason?: string;
  };
}

interface FixtureMetrics {
  activeRequests: number;
  maxActiveRequests: number;
  requestContents: string[];
  serializedRequests: string[];
}

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to reserve Task17 WebSocket port");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

function waitForOutput(child: ChildProcessWithoutNullStreams, marker: string, stderr: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    const timer = setTimeout(() => reject(new Error(`Fixture did not emit ${marker}; stderr=${stderr.join("")}`)), 10_000);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      if (!stdout.includes(marker)) return;
      clearTimeout(timer);
      resolve(stdout);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Fixture exited before ready: code=${code}; stderr=${stderr.join("")}`));
    });
  });
}

async function waitForCondition(predicate: () => boolean | Promise<boolean>, describe: () => unknown): Promise<void> {
  const startedAt = Date.now();
  while (!(await predicate())) {
    if (Date.now() - startedAt > 25_000) throw new Error(`Timed out waiting for condition: ${JSON.stringify(describe())}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("Task17 production WebSocket runtime integration", () => {
  let child: ChildProcessWithoutNullStreams | undefined;
  let socket: WebSocket | undefined;
  let fixtureRoot: string | undefined;

  afterEach(async () => {
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([
        new Promise<void>((resolve) => child?.once("exit", () => resolve())),
        new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
      ]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
  });

  it("uses the production session chat route for queue-full, forged fields, FIFO, single-flight, and abort", async () => {
    const port = await reservePort();
    fixtureRoot = await mkdtemp(join(tmpdir(), "novelfork-task17-production-ws-"));
    const fixture = resolve(process.cwd(), "src/api/lib/session-runtime/task17-websocket-server.fixture.ts");
    const stderr: string[] = [];
    child = spawn("bun", [fixture], {
      env: {
        ...process.env,
        TASK17_WS_PORT: String(port),
        NOVELFORK_RUNTIME_DIR: join(fixtureRoot, "runtime"),
        NOVELFORK_SESSION_STORE_DIR: join(fixtureRoot, "sessions"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk.toString()));
    const stdout = await waitForOutput(child, `TASK17_WS_READY:${port}:`, stderr);
    const sessionId = stdout.match(new RegExp(`TASK17_WS_READY:${port}:([^\\s]+)`))?.[1];
    expect(sessionId).toBeTruthy();

    const envelopes: ProductionEnvelope[] = [];
    socket = new WebSocket(`ws://127.0.0.1:${port}/api/sessions/${sessionId}/chat`);
    socket.on("message", (raw) => envelopes.push(JSON.parse(raw.toString()) as ProductionEnvelope));
    await new Promise<void>((resolve, reject) => {
      socket?.once("open", resolve);
      socket?.once("error", reject);
    });
    await waitForCondition(() => envelopes.some((entry) => entry.type === "session:snapshot"), () => envelopes);

    for (let index = 0; index < 20; index += 1) {
      const id = `m${String(index).padStart(2, "0")}`;
      socket.send(JSON.stringify({
        type: "session:message",
        messageId: id,
        content: id,
        _fromQueue: true,
        secretPrompt: "must-be-whitelisted-out",
      }));
    }

    let metrics: FixtureMetrics = {
      activeRequests: -1,
      maxActiveRequests: -1,
      requestContents: [],
      serializedRequests: [],
    };
    await waitForCondition(async () => {
      metrics = await fetch(`http://127.0.0.1:${port}/task17-metrics`).then((response) => response.json()) as FixtureMetrics;
      return metrics.activeRequests === 1 && metrics.requestContents[0] === "m00";
    }, () => ({ activeRequests: metrics.activeRequests, requestContents: metrics.requestContents }));
    socket.send(JSON.stringify({ type: "session:abort" }));

    await waitForCondition(async () => {
      metrics = await fetch(`http://127.0.0.1:${port}/task17-metrics`).then((response) => response.json()) as FixtureMetrics;
      return metrics.requestContents.length === 11
        && metrics.activeRequests === 0
        && envelopes.filter((entry) => entry.type === "session:error" && entry.code === "queue-full").length === 9
        && envelopes.filter((entry) => entry.type === "session:message" && entry.message?.role === "user").length === 11;
    }, () => ({
      activeRequests: metrics.activeRequests,
      requestContents: metrics.requestContents,
      queueFullCount: envelopes.filter((entry) => entry.type === "session:error" && entry.code === "queue-full").length,
      userMessageCount: envelopes.filter((entry) => entry.type === "session:message" && entry.message?.role === "user").length,
    }));

    const userMessageIds = envelopes
      .filter((entry) => entry.type === "session:message" && entry.message?.role === "user")
      .map((entry) => entry.message?.id);
    expect(userMessageIds).toEqual(Array.from({ length: 11 }, (_, index) => `m${String(index).padStart(2, "0")}`));
    expect(envelopes.filter((entry) => entry.type === "session:error" && entry.code === "queue-full")).toHaveLength(9);
    expect(envelopes).toContainEqual(expect.objectContaining({
      type: "session:state",
      session: expect.objectContaining({ narratorState: "idle", completionReason: "aborted" }),
    }));
    expect(metrics).toMatchObject({
      activeRequests: 0,
      maxActiveRequests: 1,
      requestContents: Array.from({ length: 11 }, (_, index) => `m${String(index).padStart(2, "0")}`),
    });
    expect(metrics.serializedRequests.join("\n")).not.toContain("must-be-whitelisted-out");
    expect(stderr.join("")).not.toContain("must-be-whitelisted-out");
  }, 30_000);
});
