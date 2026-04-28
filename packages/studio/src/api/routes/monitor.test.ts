import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { createMonitorRouter, setupMonitorWebSocket } from "./monitor";
import type { RouterContext } from "./context";

function createTestContext(): RouterContext {
  return {} as RouterContext;
}

describe("monitor unsupported transparency", () => {
  it("returns unsupported instead of a fixed stopped status", async () => {
    const app = createMonitorRouter(createTestContext());

    const response = await app.request("http://localhost/api/monitor/status");
    const body = await response.json();

    expect(response.status).toBe(501);
    expect(body).toMatchObject({
      code: "unsupported",
      capability: "monitor.status",
      status: "planned",
    });
    expect(body).not.toMatchObject({ status: "stopped" });
  });

  it("announces unsupported websocket events instead of fake realtime status", async () => {
    const server = createServer();
    const wss = setupMonitorWebSocket(server, createTestContext());

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/monitor/logs`);

    const message = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out waiting for monitor websocket message")), 1000);
      ws.on("message", (data) => {
        clearTimeout(timeout);
        resolve(data.toString());
      });
      ws.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    expect(JSON.parse(message)).toMatchObject({
      type: "unsupported",
      code: "unsupported",
      capability: "monitor.websocket.events",
    });
    expect(JSON.parse(message)).not.toMatchObject({ type: "status", status: "stopped" });

    ws.close();
    wss.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
